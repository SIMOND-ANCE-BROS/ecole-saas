import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OTHER_ENTITY } from "../domain/lesson-pack/pack";
import { createCourse, entityLock, readCourse, updateCourse, type CourseInput } from "./courses";
import { enrollmentPreview, saveEnrollment, type EnrollmentInput } from "./enrollments";
import { withSchool } from "./index";
import { countLesson, ENTITY_REQUIRED, lessonPacks, sellLessonPack } from "./lesson-packs";
import { overlapping } from "./overlap.integration-helpers";
import { syncLessons } from "./lessons";
import { once, storedEnrollment } from "./submissions";
import { defaultEntityFor, schoolWithDefaultEntity } from "./billing-entity.integration-helpers";

/**
 * Courses, enrollments and lesson packs sold by one business each (#299, ADR 0006), run
 * as the application (app_user, RLS) on a school with two entities. Fictitious data
 * deleted at the end, the audit log included (saving an enrollment writes to it, #292).
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const frontDesk = `compte-accueil-${suffix}`;
const TODAY = "2026-11-02";
const ids = {} as Record<string, string>;

const child = (studentId: string, courseIds: string[]): EnrollmentInput => ({
  studentIds: [studentId],
  audience: "child",
  period: "quarter",
  courseIds,
});

beforeAll(async () => {
  [{ id: ids.school }] = await schoolWithDefaultEntity(admin, "Zz École deux entreprises", `zz2e-${suffix}`);
  const s = ids.school;
  [{ id: ids.a }] = await admin`SELECT id FROM billing_entity WHERE school_id = ${s} AND is_default`;
  [{ id: ids.b }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, default_vat_treatment_id)
    VALUES (${s}, 'Zz Entreprise B', 'Zz Entreprise B', 'not_applicable', (SELECT default_vat_treatment_id FROM billing_entity WHERE school_id = ${s} AND is_default)) RETURNING id`;
  [{ id: ids.closed }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, active, default_vat_treatment_id)
    VALUES (${s}, 'Zz Entreprise fermée', 'Zz Entreprise fermée', 'not_applicable', false, (SELECT default_vat_treatment_id FROM billing_entity WHERE school_id = ${s} AND is_default)) RETURNING id`;
  [{ id: ids.otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz Autre', ${`zz2o-${suffix}`}) RETURNING id`;
  ids.otherEntity = await defaultEntityFor(admin, ids.otherSchool, "Zz Autre entreprise");
  await admin`INSERT INTO "user" (id, name, email) VALUES (${frontDesk}, 'Zz Accueil', ${`${frontDesk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${s}, ${frontDesk}, 'front_desk')`;
  [{ id: ids.season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${s}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  for (const [combination, price] of [
    ["{45}", 8500],
    ["{60}", 11000],
    ["{45,60}", 16500],
  ] as const)
    await admin`INSERT INTO tariff (school_id, season_id, audience, period, combination, price_cents)
      VALUES (${s}, ${ids.season}, 'child', 'quarter', ${combination}::smallint[], ${price})`;
  await admin`INSERT INTO discount (school_id, season_id, code, rate_bps, min_students, audiences, combinable_with_multi_discipline)
    VALUES (${s}, ${ids.season}, 'fratrie', 1000, 2, '{child}', false)`;
  const [site] = await admin`INSERT INTO site (school_id, name, address) VALUES (${s}, 'Zz Site', 'Zz') RETURNING id`;
  [{ id: ids.room }] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${s}, ${site.id}, 'Zz Salle') RETURNING id`;
  [{ id: ids.teacher }] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${s}, 'Zzprof', 'Zz', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  [{ id: ids.jazz }] = await admin`INSERT INTO discipline (school_id, name) VALUES (${s}, 'Zzjazz') RETURNING id`;
  [{ id: ids.rock }] = await admin`INSERT INTO discipline (school_id, name) VALUES (${s}, 'Zzrock') RETURNING id`;
  const course = async (entity: string, discipline: string, minutes: number, day: number, type = "group") =>
    (
      await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, type, weekday, start_time, duration_minutes)
      VALUES (${s}, ${entity}, ${ids.season}, ${discipline}, ${ids.room}, ${ids.teacher}, ${type}, ${day}, '17:00', ${minutes}) RETURNING id`
    )[0].id as string;
  ids.jazzA = await course(ids.a, ids.jazz, 60, 1);
  ids.jazz45A = await course(ids.a, ids.jazz, 45, 2);
  ids.rockB = await course(ids.b, ids.rock, 45, 3);
  ids.privateB = await course(ids.b, ids.rock, 60, 4, "private");
  for (const [key, first] of [
    ["payer", "Zzparent"],
    ["zoe", "Zzzoé"],
    ["noe", "Zznoé"],
  ] as const)
    [{ id: ids[key] }] =
      await admin`INSERT INTO person (school_id, last_name, first_name, is_student) VALUES (${s}, 'Zzfamille', ${first}, ${key !== "payer"}) RETURNING id`;
  for (const student of [ids.zoe, ids.noe])
    await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for) VALUES (${s}, ${ids.payer}, ${student}, 'legal_guardian', true)`;
});

afterAll(async () => {
  // The audit log is append-only: its trigger is disabled for the cleanup only.
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${ids.school}, ${ids.otherSchool})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of [
    "lesson_pack_usage",
    "lesson_pack_person",
    "lesson_pack",
    "enrollment_course",
    "enrollment",
    "submission",
    "lesson",
    "course_date",
    "course",
    "relationship",
    "person",
    "instructor",
    "room",
    "site",
    "discipline",
    "discount",
    "tariff",
    "season",
    "member",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [ids.school, ids.otherSchool]);
  await admin`DELETE FROM "user" WHERE id = ${frontDesk}`;
  await admin`DELETE FROM school WHERE id IN (${ids.school}, ${ids.otherSchool})`;
  await admin.end();
});

describe("composite foreign keys carrying the entity", () => {
  it("refuses an enrollment_course whose course belongs to another entity than the enrollment", async () => {
    const [e] = await admin`
      INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents)
      VALUES (${ids.school}, ${ids.a}, ${ids.season}, ${ids.payer}, 'child', 'quarter', 11000) RETURNING id`;
    try {
      // The enrollment's entity on the row: the course's key refuses it.
      await expect(
        admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id)
          VALUES (${ids.school}, ${ids.a}, ${e.id}, ${ids.zoe}, ${ids.rockB})`,
      ).rejects.toThrow(/enrollment_course_course_same_entity_fk/);
      // The course's entity on the row: the enrollment's key refuses it.
      await expect(
        admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id)
          VALUES (${ids.school}, ${ids.b}, ${e.id}, ${ids.zoe}, ${ids.rockB})`,
      ).rejects.toThrow(/enrollment_course_enrollment_same_entity_fk/);
    } finally {
      await admin`DELETE FROM enrollment WHERE id = ${e.id}`;
    }
  });

  it("refuses a course of another school's entity", async () => {
    await expect(
      // Its own school's treatment named: the entity's key is what refuses it.
      admin`INSERT INTO course (school_id, billing_entity_id, vat_treatment_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
        VALUES (${ids.school}, ${ids.otherEntity}, (SELECT default_vat_treatment_id FROM billing_entity WHERE id = ${ids.a}),
          ${ids.season}, ${ids.jazz}, ${ids.room}, ${ids.teacher}, 5, '10:00', 60)`,
    ).rejects.toThrow(/course_billing_entity_same_school_fk/);
  });
});

describe("enrolling in courses of two entities (#299)", () => {
  it("previews one enrollment per entity, each priced on its own courses", async () => {
    const p = await withSchool(ids.school, (tx) =>
      enrollmentPreview(tx, ids.payer, ids.season, child(ids.zoe, [ids.rockB, ids.jazzA])),
    );
    if (p.status !== "ok") throw new Error(p.message);
    // The default entity first; not the « 45 min + 1 h » package of both (165 €).
    expect(p.newEnrollments).toMatchObject([
      { billingEntityId: ids.a, entity: "Zz Entreprise", courseIds: [ids.jazzA], price: { grossPriceCents: 11000 } },
      { billingEntityId: ids.b, entity: "Zz Entreprise B", courseIds: [ids.rockB], price: { grossPriceCents: 8500 } },
    ]);
  });

  it("creates both enrollments in one submission, and nothing more on a retry with the same key", async () => {
    const key = randomUUID();
    const entry = child(ids.zoe, [ids.jazzA, ids.rockB]);
    const run = () =>
      withSchool(ids.school, (tx) =>
        once(tx, "enrollment", key, { payerId: ids.payer, ...entry }, storedEnrollment, () =>
          saveEnrollment(tx, frontDesk, ids.payer, ids.season, entry),
        ),
      );
    const first = await run();
    if (!first.ok) throw new Error(first.message);
    expect(first.ids).toHaveLength(2);
    expect(await run()).toEqual(first);
    const rows = await admin`
      SELECT e.billing_entity_id AS entity, e.gross_price_cents AS gross, array_agg(c.course_id) AS courses,
        array_agg(DISTINCT c.billing_entity_id) AS line_entities
      FROM enrollment e JOIN enrollment_course c ON c.enrollment_id = e.id
      WHERE e.payer_id = ${ids.payer} GROUP BY e.id ORDER BY gross DESC`;
    expect(rows).toEqual([
      { entity: ids.a, gross: 11000, courses: [ids.jazzA], line_entities: [ids.a] },
      { entity: ids.b, gross: 8500, courses: [ids.rockB], line_entities: [ids.b] },
    ]);
  });

  it("counts the siblings across entities, each discount on its own enrollment", async () => {
    // Zoé is enrolled with both entities (previous test); Noé takes a course of B only.
    const p = await withSchool(ids.school, (tx) =>
      enrollmentPreview(tx, ids.payer, ids.season, child(ids.noe, [ids.rockB])),
    );
    if (p.status !== "ok") throw new Error(p.message);
    expect(p.newEnrollments).toMatchObject([
      { billingEntityId: ids.b, price: { grossPriceCents: 8500, discountCents: 850 } },
    ]);
    // Zoé's two saved enrollments would each get their own discount: told, never applied.
    expect(p.existingImpacts.map((i) => i.recalculatedDiscount).sort((x, y) => x - y)).toEqual([850, 1100]);
  });
});

describe("the entity of a course", () => {
  const input = (billingEntityId?: string): CourseInput => ({
    discipline: { id: ids.jazz },
    room: { id: ids.room },
    instructorId: ids.teacher,
    billingEntityId,
    type: "group",
    recurrence: "weekly",
    weekday: 6,
    startDate: null,
    endDate: null,
    dates: [],
    startTime: "10:00",
    durationMinutes: 60,
    ageMin: null,
    ageMax: null,
    level: null,
    maxCapacity: null,
    instructorRate: null,
  });
  const entityOf = async (id: string) => (await withSchool(ids.school, (tx) => readCourse(tx, id)))?.billingEntityId;

  it("is the default entity when none is chosen, the chosen one otherwise", async () => {
    const plain = await withSchool(ids.school, (tx) => createCourse(tx, ids.season, input()));
    const chosen = await withSchool(ids.school, (tx) => createCourse(tx, ids.season, input(ids.b)));
    if (!plain.ok || !chosen.ok) throw new Error("course not created");
    expect(await entityOf(plain.id)).toBe(ids.a);
    expect(await entityOf(chosen.id)).toBe(ids.b);
    // Saved again without a choice (one-entity form): it keeps its own.
    expect(await withSchool(ids.school, (tx) => updateCourse(tx, chosen.id, input()))).toMatchObject({ ok: true });
    expect(await entityOf(chosen.id)).toBe(ids.b);
  });

  it("refuses an inactive entity or one of another school", async () => {
    for (const entity of [ids.closed, ids.otherEntity])
      expect(await withSchool(ids.school, (tx) => createCourse(tx, ids.season, input(entity)))).toEqual({
        ok: false,
        message: "Entreprise introuvable ou inactive.",
      });
  });

  it("changes while the course has no enrollment, never once it has one", async () => {
    const free = await withSchool(ids.school, (tx) => createCourse(tx, ids.season, input(ids.a)));
    if (!free.ok) throw new Error("course not created");
    expect(await withSchool(ids.school, (tx) => updateCourse(tx, free.id, input(ids.b)))).toMatchObject({ ok: true });
    expect(await entityOf(free.id)).toBe(ids.b);

    // jazzA has Zoé's enrollment (entity A).
    expect(await withSchool(ids.school, (tx) => updateCourse(tx, ids.jazzA, input(ids.b)))).toEqual({
      ok: false,
      message: "Ce cours a 1 inscription : l’entreprise qui le vend ne peut plus changer.",
    });
    expect(await entityOf(ids.jazzA)).toBe(ids.a);
  });
});

/** What the course form would send for a saved private course, with another entity. */
async function privateCourseInput(id: string, billingEntityId: string): Promise<CourseInput> {
  const [c] = await admin`SELECT * FROM course WHERE id = ${id}`;
  return {
    discipline: { id: c.discipline_id },
    room: { id: c.room_id },
    instructorId: c.instructor_id,
    billingEntityId,
    type: "private",
    recurrence: "weekly",
    weekday: c.weekday,
    startDate: null,
    endDate: null,
    dates: [],
    startTime: String(c.start_time).slice(0, 5),
    durationMinutes: c.duration_minutes,
    ageMin: null,
    ageMax: null,
    level: null,
    maxCapacity: null,
    instructorRate: null,
  };
}

