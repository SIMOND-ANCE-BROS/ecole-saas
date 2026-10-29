import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  courseOwnRate,
  courseRate,
  courseRateState,
  coursePay,
  instructorCourseRates,
  createCourse,
  logCourseRate,
  updateCourse,
  validCourseInput,
  type CourseInput,
} from "./courses";
import { updateInstructor, type InstructorInput } from "./instructors";
import { withSchool } from "./index";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";

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
let roomId: string;

/** Fixed "today" in the current test season, so the past / current season split does not depend on the clock. */
const TODAY = "2026-10-29";
const INSTRUCTOR = `(school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents, active)`;

beforeAll(async () => {
  [{ id: school }] = await schoolWithDefaultEntity(admin, "École A", `ta-${suffix}`);
  [{ id: otherSchool }] = await schoolWithDefaultEntity(admin, "École B", `tb-${suffix}`);
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
    room: { id: (roomId = room.id) },
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
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toEqual({ cents: 4550, payMode: "hourly" });
    await withSchool(school, (tx) => updateCourse(tx, id, { ...base, instructorRate: 5000 }));
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toEqual({ cents: 5000, payMode: "hourly" });
    await withSchool(school, (tx) => updateCourse(tx, id, { ...base, instructorRate: null }));
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toBeNull();
  });

  it("refuses a course rate for a monthly flat instructor (#192)", async () => {
    const r = await withSchool(school, (tx) =>
      createCourse(tx, season, { ...base, instructorId: flat, instructorRate: 4000 }),
    );
    expect(r).toEqual({
      ok: false,
      message: "Pas de tarif par cours pour un forfait mensuel pour l’instant (règle en attente).",
    });
    expect(
      (await create({ ...base, instructorId: flat, weekday: 4, instructorRate: undefined })).length,
    ).toBeGreaterThan(0);
  });

  it("keeps the stored rate when the form does not send one, for the same instructor", async () => {
    const id = await create({ ...base, weekday: 6, instructorRate: 4200 });
    await withSchool(school, (tx) => updateCourse(tx, id, { ...base, weekday: 6, instructorRate: undefined }));
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toEqual({ cents: 4200, payMode: "hourly" });
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
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toEqual({ cents: 4200, payMode: "hourly" });
    // A monthly flat instructor: nothing sent, the previous instructor's rate is dropped.
    await move(flat, undefined);
    expect(await withSchool(school, (tx) => courseRate(tx, id))).toBeNull();
    // Another hourly instructor, nothing sent: neither amount nor unit is left (#268).
    await move(hourly, 4200, hourly);
    await move(other, undefined);
    const [row] = await admin`SELECT instructor_rate_cents AS cents, instructor_rate_pay_mode AS unit
      FROM course WHERE id = ${id}`;
    expect({ ...row }).toEqual({ cents: null, unit: null });
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
    expect(await withSchool(school, (tx) => updateInstructor(tx, teacher, entry, TODAY))).toEqual({
      ok: false,
      message:
        "2 cours de la saison 2026-2027 ont un tarif propre pour cet intervenant : videz ces tarifs dans les fiches des cours avant de changer son mode de rémunération.",
    });
    // Other changes still go through with the same pay mode.
    expect(
      await withSchool(school, (tx) =>
        updateInstructor(tx, teacher, { ...entry, payMode: "hourly", rateCents: 3200 }, TODAY),
      ),
    ).toEqual({ ok: true });
    await withSchool(school, (tx) =>
      updateCourse(tx, id, { ...base, instructorId: teacher, weekday: 1, startTime: "09:00", instructorRate: null }),
    );
    expect((await withSchool(school, (tx) => updateInstructor(tx, teacher, entry, TODAY))).ok).toBe(false);
  });

  it("lets past-season course rates not block a pay mode change, the current and future ones still do (#192 Q5)", async () => {
    const teacher = (
      await admin.unsafe(
        `INSERT INTO instructor ${INSTRUCTOR} VALUES ($1, 'Zzfaux', 'Saisons', 'employee', 'not_applicable', 'hourly', 3000, true)
         RETURNING id`,
        [school],
      )
    )[0].id as string;
    const seasonOf = async (label: string, start: string, end: string) =>
      (
        await admin`INSERT INTO season (school_id, label, start_date, end_date)
          VALUES (${school}, ${label}, ${start}, ${end}) RETURNING id`
      )[0].id as string;
    const past = await seasonOf("2025-2026", "2025-09-01", "2026-06-30");
    const future = await seasonOf("2027-2028", "2027-09-01", "2028-06-30");
    const createIn = async (seasonId: string, entry: CourseInput) => {
      const r = await withSchool(school, (tx) => createCourse(tx, seasonId, entry));
      if (!r.ok) throw new Error(r.message);
      return r.id;
    };
    const entry = (payMode: InstructorInput["payMode"]): InstructorInput => ({
      firstName: "Saisons",
      name: "Zzfaux",
      email: null,
      status: "employee",
      siren: null,
      vatRegime: "not_applicable",
      isOwner: false,
      payMode,
      rateCents: 3000,
      active: true,
    });
    const change = (payMode: InstructorInput["payMode"]) =>
      withSchool(school, (tx) => updateInstructor(tx, teacher, entry(payMode), TODAY));

    // A rate on a course of a season that ended: the change goes through, the rate is kept as history,
    // in the unit it was typed in (#268).
    const old = await createIn(past, { ...base, instructorId: teacher, weekday: 3, instructorRate: 4000 });
    expect(await change("per_lesson")).toEqual({ ok: true });
    expect(await withSchool(school, (tx) => courseRate(tx, old))).toEqual({ cents: 4000, payMode: "hourly" });
    expect(await withSchool(school, (tx) => courseOwnRate(tx, old))).toEqual({
      cents: 4000,
      payMode: "hourly",
      current: false,
    });
    const listed = (await withSchool(school, (tx) => instructorCourseRates(tx, teacher))).filter((c) => c.rate);
    expect(listed.map((c) => c.rate)).toEqual([{ cents: 4000, payMode: "hourly" }]);
    expect((await withSchool(school, (tx) => coursePay(tx, old))).rate).toEqual({ cents: 4000, payMode: "hourly" });

    // Saved again as the action does it (rate, then audit entry when it changed).
    const resave = (instructorRate: number | null | undefined, instructorRateUnit?: InstructorInput["payMode"]) =>
      withSchool(school, async (tx) => {
        const before = await courseRateState(tx, old);
        const r = await updateCourse(tx, old, {
          ...base,
          instructorId: teacher,
          weekday: 3,
          instructorRate,
          instructorRateFor: teacher,
          instructorRateUnit,
        });
        const after = r.ok ? await courseRateState(tx, old) : null;
        if (after) await logCourseRate(tx, director, old, before, after);
        return r;
      });
    const audited = async () =>
      (await admin`SELECT count(*)::int AS n FROM audit_log WHERE row_id = ${old}`)[0].n as number;
    const hourlyKept = { cents: 4000, payMode: "hourly" };
    // Left untouched in the form (not sent), or sent back by a stale form, with or without its unit:
    // kept in its own unit, and no audit entry since nothing changed.
    expect(await resave(undefined)).toMatchObject({ ok: true, instructorRateCents: 4000 });
    expect(await withSchool(school, (tx) => courseRate(tx, old))).toEqual(hourlyKept);
    expect(await resave(4000)).toMatchObject({ ok: true });
    expect(await withSchool(school, (tx) => courseRate(tx, old))).toEqual(hourlyKept);
    expect(await resave(4000, "hourly")).toMatchObject({ ok: true });
    expect(await withSchool(school, (tx) => courseRate(tx, old))).toEqual(hourlyKept);
    expect(await audited()).toBe(0);
    // Another amount typed in the old unit (a form opened before the change): refused.
    expect(await resave(4100, "hourly")).toEqual({
      ok: false,
      message:
        "Le mode de rémunération de cet intervenant a changé : rechargez la page pour saisir le tarif dans la bonne unité.",
    });
    expect(await withSchool(school, (tx) => courseRate(tx, old))).toEqual(hourlyKept);
    // The same amount converted on purpose: now per lesson, and logged.
    await resave(4000, "per_lesson");
    expect(await withSchool(school, (tx) => courseRate(tx, old))).toEqual({ cents: 4000, payMode: "per_lesson" });
    expect(await audited()).toBe(1);
    // A new amount is typed in the current pay mode.
    await resave(4200, "per_lesson");
    expect(await withSchool(school, (tx) => courseOwnRate(tx, old))).toEqual({
      cents: 4200,
      payMode: "per_lesson",
      current: true,
    });
    // Cleared: neither amount nor unit.
    await resave(null);
    const [cleared] = await admin`SELECT instructor_rate_cents AS cents, instructor_rate_pay_mode AS unit
      FROM course WHERE id = ${old}`;
    expect({ ...cleared }).toEqual({ cents: null, unit: null });

    // A rate on a course of the current season still blocks, naming that season only.
    await createIn(season, { ...base, instructorId: teacher, weekday: 3, instructorRate: 4500 });
    expect(await change("hourly")).toEqual({
      ok: false,
      message:
        "1 cours de la saison 2026-2027 a un tarif propre pour cet intervenant : videz ce tarif dans la fiche du cours avant de changer son mode de rémunération.",
    });

    // A future season counts too.
    await createIn(future, { ...base, instructorId: teacher, weekday: 3, instructorRate: 4600 });
    expect(await change("hourly")).toEqual({
      ok: false,
      message:
        "2 cours des saisons 2026-2027 et 2027-2028 ont un tarif propre pour cet intervenant : videz ces tarifs dans les fiches des cours avant de changer son mode de rémunération.",
    });
  });

  it("stores a unit with every rate and only then; migration 0036 fills it from the instructor's pay mode (#268)", async () => {
    const [{ id: discipline }] =
      await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Zzunité') RETURNING id`;
    const insert = (t: postgres.TransactionSql, instructorId: string, cents: number | null, unit: string | null) =>
      t`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time,
          duration_minutes, instructor_rate_cents, instructor_rate_pay_mode)
        VALUES (${school}, (SELECT id FROM billing_entity WHERE school_id = ${school} AND is_default), ${season}, ${discipline}, ${roomId}, ${instructorId}, 4, '08:00', 60, ${cents}, ${unit})
        RETURNING id`;
    const refused = async (cents: number | null, unit: string | null) => {
      try {
        await admin.begin((t) => insert(t, hourly, cents, unit));
        return false;
      } catch (e) {
        return (e as { constraint_name?: string }).constraint_name === "course_instructor_rate_unit";
      }
    };
    expect(await refused(4000, null)).toBe(true);
    expect(await refused(null, "hourly")).toBe(true);

    // The backfill of the migration, on rows written as before it, in a transaction rolled back.
    const sql = readFileSync(join(process.cwd(), "migrations/0036_course_instructor_rate_unit.sql"), "utf8");
    const backfill = sql.split("--> statement-breakpoint").find((s) => s.includes("UPDATE"));
    if (!backfill) throw new Error("No backfill in migration 0036");
    const ROLLBACK = new Error("rollback");
    let filled: Record<string, unknown>[] = [];
    await admin
      .begin(async (t) => {
        await t`ALTER TABLE course DROP CONSTRAINT course_instructor_rate_unit`;
        const [a] = await insert(t, hourly, 4000, null);
        const [b] = await insert(t, flat, 3000, null);
        const [c] = await insert(t, hourly, null, null);
        await t.unsafe(backfill);
        filled = await t`SELECT id, instructor_rate_cents AS cents, instructor_rate_pay_mode AS unit FROM course
          WHERE id IN (${a.id}, ${b.id}, ${c.id})`;
        filled = filled.map((r) => ({ ...r, id: [a.id, b.id, c.id].indexOf(r.id) }));
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
    expect(filled.sort((x, y) => Number(x.id) - Number(y.id))).toEqual([
      { id: 0, cents: 4000, unit: "hourly" },
      { id: 1, cents: 3000, unit: "monthly_flat" },
      { id: 2, cents: null, unit: null },
    ]);
  });

  it("lists the instructor's courses with their own rate if any, and pay data, within the school only", async () => {
    const listed = await withSchool(school, (tx) => instructorCourseRates(tx, hourly));
    expect(listed.some((c) => c.rate !== null) && listed.some((c) => c.rate === null)).toBe(true);
    expect(await withSchool(otherSchool, (tx) => instructorCourseRates(tx, hourly))).toEqual([]);
    const pay = await withSchool(school, (tx) => coursePay(tx, null));
    expect(pay.instructors[hourly]).toEqual({ payMode: "hourly", rateCents: 3000 });
    expect(pay.instructors[otherHourly]).toBeUndefined();
    expect(pay.rate).toBeNull();
  });

  it("records a rate change in the audit log, and nothing when it did not change", async () => {
    const id = await create({ ...base, weekday: 5, instructorRate: 3500 });
    const entries = () =>
      admin`SELECT action, before, after, actor IS NOT NULL AS has_actor FROM audit_log
        WHERE school_id = ${school} AND row_id = ${id} ORDER BY id`;
    const after = { instructorId: hourly, instructorRateCents: 3500, instructorRatePayMode: "hourly" as const };
    const none = { instructorId: hourly, instructorRateCents: null, instructorRatePayMode: null };
    const sameAmountPerLesson = { ...after, instructorRatePayMode: "per_lesson" as const };
    await withSchool(school, (tx) => logCourseRate(tx, director, id, null, after));
    await withSchool(school, (tx) => logCourseRate(tx, director, id, after, after));
    // The same amount in another unit is another rate (#268).
    await withSchool(school, (tx) => logCourseRate(tx, director, id, after, sameAmountPerLesson));
    await withSchool(school, (tx) => logCourseRate(tx, director, id, sameAmountPerLesson, none));
    // No rate before nor after, same instructor: nothing to record.
    await withSchool(school, (tx) => logCourseRate(tx, director, id, none, none));
    // A new instructor without a rate is recorded: the monthly statement flags it (#285).
    await withSchool(school, (tx) => logCourseRate(tx, director, id, none, { ...none, instructorId: flat }));
    expect(await entries()).toEqual([
      { action: "insert", before: null, after, has_actor: true },
      { action: "update", before: after, after: sameAmountPerLesson, has_actor: true },
      { action: "update", before: sameAmountPerLesson, after: none, has_actor: true },
      { action: "update", before: none, after: { ...none, instructorId: flat }, has_actor: true },
    ]);
  });
});
