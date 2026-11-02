import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { balanceOf } from "./payments";
import { once, storedWorkshopSignup } from "./submissions";
import { cancelWorkshopSignup, signUpForWorkshop, signupsOf, workshopChoices, type SignupInput } from "./workshops";
import { deleteCourse, entityLock, readCourse, updateCourse, validCourseInput } from "./courses";
import { deleteTreatment } from "./vat-treatments";
import { enrolledInCourse, scheduleCourse } from "./schedule";
import { readAttendance, saveAttendance, weekLessons } from "./lessons";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";
import { ALREADY_SIGNED_UP, NO_WORKSHOP_PRICE, REASON_REQUIRED } from "../domain/workshop/signup";

/**
 * Signing a payer's students up for a workshop (#297), as the application runs it (app_user,
 * RLS). Fictitious data deleted at the end; the audit log being append-only, the cleanup
 * disables its trigger for the duration of an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const frontDesk = `stage-accueil-${suffix}`;
const TODAY = "2026-11-02";
let school: string;
let otherSchool: string;
let entity: string;
let parent: string;
let child: string;
let sibling: string;
let stranger: string;
let workshop: string;
let unpriced: string;
let weekly: string;

const insertPerson = async (lastName: string, isStudent: boolean) =>
  (
    await admin`INSERT INTO person (school_id, last_name, first_name, is_student)
      VALUES (${school}, ${lastName}, 'Zzprénom', ${isStudent}) RETURNING id`
  )[0].id as string;

beforeAll(async () => {
  [{ id: school }] = await schoolWithDefaultEntity(admin, "Zz École A", `wsa-${suffix}`);
  [{ id: otherSchool }] = await schoolWithDefaultEntity(admin, "Zz École B", `wsb-${suffix}`);
  [{ id: entity }] = await admin`SELECT id FROM billing_entity WHERE school_id = ${school} AND is_default`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${frontDesk}, 'Zz Accueil', ${`${frontDesk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${frontDesk}, 'front_desk')`;
  const [season] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [d] =
    await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Zz Danse de mariage') RETURNING id`;
  const [site] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Zz Centre', '1 rue Zz') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${site.id}, 'Zz Studio') RETURNING id`;
  const [teacher] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${school}, 'Zzprof', 'Zz', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  const oneOff = async (price: number | null, capacity: number | null) => {
    const [c] =
      await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id,
        type, recurrence, weekday, start_time, duration_minutes, max_capacity, workshop_price_cents)
      VALUES (${school}, ${entity}, ${season.id}, ${d.id}, ${room.id}, ${teacher.id},
        'workshop', 'dates', NULL, '14:00', 120, ${capacity}, ${price}) RETURNING id`;
    await admin`INSERT INTO course_date (school_id, course_id, date) VALUES (${school}, ${c.id}, '2027-02-13')`;
    return c.id as string;
  };
  workshop = await oneOff(4000, 10);
  unpriced = await oneOff(null, null);
  [{ id: weekly }] =
    await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id,
      weekday, start_time, duration_minutes)
    VALUES (${school}, ${entity}, ${season.id}, ${d.id}, ${room.id}, ${teacher.id}, 3, '17:00', 60) RETURNING id`;
  parent = await insertPerson("Zzparent", false);
  child = await insertPerson("Zzenfant", true);
  sibling = await insertPerson("Zzsœur", true);
  stranger = await insertPerson("Zzautre", true);
  for (const student of [child, sibling])
    await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for)
      VALUES (${school}, ${parent}, ${student}, 'legal_guardian', true)`;
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of [
    "submission",
    "workshop_signup_person",
    "workshop_signup",
    "attendance",
    "lesson",
    "course_date",
    "course",
    "instructor",
    "room",
    "site",
    "discipline",
    "relationship",
    "season",
    "person",
    "member",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM "user" WHERE id = ${frontDesk}`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

// Each test starts with no sign-up: one failing never leaves its sign-up to the next ones.
afterEach(async () => {
  await admin`DELETE FROM workshop_signup WHERE school_id = ${school}`;
});

const entry = (s: Partial<SignupInput> = {}): SignupInput => ({
  courseId: workshop,
  participantIds: [child],
  priceCents: 4000,
  reason: "",
  ...s,
});
const signUp = (s: Partial<SignupInput> = {}, payer = parent) =>
  withSchool(school, (tx) => signUpForWorkshop(tx, frontDesk, payer, entry(s), TODAY));
const remaining = async (payer = parent) =>
  (await withSchool(school, (tx) => balanceOf(tx, payer, TODAY)))?.total.remaining ?? 0;
const cancel = (id: string) => withSchool(school, (tx) => cancelWorkshopSignup(tx, frontDesk, id));

describe("signing up for a workshop", () => {
  it("takes the workshop's price, business and VAT treatment, and raises the payer's balance by it", async () => {
    const before = await remaining();
    const r = await signUp();
    if (!r.ok) throw new Error(r.message);
    const [row] = await admin`SELECT s.billing_entity_id, s.vat_treatment_id = c.vat_treatment_id AS same_vat,
        s.unit_price_cents, s.price_reason, s.signed_up_on::text
      FROM workshop_signup s JOIN course c ON c.id = s.course_id WHERE s.id = ${r.id}`;
    expect(row).toEqual({
      billing_entity_id: entity,
      same_vat: true,
      unit_price_cents: 4000,
      price_reason: null,
      signed_up_on: TODAY,
    });
    expect(await remaining()).toBe(before + 4000);
    const [audit] =
      await admin`SELECT action, after FROM audit_log WHERE target_table = 'workshop_signup' AND row_id = ${r.id}`;
    expect(audit).toEqual({
      action: "insert",
      after: {
        courseId: workshop,
        payerId: parent,
        participantIds: [child],
        unitPriceCents: 4000,
        workshopPriceCents: 4000,
      },
    });
    await cancel(r.id);
  });

  it("charges two participants of the same payer twice the price, with no siblings discount", async () => {
    const before = await remaining();
    const r = await signUp({ participantIds: [child, sibling] });
    if (!r.ok) throw new Error(r.message);
    expect(await remaining()).toBe(before + 8000);
    for (const personId of [parent, child, sibling]) {
      const rows = await withSchool(school, (tx) => signupsOf(tx, personId));
      expect(rows.find((s) => s.id === r.id)).toMatchObject({ unitPriceCents: 4000, dueCents: 8000, payerId: parent });
    }
    expect(await withSchool(school, (tx) => signupsOf(tx, stranger))).toEqual([]);
    const [choice] = (await withSchool(school, (tx) => workshopChoices(tx, TODAY))).filter((w) => w.id === workshop);
    expect(choice).toMatchObject({ priceCents: 4000, maxCapacity: 10, participants: 2, dates: ["2027-02-13"] });
    await cancel(r.id);
  });

  it("asks a reason for another price and keeps it; a workshop without a price needs one typed", async () => {
    expect(await signUp({ priceCents: null })).toEqual({ ok: false, message: "Indiquez le prix." });
    expect(await signUp({ priceCents: 3000 })).toEqual({ ok: false, message: REASON_REQUIRED });
    const r = await signUp({ priceCents: 3000, reason: "Zz tarif réduit" });
    if (!r.ok) throw new Error(r.message);
    const [row] = await admin`SELECT unit_price_cents, price_reason FROM workshop_signup WHERE id = ${r.id}`;
    expect(row).toEqual({ unit_price_cents: 3000, price_reason: "Zz tarif réduit" });
    await cancel(r.id);
    expect(await signUp({ courseId: unpriced, priceCents: null })).toEqual({ ok: false, message: NO_WORKSHOP_PRICE });
    const typed = await signUp({ courseId: unpriced, priceCents: 2500 });
    if (!typed.ok) throw new Error(typed.message);
    await cancel(typed.id);
  });

  it("refuses a student already signed up, a student the payer does not pay for, and a course that is no workshop", async () => {
    const r = await signUp();
    if (!r.ok) throw new Error(r.message);
    expect(await signUp({ participantIds: [sibling, child] })).toEqual({ ok: false, message: ALREADY_SIGNED_UP });
    expect((await signUp({ participantIds: [stranger] })).ok).toBe(false);
    expect(await signUp({ courseId: weekly })).toEqual({ ok: false, message: "Ce stage n’existe plus." });
    await cancel(r.id);
  });

  it("signs up once per submission key: a retry after a lost response records nothing twice", async () => {
    const key = randomUUID();
    const run = () =>
      withSchool(school, (tx) =>
        once(tx, "workshop_signup", key, { payerId: parent, entry: entry() }, storedWorkshopSignup, () =>
          signUpForWorkshop(tx, frontDesk, parent, entry(), TODAY),
        ),
      );
    const first = await run();
    const second = await run();
    expect(second).toEqual(first);
    if (first.ok) await cancel(first.id);
  });
});

describe("cancelling a sign-up", () => {
  it("removes it from the balance and logs what it was; a second cancellation is refused", async () => {
    const before = await remaining();
    const r = await signUp({ participantIds: [child, sibling] });
    if (!r.ok) throw new Error(r.message);
    expect(await cancel(r.id)).toEqual({ ok: true });
    expect(await remaining()).toBe(before);
    expect(await admin`SELECT 1 FROM workshop_signup_person WHERE workshop_signup_id = ${r.id}`).toHaveLength(0);
    const [audit] =
      await admin`SELECT before FROM audit_log WHERE target_table = 'workshop_signup' AND row_id = ${r.id} AND action = 'delete'`;
    expect(audit.before).toMatchObject({ courseId: workshop, payerId: parent, unitPriceCents: 4000 });
    expect((await cancel(r.id)).ok).toBe(false);
  });
});

describe("a workshop with sign-ups", () => {
  it("keeps its type and its business while someone is signed up", async () => {
    const r = await signUp();
    if (!r.ok) throw new Error(r.message);
    const c = await withSchool(school, (tx) => readCourse(tx, workshop));
    if (!c) throw new Error("course missing");
    const input = validCourseInput.parse({
      discipline: { id: c.disciplineId },
      room: { id: c.roomId },
      instructorId: c.instructorId,
      type: "group",
      recurrence: "weekly",
      weekday: 6,
      startDate: null,
      endDate: null,
      dates: [],
      startTime: c.startTime,
      durationMinutes: c.durationMinutes,
      ageMin: null,
      ageMax: null,
      level: c.level,
      maxCapacity: c.maxCapacity,
    });
    expect(await withSchool(school, (tx) => updateCourse(tx, workshop, input))).toEqual({
      ok: false,
      message: "Ce stage a des inscrits : il reste un stage.",
    });
    expect(await withSchool(school, (tx) => entityLock(tx, workshop))).toMatch(/1 inscription/);
  });

  it("keeps the VAT treatment its sign-ups were sold with: deleting it is refused in French", async () => {
    const [{ id: sold }] = await admin`INSERT INTO vat_treatment (school_id, label, category, mention)
      VALUES (${school}, 'Zz vendu', 'exempt', 'Zz mention') RETURNING id`;
    const [{ current }] = await admin`SELECT vat_treatment_id AS current FROM course WHERE id = ${workshop}`;
    await admin`UPDATE course SET vat_treatment_id = ${sold} WHERE id = ${workshop}`;
    const r = await signUp();
    await admin`UPDATE course SET vat_treatment_id = ${current} WHERE id = ${workshop}`;
    if (!r.ok) throw new Error(r.message);
    expect((await withSchool(school, (tx) => deleteTreatment(tx, frontDesk, sold))).ok).toBe(false);
    await cancel(r.id);
    expect(await withSchool(school, (tx) => deleteTreatment(tx, frontDesk, sold))).toMatchObject({ ok: true });
  });

  it("cannot be deleted while someone is signed up", async () => {
    const r = await signUp();
    if (!r.ok) throw new Error(r.message);
    expect((await withSchool(school, (tx) => deleteCourse(tx, workshop))).ok).toBe(false);
    await cancel(r.id);
  });

  it("is refused by the database when the sign-up names another business, or a price sits on a regular course", async () => {
    const [{ id: other }] = await admin`INSERT INTO billing_entity (school_id, name, legal_name, vat_regime)
      VALUES (${school}, 'Zz Autre', 'Zz Autre', 'not_applicable') RETURNING id`;
    await expect(
      admin`INSERT INTO workshop_signup (school_id, billing_entity_id, course_id, payer_id, vat_treatment_id, unit_price_cents, signed_up_on)
        SELECT ${school}, ${other}, id, ${parent}, vat_treatment_id, 100, ${TODAY} FROM course WHERE id = ${workshop}`,
    ).rejects.toThrow(/workshop_signup_course_same_entity_fk/);
    await expect(admin`UPDATE course SET workshop_price_cents = 100 WHERE id = ${weekly}`).rejects.toThrow(
      /course_workshop_price/,
    );
  });

  it("is invisible from another school (RLS)", async () => {
    const r = await signUp();
    if (!r.ok) throw new Error(r.message);
    expect(await withSchool(otherSchool, (tx) => signupsOf(tx, parent))).toEqual([]);
    expect(await withSchool(otherSchool, (tx) => cancelWorkshopSignup(tx, frontDesk, r.id))).toMatchObject({
      ok: false,
    });
    await cancel(r.id);
  });
});

describe("a workshop's participants (#398)", () => {
  const workshopLesson = async () =>
    (
      await admin`INSERT INTO lesson (school_id, course_id, date, instructor_id, billing_entity_id)
        SELECT school_id, id, '2027-02-13', instructor_id, billing_entity_id FROM course WHERE id = ${workshop}
        ON CONFLICT (course_id, date) DO UPDATE SET status = 'planned' RETURNING id`
    )[0].id as string;
  const twoSignups = async () => {
    for (const student of [sibling, child]) {
      const r = await signUp({ participantIds: [student] });
      if (!r.ok) throw new Error(r.message);
    }
  };

  it("lists two signed-up students on the workshop's record with their payer, and counts them in its headcount", async () => {
    await twoSignups();
    const listed = await withSchool(school, (tx) => enrolledInCourse(tx, workshop, TODAY));
    expect(listed.map((l) => [l.studentId, l.name, l.payerId, l.payer, l.status, l.enrollmentDate])).toEqual([
      [child, "Zzenfant", parent, "Zzprénom Zzparent", "active", TODAY],
      [sibling, "Zzsœur", parent, "Zzprénom Zzparent", "active", TODAY],
    ]);
    expect((await withSchool(school, (tx) => scheduleCourse(tx, workshop)))?.enrolled).toBe(2);
    await workshopLesson();
    const week = await withSchool(school, (tx) => weekLessons(tx, "2027-02-08"));
    expect(week.find((l) => l.courseId === workshop)?.enrolled).toBe(2);
  });

  it("names them on the attendance sheet of its lesson, whose attendance can be taken for them", async () => {
    await twoSignups();
    const lessonId = await workshopLesson();
    const sheet = await withSchool(school, (tx) => readAttendance(tx, lessonId));
    expect(sheet?.students.map((d) => [d.id, d.present])).toEqual([
      [child, null],
      [sibling, null],
    ]);
    const saved = await withSchool(school, (tx) =>
      saveAttendance(tx, lessonId, [
        { studentId: child, present: true },
        { studentId: sibling, present: false },
      ]),
    );
    expect(saved).toMatchObject({ ok: true });
    const after = await withSchool(school, (tx) => readAttendance(tx, lessonId));
    expect(after?.students.map((d) => [d.id, d.present])).toEqual([
      [child, true],
      [sibling, false],
    ]);
    await admin`DELETE FROM attendance WHERE lesson_id = ${lessonId}`;
  });

  it("drops a cancelled sign-up from the list and the headcount", async () => {
    const r = await signUp({ participantIds: [child, sibling] });
    if (!r.ok) throw new Error(r.message);
    await cancel(r.id);
    expect(await withSchool(school, (tx) => enrolledInCourse(tx, workshop, TODAY))).toEqual([]);
    expect((await withSchool(school, (tx) => scheduleCourse(tx, workshop)))?.enrolled).toBe(0);
  });

  it("shows nothing of them to another school (RLS)", async () => {
    await twoSignups();
    const lessonId = await workshopLesson();
    expect(await withSchool(otherSchool, (tx) => enrolledInCourse(tx, workshop, TODAY))).toEqual([]);
    expect(await withSchool(otherSchool, (tx) => readAttendance(tx, lessonId))).toBeNull();
  });
});
