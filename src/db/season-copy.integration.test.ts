import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { syncLessons } from "./lessons";
import { copySeason, seasonCopyPlan } from "./season-copy";

/**
 * Copy of a season's planning (#190), as the application runs it (app_user,
 * RLS). Fictitious data deleted at the end; the audit log being immutable,
 * the cleanup disables its trigger for the duration of an administration
 * transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const director = `copie-direction-${suffix}`;
const frontDesk = `copie-accueil-${suffix}`;
const TODAY = "2026-10-27";
let school: string;
let otherSchool: string;
let source: string;
let target: string;
let foreignSeason: string;
let weekly: string;
let gone: string;
let competition: string;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ca-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`cb-${suffix}`}) RETURNING id`;
  for (const [id, role] of [
    [director, "director"],
    [frontDesk, "front_desk"],
  ]) {
    await admin`INSERT INTO "user" (id, name, email) VALUES (${id}, 'Zzfaux Test', ${`${id}@exemple.test`})`;
    await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${id}, ${role})`;
  }
  [{ id: source }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: target }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2027-2028', '2027-09-01', '2028-06-30') RETURNING id`;
  [{ id: foreignSeason }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${otherSchool}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;

  const place = async (schoolId: string) => {
    const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${schoolId}, 'Jazz') RETURNING id`;
    const [s] =
      await admin`INSERT INTO site (school_id, name, address) VALUES (${schoolId}, 'Site Centre', '1 rue Test') RETURNING id`;
    const [r] =
      await admin`INSERT INTO room (school_id, site_id, name) VALUES (${schoolId}, ${s.id}, 'Salle 1') RETURNING id`;
    const teacher = async (active: boolean) =>
      (
        await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents, active)
          VALUES (${schoolId}, 'Zzfaux', 'Prof', 'employee', 'not_applicable',
            ${active ? "hourly" : "monthly_flat"}, 3000, ${active}) RETURNING id`
      )[0].id as string;
    return {
      discipline: d.id as string,
      room: r.id as string,
      active: await teacher(true),
      inactive: await teacher(false),
    };
  };
  const a = await place(school);
  const b = await place(otherSchool);
  const insertCourse = async (
    schoolId: string,
    seasonId: string,
    p: typeof a,
    instructorId: string,
    weekday: number | null,
    time: string,
    period: [string, string] | null = null,
  ) =>
    (
      await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, recurrence, weekday,
          start_date, end_date, start_time, duration_minutes, level, age_min, age_max, max_capacity)
        VALUES (${schoolId}, ${seasonId}, ${p.discipline}, ${p.room}, ${instructorId},
          ${weekday === null ? "dates" : "weekly"}, ${weekday}, ${period?.[0] ?? null}, ${period?.[1] ?? null},
          ${time}, 60, 'Débutant', 8, 10, 12) RETURNING id`
    )[0].id as string;

  weekly = await insertCourse(school, source, a, a.active, 1, "17:00", ["2026-10-01", "2027-03-31"]);
  gone = await insertCourse(school, source, a, a.inactive, 3, "18:00");
  // A course rate its monthly flat instructor does not use (written before #191's checks, or imported).
  await admin`UPDATE course SET instructor_rate_cents = 3000, instructor_rate_pay_mode = 'monthly_flat' WHERE id = ${gone}`;
  const workshop = await insertCourse(school, source, a, a.active, null, "14:00");
  await admin`INSERT INTO course_date (school_id, course_id, date) VALUES (${school}, ${workshop}, '2027-02-13')`;
  // Every column away from the defaults: type, recurrence, ages, level and places left empty, length,
  // the instructor's own rate for the course (#191).
  [{ id: competition }] = await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id,
      type, recurrence, weekday, start_time, duration_minutes, level, age_min, age_max, max_capacity,
      instructor_rate_cents, instructor_rate_pay_mode)
    VALUES (${school}, ${source}, ${a.discipline}, ${a.room}, ${a.active},
      'competition', 'biweekly', 6, '10:30', 90, NULL, 14, 25, NULL, 4550, 'hourly') RETURNING id`;
  await insertCourse(otherSchool, foreignSeason, b, b.active, 2, "19:00");
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of ["lesson", "course_date", "course", "instructor", "room", "site", "discipline", "season", "member"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM "user" WHERE id IN (${director}, ${frontDesk})`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("copy of a season's planning (#190)", () => {
  it("plans the regular courses, skips the one-off ones and flags what to check", async () => {
    const r = await withSchool(school, (tx) => seasonCopyPlan(tx, source, target));
    if (!r.ok) throw new Error(r.message);
    expect(r.plan.copied.map((c) => c.id).sort()).toEqual([weekly, gone, competition].sort());
    expect(r.plan.oneOff).toHaveLength(1);
    expect(r.plan.check.inactiveInstructor.map((c) => c.id)).toEqual([gone]);
    expect(r.plan.check.periodDropped.map((c) => c.id)).toEqual([weekly]);
    expect(r.plan.check.biweekly.map((c) => c.id)).toEqual([competition]);
    expect(r.targetCourses).toBe(0);
  });

  it("refuses the same season, or a season of another school, as source or target", async () => {
    const plan = (from: string, to: string) => withSchool(school, (tx) => seasonCopyPlan(tx, from, to));
    expect(await plan(source, source)).toMatchObject({ ok: false });
    expect(await plan(foreignSeason, target)).toEqual({ ok: false, message: "Choisissez la saison à copier." });
    expect(await plan(source, foreignSeason)).toEqual({ ok: false, message: "Cette saison n’existe plus." });
    expect(await withSchool(school, (tx) => copySeason(tx, director, foreignSeason, target))).toMatchObject({
      ok: false,
    });
  });

  it("is refused to the front desk", async () => {
    expect(await withSchool(school, (tx) => copySeason(tx, frontDesk, source, target))).toEqual({
      ok: false,
      message: "Accès refusé.",
    });
  });

  it("copies everything but the dates, logs each course and generates its lessons", async () => {
    const r = await withSchool(school, async (tx) => {
      const c = await copySeason(tx, director, source, target);
      if (c.ok) await syncLessons(tx, target, TODAY);
      return c;
    });
    expect(r).toMatchObject({ ok: true, copied: 3 });

    // Each copy against its source, column by column: only the id, the season and the period differ.
    const pairs = await admin`
      SELECT to_jsonb(s) AS source, to_jsonb(c) AS copy,
             (SELECT count(*)::int FROM lesson l WHERE l.course_id = c.id) AS lessons
      FROM audit_log a
      JOIN course c ON c.id = a.row_id
      JOIN course s ON s.id = (a.after->>'copiedFrom')::uuid
      WHERE a.school_id = ${school} AND a.target_table = 'course'`;
    expect(pairs).toHaveLength(3);
    for (const { source: from, copy } of pairs) {
      const differ = Object.keys(from).filter((k) => JSON.stringify(from[k]) !== JSON.stringify(copy[k]));
      // The monthly flat instructor's unused course rate is not carried over (#191).
      const unusedRate = from.id === gone ? ["instructor_rate_cents", "instructor_rate_pay_mode"] : [];
      expect(differ.sort()).toEqual(
        [
          "id",
          "season_id",
          ...(from.start_date ? ["start_date"] : []),
          ...(from.end_date ? ["end_date"] : []),
          ...unusedRate,
        ].sort(),
      );
      expect(copy.season_id).toBe(target);
      expect([copy.start_date, copy.end_date]).toEqual([null, null]);
      if (from.id === gone) expect(copy.instructor_rate_cents).toBeNull();
      if (from.id === competition)
        expect([copy.instructor_rate_cents, copy.instructor_rate_pay_mode]).toEqual([4550, "hourly"]);
    }
    // Lessons generated over the whole season: about 40 weeks, 20 for every other week.
    expect(pairs.map((p) => p.lessons).every((n) => n >= 15)).toBe(true);

    const log = await admin`
      SELECT row_id, after->>'copiedFrom' AS "from", actor IS NOT NULL AS signed
      FROM audit_log WHERE school_id = ${school} AND target_table = 'course' AND action = 'insert'`;
    expect(log.map((l) => l.from).sort()).toEqual([weekly, gone, competition].sort());
    expect(log.every((l) => l.signed)).toBe(true);
  });

  it("adds nothing on a second copy", async () => {
    const plan = await withSchool(school, (tx) => seasonCopyPlan(tx, source, target));
    expect(plan).toMatchObject({ ok: true, targetCourses: 3 });
    if (plan.ok) expect(plan.plan.alreadyThere).toHaveLength(3);
    expect(await withSchool(school, (tx) => copySeason(tx, director, source, target))).toEqual({
      ok: false,
      message: "Aucun cours à copier.",
    });
  });

  it("leaves the other school untouched", async () => {
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM course WHERE school_id = ${otherSchool}`;
    expect(n).toBe(1);
  });
});

describe("copy of course rates after a pay mode change (#268)", () => {
  it("carries a rate only in the instructor's current unit, and says which ones it drops", async () => {
    const seasonOf = async (label: string, start: string, end: string) =>
      (
        await admin`INSERT INTO season (school_id, label, start_date, end_date)
          VALUES (${school}, ${label}, ${start}, ${end}) RETURNING id`
      )[0].id as string;
    const from = await seasonOf("2028-2029", "2028-09-01", "2029-06-30");
    const to = await seasonOf("2029-2030", "2029-09-01", "2030-06-30");
    const [{ discipline, room }] = await admin`
      SELECT c.discipline_id AS discipline, c.room_id AS room FROM course c WHERE c.id = ${weekly}`;
    const teacher = async (payMode: string) =>
      (
        await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
          VALUES (${school}, 'Zzfaux', 'Mode', 'employee', 'not_applicable', ${payMode}, 3000) RETURNING id`
      )[0].id as string;
    const changed = await teacher("hourly");
    const kept = await teacher("per_lesson");
    const rated = async (instructorId: string, weekday: number, cents: number, unit: string) =>
      (
        await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday,
            start_time, duration_minutes, instructor_rate_cents, instructor_rate_pay_mode)
          VALUES (${school}, ${from}, ${discipline}, ${room}, ${instructorId}, ${weekday}, '20:00', 60, ${cents}, ${unit})
          RETURNING id`
      )[0].id as string;
    const hourlyRate = await rated(changed, 1, 4550, "hourly");
    const perLessonRate = await rated(kept, 2, 5000, "per_lesson");
    // The instructor is now paid by the lesson: their hourly rate is history of that season (#192 Q5).
    await admin`UPDATE instructor SET pay_mode = 'per_lesson' WHERE id = ${changed}`;

    const plan = await withSchool(school, (tx) => seasonCopyPlan(tx, from, to));
    if (!plan.ok) throw new Error(plan.message);
    const planned = (id: string) => plan.plan.copied.find((c) => c.id === id);
    expect(planned(hourlyRate)).toMatchObject({
      instructorRateCents: null,
      instructorRatePayMode: null,
      oldUnitRate: { cents: 4550, payMode: "hourly" },
    });
    expect(planned(perLessonRate)).toMatchObject({
      instructorRateCents: 5000,
      instructorRatePayMode: "per_lesson",
      oldUnitRate: null,
    });

    expect(await withSchool(school, (tx) => copySeason(tx, director, from, to))).toMatchObject({ ok: true, copied: 2 });
    const copies = await admin`
      SELECT instructor_id, instructor_rate_cents AS cents, instructor_rate_pay_mode AS unit
      FROM course WHERE season_id = ${to} ORDER BY weekday`;
    expect(copies.map((c) => ({ ...c }))).toEqual([
      // Not carried as 45,50 € per lesson: no rate, the instructor's default one applies.
      { instructor_id: changed, cents: null, unit: null },
      { instructor_id: kept, cents: 5000, unit: "per_lesson" },
    ]);
    // The source season keeps its rate in its own unit.
    const [old] = await admin`SELECT instructor_rate_cents AS cents, instructor_rate_pay_mode AS unit
      FROM course WHERE id = ${hourlyRate}`;
    expect({ ...old }).toEqual({ cents: 4550, unit: "hourly" });
  });
});
