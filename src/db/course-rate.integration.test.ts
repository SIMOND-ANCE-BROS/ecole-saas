import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  courseRate,
  coursePay,
  coursesWithOwnRate,
  createCourse,
  logCourseRate,
  updateCourse,
  validCourseInput,
  type CourseInput,
} from "./courses";
import { updateInstructor, type InstructorInput } from "./instructors";
import { withSchool } from "./index";

/**
 * Instructor rate per course (#191), as the application runs it (app_user,
 * RLS). Fictitious data deleted at the end; the audit log being immutable,
 * the cleanup disables its trigger for the duration of an administration
 * transaction, as the other tests writing to it do.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const director = `tarif-direction-${suffix}`;
let school: string;
let otherSchool: string;
let season: string;
let hourly: string;
let flat: string;
let otherHourly: string;
let base: CourseInput;

const INSTRUCTOR = `(school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents, active)`;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ta-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`tb-${suffix}`}) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Zzfaux Test', ${`${director}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${director}, 'director')`;
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Studio') RETURNING id`;
  const teacher = async (schoolId: string, payMode: string, rate: number) =>
    (
      await admin.unsafe(
        `INSERT INTO instructor ${INSTRUCTOR} VALUES ($1, 'Zzfaux', 'Prof', 'employee', 'not_applicable', $2, $3, true)
         RETURNING id`,
        [schoolId, payMode, rate],
      )
    )[0].id as string;
  hourly = await teacher(school, "hourly", 3000);
  flat = await teacher(school, "monthly_flat", 120000);
  otherHourly = await teacher(otherSchool, "hourly", 2800);
  base = {
    discipline: { name: "Jazz" },
    room: { id: room.id },
    instructorId: hourly,
    type: "group",
    recurrence: "weekly",
    weekday: 2,
    startDate: null,
    endDate: null,
    dates: [],
    startTime: "18:00",
    durationMinutes: 60,
    ageMin: null,
    ageMax: null,
    level: null,
    maxCapacity: null,
    instructorRate: null,
  };
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of ["course_date", "course", "instructor", "room", "site", "discipline", "season", "member"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM "user" WHERE id = ${director}`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const create = async (entry: CourseInput) => {
  const r = await withSchool(school, (tx) => createCourse(tx, season, entry));
  if (!r.ok) throw new Error(r.message);
  return r.id;
};

describe("instructor rate per course (#191)", () => {
  it("reads the rate typed in euros as integer cents, empty as none", () => {
    const parse = (instructorRate: string | undefined) => validCourseInput.safeParse({ ...base, instructorRate });
    expect(parse("45,50").data?.instructorRate).toBe(4550);
    expect(parse(" 45 ").data?.instructorRate).toBe(4500);
    expect(parse("").data?.instructorRate).toBeNull();
    // Not sent (field not offered): left to the stored rate.
    expect(parse(undefined).data?.instructorRate).toBeUndefined();
    for (const wrong of ["abc", "-5", "45,505", "100001"]) expect(parse(wrong).success).toBe(false);
  });

  it("saves, changes and clears the course rate", async () => {
    const id = await create({ ...base, instructorRate: 4550 });
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toBe(4550);
    await withSchool(school, (tx) => updateCourse(tx, id, { ...base, instructorRate: 5000 }));
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toBe(5000);
    await withSchool(school, (tx) => updateCourse(tx, id, { ...base, instructorRate: null }));
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toBeNull();
  });

  it("refuses a course rate for a monthly flat instructor (#192)", async () => {
    const r = await withSchool(school, (tx) =>
      createCourse(tx, season, { ...base, instructorId: flat, instructorRate: 4000 }),
    );
    expect(r).toEqual({ ok: false, message: "Pas de tarif par cours pour un forfait mensuel." });
    expect(
      (await create({ ...base, instructorId: flat, weekday: 4, instructorRate: undefined })).length,
    ).toBeGreaterThan(0);
  });

  it("keeps the stored rate when the form does not send one, for the same instructor", async () => {
    const id = await create({ ...base, weekday: 6, instructorRate: 4200 });
    await withSchool(school, (tx) => updateCourse(tx, id, { ...base, weekday: 6, instructorRate: undefined }));
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toBe(4200);
  });

  it("on a change of instructor, keeps only a rate typed for the new one", async () => {
    const other = (
      await admin.unsafe(
        `INSERT INTO instructor ${INSTRUCTOR} VALUES ($1, 'Zzfaux', 'Autre', 'employee', 'not_applicable', 'hourly', 2500, true)
         RETURNING id`,
        [school],
      )
    )[0].id as string;
    const id = await create({ ...base, weekday: 7, instructorRate: 4200, instructorRateFor: hourly });
    const move = (instructorId: string, instructorRate: number | null | undefined, instructorRateFor?: string) =>
      withSchool(school, (tx) =>
        updateCourse(tx, id, { ...base, weekday: 7, instructorId, instructorRate, instructorRateFor }),
      );
    // The previous instructor's rate sent back by a stale form: dropped.
    expect(await move(other, 4200, hourly)).toMatchObject({ ok: true, instructorRateCents: null });
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toBeNull();
    // Back to the first instructor, then a new instructor with the same amount typed deliberately: kept.
    await move(hourly, 4200, hourly);
    expect(await move(other, 4200, other)).toMatchObject({ ok: true, instructorRateCents: 4200 });
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toBe(4200);
    // A monthly flat instructor: nothing sent, the previous instructor's rate is dropped.
    await move(flat, undefined);
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toBeNull();
  });

  it("refuses to change an instructor's pay mode while courses carry their own rate", async () => {
    const teacher = (
      await admin.unsafe(
        `INSERT INTO instructor ${INSTRUCTOR} VALUES ($1, 'Zzfaux', 'Mode', 'employee', 'not_applicable', 'hourly', 3000, true)
         RETURNING id`,
        [school],
      )
    )[0].id as string;
    const entry: InstructorInput = {
      firstName: "Mode",
      name: "Zzfaux",
      email: null,
      status: "employee",
      siren: null,
      vatRegime: "not_applicable",
      isOwner: false,
      payMode: "per_lesson",
      rateCents: 3000,
      active: true,
    };
    const id = await create({ ...base, instructorId: teacher, weekday: 1, startTime: "09:00", instructorRate: 4000 });
    await create({ ...base, instructorId: teacher, weekday: 1, startTime: "10:00", instructorRate: 4100 });
    expect(await withSchool(school, (tx) => updateInstructor(tx, teacher, entry))).toEqual({
      ok: false,
      message:
        "2 cours ont un tarif propre pour cet intervenant : videz ces tarifs dans les fiches des cours avant de changer son mode de rémunération.",
    });
    // Other changes still go through with the same pay mode.
    expect(
      await withSchool(school, (tx) => updateInstructor(tx, teacher, { ...entry, payMode: "hourly", rateCents: 3200 })),
    ).toEqual({ ok: true });
    await withSchool(school, (tx) =>
      updateCourse(tx, id, { ...base, instructorId: teacher, weekday: 1, startTime: "09:00", instructorRate: null }),
    );
    expect((await withSchool(school, (tx) => updateInstructor(tx, teacher, entry))).ok).toBe(false);
  });

  it("lists the instructor's courses with their own rate, and pay data, within the school only", async () => {
    const listed = await withSchool(school, (tx) => coursesWithOwnRate(tx, hourly));
    expect(listed.every((c) => typeof c.rateCents === "number")).toBe(true);
    expect(await withSchool(otherSchool, (tx) => coursesWithOwnRate(tx, hourly))).toEqual([]);
    const pay = await withSchool(school, (tx) => coursePay(tx, null));
    expect(pay.instructors[hourly]).toEqual({ payMode: "hourly", rateCents: 3000 });
    expect(pay.instructors[otherHourly]).toBeUndefined();
    expect(pay.rateCents).toBeNull();
  });

  it("records a rate change in the audit log, and nothing when it did not change", async () => {
    const id = await create({ ...base, weekday: 5, instructorRate: 3500 });
    const entries = () =>
      admin`SELECT action, before, after, actor IS NOT NULL AS has_actor FROM audit_log
        WHERE school_id = ${school} AND row_id = ${id} ORDER BY id`;
    const after = { instructorId: hourly, instructorRateCents: 3500 };
    await withSchool(school, (tx) => logCourseRate(tx, director, id, null, after));
    await withSchool(school, (tx) => logCourseRate(tx, director, id, after, after));
    await withSchool(school, (tx) =>
      logCourseRate(tx, director, id, after, { instructorId: hourly, instructorRateCents: null }),
    );
    // No rate before nor after: nothing to record, even for a new instructor.
    await withSchool(school, (tx) =>
      logCourseRate(
        tx,
        director,
        id,
        { instructorId: hourly, instructorRateCents: null },
        { instructorId: flat, instructorRateCents: null },
      ),
    );
    expect(await entries()).toEqual([
      { action: "insert", before: null, after, has_actor: true },
      { action: "update", before: after, after: { instructorId: hourly, instructorRateCents: null }, has_actor: true },
    ]);
  });
});
