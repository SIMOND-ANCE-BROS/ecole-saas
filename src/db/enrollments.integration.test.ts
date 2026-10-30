import postgres from "postgres";
import { withDefaultQuarters } from "./season-quarters.integration-helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { enrollmentPreview, saveEnrollment, seasonEnrollments } from "./enrollments";
import { seasonCourses } from "./schedule";
import { seasonFigures, lastEnrollments } from "./dashboard";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";

/** Enrollments, run as the application (app_user, RLS). Fictitious data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const ids = {} as Record<string, string>;
const frontDesk = `sub-accueil-i-${suffix}`;

beforeAll(async () => {
  [{ id: ids.school }] = await schoolWithDefaultEntity(admin, "École I", `i-${suffix}`);
  const e = ids.school;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${frontDesk}, 'Zz Accueil', ${`${frontDesk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${e}, ${frontDesk}, 'front_desk')`;
  [{ id: ids.season }] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${e}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: ids.otherSeason }] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${e}, '2027-2028', '2027-09-01', '2028-06-30') RETURNING id`;
  await withDefaultQuarters(admin, ids.season);
  await withDefaultQuarters(admin, ids.otherSeason);
  for (const [combination, price] of [
    ["{60}", 11000],
    ["{45,60}", 16500],
    ["{60,60}", 18500],
  ] as const) {
    await admin`INSERT INTO tariff (school_id, season_id, audience, period, combination, price_cents)
      VALUES (${e}, ${ids.season}, 'child', 'quarter', ${combination}::smallint[], ${price})`;
  }
  await admin`INSERT INTO discount (school_id, season_id, code, rate_bps, min_students, audiences, combinable_with_multi_discipline)
    VALUES (${e}, ${ids.season}, 'fratrie', 1000, 2, '{child}', false)`;
  const [site] = await admin`INSERT INTO site (school_id, name, address) VALUES (${e}, 'Site', 'Adresse') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${e}, ${site.id}, 'Salle') RETURNING id`;
  const [teacher] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${e}, 'Prof', 'Test', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  const [jazz] = await admin`INSERT INTO discipline (school_id, name) VALUES (${e}, 'Jazz') RETURNING id`;
  const [classical] = await admin`INSERT INTO discipline (school_id, name) VALUES (${e}, 'Classique') RETURNING id`;
  const course = async (seasonId: string, disciplineId: string, duration: number, day: number) =>
    (
      await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${e}, (SELECT id FROM billing_entity WHERE school_id = ${e} AND is_default), ${seasonId}, ${disciplineId}, ${room.id}, ${teacher.id}, ${day}, '17:00', ${duration}) RETURNING id`
    )[0].id as string;
  ids.jazz60 = await course(ids.season, jazz.id, 60, 1);
  ids.jazz45 = await course(ids.season, jazz.id, 45, 2);
  ids.classical60 = await course(ids.season, classical.id, 60, 3);
  ids.otherSeason60 = await course(ids.otherSeason, jazz.id, 60, 1);
  [{ id: ids.payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${e}, 'Famille', 'Test') RETURNING id`;
  [{ id: ids.otherPayer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${e}, 'Autre', 'Famille') RETURNING id`;
  [{ id: ids.zoe }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${e}, 'Famille', 'Zoé') RETURNING id`;
  [{ id: ids.noe }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${e}, 'Famille', 'Noé') RETURNING id`;
  [{ id: ids.foreign }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${e}, 'Autre', 'Max') RETURNING id`;
  await admin`UPDATE person SET is_student = true WHERE id IN (${ids.zoe}, ${ids.noe}, ${ids.foreign})`;
  for (const [payer, student] of [
    [ids.payer, ids.zoe],
    [ids.payer, ids.noe],
    [ids.otherPayer, ids.foreign],
  ]) {
    await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for) VALUES (${e}, ${payer}, ${student}, 'legal_guardian', true)`;
  }
});

afterAll(async () => {
  // The audit log is append-only: its trigger is disabled for the cleanup only.
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id = ${ids.school}`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of [
    "enrollment_course",
    "enrollment",
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
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [ids.school]);
  }
  await admin`DELETE FROM "user" WHERE id = ${frontDesk}`;
  await admin`DELETE FROM school WHERE id = ${ids.school}`;
  await admin.end();
});

const childEntry = (studentIds: string[], courseIds: string[]) => ({
  studentIds: studentIds,
  audience: "child" as const,
  period: "quarter" as const,
  courseIds: courseIds,
});
const preview = (entry: ReturnType<typeof childEntry>) =>
  withSchool(ids.school, (tx) => enrollmentPreview(tx, ids.payer, ids.season, entry, ENROLLED_ON));
// Enrolled before the season's first quarter: quarterly enrollments cover its three quarters (#291).
const ENROLLED_ON = "2026-09-15";
const save = (entry: ReturnType<typeof childEntry>) =>
  withSchool(ids.school, (tx) => saveEnrollment(tx, frontDesk, ids.payer, ids.season, entry, ENROLLED_ON));

describe("Enrollment", () => {
  it("previews the price for a first child, without siblings discount", async () => {
    const a = await preview(childEntry([ids.zoe], [ids.jazz60]));
    if (a.status !== "ok") throw new Error(a.message);
    expect(a.newEnrollments[0].price).toMatchObject({ status: "ok", grossPriceCents: 11000, netPriceCents: 11000 });
  });

  it("saves the enrollment at the price recomputed on the server", async () => {
    const r = await save(childEntry([ids.zoe], [ids.jazz60]));
    if (!r.ok) throw new Error(r.message);
    const [row] =
      await admin`SELECT audience, period, gross_price_cents, discount_cents, net_price_cents, discounts, tariff_id
      FROM enrollment WHERE id = ${r.id}`;
    expect(row).toMatchObject({
      audience: "child",
      period: "quarter",
      gross_price_cents: 11000,
      discount_cents: 0,
      net_price_cents: 11000,
      discounts: [],
    });
    expect(row.tariff_id).toBeTruthy();
    const linkedCourses =
      await admin`SELECT student_id, course_id FROM enrollment_course WHERE enrollment_id = ${r.id}`;
    expect(linkedCourses).toEqual([{ student_id: ids.zoe, course_id: ids.jazz60 }]);
  });

  it("applies the siblings discount with the already saved enrollment, and flags it for that one", async () => {
    const a = await preview(childEntry([ids.noe], [ids.jazz60]));
    if (a.status !== "ok") throw new Error(a.message);
    expect(a.newEnrollments[0].price).toMatchObject({
      grossPriceCents: 11000,
      discountCents: 1100,
      netPriceCents: 9900,
    });
    expect(a.existingImpacts).toHaveLength(1);
    expect(a.existingImpacts[0]).toMatchObject({ students: "Zoé", savedDeposit: 0, recalculatedDiscount: 1100 });
  });

  it("still names a student of a saved enrollment once no longer marked as a student (#314)", async () => {
    await admin`UPDATE person SET is_student = false WHERE id = ${ids.zoe}`;
    try {
      const a = await preview(childEntry([ids.noe], [ids.jazz60]));
      if (a.status !== "ok") throw new Error(a.message);
      expect(a.existingImpacts.map((i) => i.students)).toEqual(["Zoé"]);
    } finally {
      await admin`UPDATE person SET is_student = true WHERE id = ${ids.zoe}`;
    }
  });

  it("saves the second child with the siblings discount (two courses of the same discipline)", async () => {
    const r = await save(childEntry([ids.noe], [ids.jazz45, ids.jazz60]));
    if (!r.ok) throw new Error(r.message);
    const [row] = await admin`SELECT gross_price_cents, discount_cents, discounts FROM enrollment WHERE id = ${r.id}`;
    expect(row).toMatchObject({ gross_price_cents: 16500, discount_cents: 1650, discounts: ["fratrie"] });
  });

  it("lists the enrollments paid by the person for the season", async () => {
    const list = await withSchool(ids.school, (tx) => seasonEnrollments(tx, { payerId: ids.payer }, ids.season));
    expect(list.map((i) => [i.students, i.netPriceCents])).toEqual([
      ["Noé", 14850],
      ["Zoé", 11000],
    ]);
  });
});

describe("Rejections", () => {
  it("rejects a student of another payer", async () => {
    expect(await save(childEntry([ids.foreign], [ids.jazz60]))).toMatchObject({ ok: false });
  });

  it("rejects a contact the payer pays for who is not a student yet, without saving anything (#314)", async () => {
    const [{ id: contact }] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${ids.school}, 'Famille', 'Zzcontact') RETURNING id`;
    await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for)
      VALUES (${ids.school}, ${ids.payer}, ${contact}, 'other', true)`;
    expect(await save(childEntry([contact], [ids.jazz60]))).toEqual({
      ok: false,
      message: "Cette personne n’est pas encore élève : « Ajouter aux élèves » sur sa fiche de contact.",
    });
    expect(await admin`SELECT 1 FROM enrollment_course WHERE student_id = ${contact}`).toHaveLength(0);
  });

  it("rejects a course from another season", async () => {
    expect(await save(childEntry([ids.zoe], [ids.otherSeason60]))).toMatchObject({ ok: false });
  });

  it("rejects a couple with a single student", async () => {
    const r = await save({ ...childEntry([ids.zoe], [ids.jazz60]), audience: "couple" as never });
    expect(r).toMatchObject({ ok: false, message: "Un couple réunit deux danseurs." });
  });

  it("rejects a combination missing from the grid, without saving anything", async () => {
    const [{ before }] = await admin`SELECT count(*)::int AS before FROM enrollment WHERE school_id = ${ids.school}`;
    const r = await save(childEntry([ids.zoe], [ids.jazz60, ids.classical60, ids.jazz45]));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toContain("prix à saisir par l’accueil");
    const [{ after }] = await admin`SELECT count(*)::int AS after FROM enrollment WHERE school_id = ${ids.school}`;
    expect(typeof before).toBe("number");
    expect(after).toBe(before);
  });
});

describe("Dashboard and headcounts", () => {
  it("counts the season's enrollments, students and total amount", async () => {
    const digits = await withSchool(ids.school, (tx) => seasonFigures(tx, ids.season));
    // Quarterly prices, three quarters each (#291).
    expect(digits).toEqual({ enrollments: 2, students: 2, netTotalCents: (11000 + 14850) * 3 });
  });

  it("lists the latest enrollments, most recent first", async () => {
    const latest = await withSchool(ids.school, (tx) => lastEnrollments(tx, ids.season));
    expect(latest.map((d) => [d.students, d.payer, d.netPriceCents])).toEqual([
      ["Noé", "Test Famille", 14850],
      ["Zoé", "Test Famille", 11000],
    ]);
  });

  it("gives the headcount of each course", async () => {
    const courses = await withSchool(ids.school, (tx) => seasonCourses(tx, ids.season));
    const effective = Object.fromEntries(courses.map((c) => [c.id, c.enrolled]));
    expect(effective).toEqual({ [ids.jazz60]: 2, [ids.jazz45]: 1, [ids.classical60]: 0 });
  });
});

describe("Status at creation (#284)", () => {
  it("saves a trial enrollment priced like any other, without flagging the siblings' discounts", async () => {
    const entry = { ...childEntry([ids.zoe], [ids.classical60]), status: "trial" as const };
    const p = await withSchool(ids.school, (tx) => enrollmentPreview(tx, ids.payer, ids.season, entry, ENROLLED_ON));
    if (p.status !== "ok") throw new Error(p.message);
    // Priced with the active siblings (Noé), but a trial does not count as a sibling: nothing to flag.
    expect(p.newEnrollments[0].price).toMatchObject({ status: "ok", discountCents: 1100 });
    expect(p.existingImpacts).toEqual([]);
    const r = await withSchool(ids.school, (tx) =>
      saveEnrollment(tx, frontDesk, ids.payer, ids.season, entry, ENROLLED_ON),
    );
    if (!r.ok) throw new Error(r.message);
    const [row] = await admin`SELECT status, discount_cents FROM enrollment WHERE id = ${r.id}`;
    expect(row).toEqual({ status: "trial", discount_cents: 1100 });
    // Not counted in the active figures, listed with its status.
    expect(await withSchool(ids.school, (tx) => seasonFigures(tx, ids.season))).toMatchObject({ enrollments: 2 });
    const listed = await withSchool(ids.school, (tx) => seasonEnrollments(tx, { payerId: ids.payer }, ids.season));
    expect(listed.find((i) => i.id === r.id)).toMatchObject({ status: "trial", actions: { confirm: true } });
  });

  it("saves a waitlist enrollment, the default being « Inscrit »", async () => {
    const r = await withSchool(ids.school, (tx) =>
      saveEnrollment(
        tx,
        frontDesk,
        ids.otherPayer,
        ids.season,
        {
          ...childEntry([ids.foreign], [ids.jazz60]),
          status: "waitlist",
        },
        ENROLLED_ON,
      ),
    );
    if (!r.ok) throw new Error(r.message);
    expect((await admin`SELECT status FROM enrollment WHERE id = ${r.id}`)[0].status).toBe("waitlist");
    const d = await withSchool(ids.school, (tx) =>
      saveEnrollment(
        tx,
        frontDesk,
        ids.otherPayer,
        ids.season,
        childEntry([ids.foreign], [ids.classical60]),
        ENROLLED_ON,
      ),
    );
    if (!d.ok) throw new Error(d.message);
    expect((await admin`SELECT status FROM enrollment WHERE id = ${d.id}`)[0].status).toBe("active");
  });
});