describe("lesson packs and entities", () => {
  it("refuses to count a lesson on a pack of another entity, and does not offer it", async () => {
    await withSchool(ids.school, (tx) => syncLessons(tx, ids.season, TODAY));
    const [lesson] = await admin`SELECT id FROM lesson WHERE course_id = ${ids.privateB} ORDER BY date LIMIT 1`;
    // A pack sold by A (the default entity); the private course is sold by B.
    const [pack] = await admin`
      INSERT INTO lesson_pack (school_id, billing_entity_id, payer_id, people_count, lesson_count, price_cents)
      VALUES (${ids.school}, ${ids.a}, ${ids.payer}, 1, 5, 20000) RETURNING id`;
    await admin`INSERT INTO lesson_pack_person (school_id, lesson_pack_id, person_id) VALUES (${ids.school}, ${pack.id}, ${ids.zoe})`;
    expect(await withSchool(ids.school, (tx) => countLesson(tx, frontDesk, lesson.id, pack.id))).toEqual({
      ok: false,
      message: OTHER_ENTITY,
    });
    const offered = await withSchool(ids.school, (tx) => lessonPacks(tx, lesson.id, []));
    expect(offered.offered.map((p) => p.id)).not.toContain(pack.id);
  });

  it("offers a pack of the course's entity, then locks the course's entity once a lesson is counted", async () => {
    const [lesson] = await admin`SELECT id FROM lesson WHERE course_id = ${ids.privateB} ORDER BY date LIMIT 1`;
    const [pack] = await admin`
      INSERT INTO lesson_pack (school_id, billing_entity_id, payer_id, people_count, lesson_count, price_cents)
      VALUES (${ids.school}, ${ids.b}, ${ids.payer}, 1, 5, 20000) RETURNING id`;
    await admin`INSERT INTO lesson_pack_person (school_id, lesson_pack_id, person_id) VALUES (${ids.school}, ${pack.id}, ${ids.noe})`;
    const offered = await withSchool(ids.school, (tx) => lessonPacks(tx, lesson.id, []));
    expect(offered.offered.map((p) => p.id)).toContain(pack.id);

    expect(await withSchool(ids.school, (tx) => entityLock(tx, ids.privateB))).toBeNull();
    // Counted directly: countLesson would write to the audit log, which these tests leave untouched.
    await admin`INSERT INTO lesson_pack_usage (school_id, lesson_pack_id, lesson_id) VALUES (${ids.school}, ${pack.id}, ${lesson.id})`;
    const locked = "Ce cours a 1 séance décomptée d’un carnet : l’entreprise qui le vend ne peut plus changer.";
    expect(await withSchool(ids.school, (tx) => entityLock(tx, ids.privateB))).toBe(locked);
    const input = await privateCourseInput(ids.privateB, ids.a);
    expect(await withSchool(ids.school, (tx) => updateCourse(tx, ids.privateB, input))).toEqual({
      ok: false,
      message: locked,
    });
  });

  it("never counts a lesson on a pack of the course's old entity while the entity changes", async () => {
    // A private course of B with no counted lesson, a pack of B: the director moves the
    // course to A while the front desk counts one of its lessons on the B pack.
    const [{ id: course }] = await admin`
      INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, type, weekday, start_time, duration_minutes)
      VALUES (${ids.school}, ${ids.b}, ${ids.season}, ${ids.rock}, ${ids.room}, ${ids.teacher}, 'private', 5, '18:00', 60) RETURNING id`;
    await withSchool(ids.school, (tx) => syncLessons(tx, ids.season, TODAY));
    const [lesson] = await admin`SELECT id FROM lesson WHERE course_id = ${course} ORDER BY date LIMIT 1`;
    const [pack] = await admin`
      INSERT INTO lesson_pack (school_id, billing_entity_id, payer_id, people_count, lesson_count, price_cents)
      VALUES (${ids.school}, ${ids.b}, ${ids.payer}, 1, 5, 20000) RETURNING id`;
    await admin`INSERT INTO lesson_pack_person (school_id, lesson_pack_id, person_id) VALUES (${ids.school}, ${pack.id}, ${ids.zoe})`;
    const input = await privateCourseInput(course, ids.a);

    const [moved, counted] = await overlapping(
      admin,
      (hold) =>
        withSchool(ids.school, async (tx) => {
          const r = await updateCourse(tx, course, input);
          await hold();
          return r;
        }),
      () => withSchool(ids.school, (tx) => countLesson(tx, frontDesk, lesson.id, pack.id)),
    );
    // The count waited for the move, then read the course's new entity.
    expect(moved).toMatchObject({ ok: true });
    expect(counted).toEqual({ ok: false, message: OTHER_ENTITY });
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM lesson_pack_usage WHERE lesson_pack_id = ${pack.id}`;
    expect(n).toBe(0);
  });

  it("refuses a pack sold without its entity when the school has several active ones", async () => {
    const r = await withSchool(ids.school, (tx) =>
      sellLessonPack(
        tx,
        frontDesk,
        ids.payer,
        { lessonCount: 5, peopleCount: 1, participantIds: [ids.zoe], priceCents: 20000, reason: "Zz devis" },
        TODAY,
      ),
    );
    expect(r).toEqual({ ok: false, message: ENTITY_REQUIRED });
  });

  it("refuses to sell a pack for an inactive entity", async () => {
    const r = await withSchool(ids.school, (tx) =>
      sellLessonPack(
        tx,
        frontDesk,
        ids.payer,
        {
          lessonCount: 5,
          peopleCount: 1,
          participantIds: [ids.zoe],
          priceCents: 20000,
          reason: "Zz devis",
          billingEntityId: ids.closed,
        },
        TODAY,
      ),
    );
    expect(r).toEqual({ ok: false, message: "Entreprise introuvable ou inactive." });
  });
});
