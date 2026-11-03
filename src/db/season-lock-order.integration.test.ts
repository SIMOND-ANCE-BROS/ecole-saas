import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";
import { createCourse, deleteCourse, lockCourse, moveCourse, updateCourse, type CourseInput } from "./courses";
import { cancelEnrollment } from "./enrollments";
import { withSchool } from "./index";
import { addClosure, moveLesson, restoreLesson, syncLessons, type validClosureInput } from "./lessons";
import type { z } from "zod";

/**
 * One lock order for the schedule (#415, `attendance-locks.ts`): the season, then the courses by
 * id, then the lessons. Each case meets a closure's sync, which holds the season and then locks
 * the season's courses, with a write of a course of that season, in real concurrent transactions
 * (app_user, RLS). Before #415 each of them ended in a deadlock (40P01). Each case has a season
 * of its own, so a closure covers only its courses. Fictitious data deleted at the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const desk = `compte-ordre-${suffix}`;
const TODAY = "2026-11-02"; // a Monday
// The closure of every case: Monday 16 and Tuesday 17 November.
const CLOSED = { start: "2026-11-16", end: "2026-11-17" };
let school: string;
let room: string;
let teacher: string;
let payer: string;
let student: string;
let base: CourseInput;
let seasons = 0;

beforeAll(async () => {
  [{ id: school }] = await schoolWithDefaultEntity(admin, "Zz École ordre", `zzo-${suffix}`);
  await admin`INSERT INTO "user" (id, name, email) VALUES (${desk}, 'Zz Accueil', ${`${desk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${desk}, 'front_desk')`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Zz Centre', '1 rue Zz') RETURNING id`;
  [{ id: room }] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Zz Studio') RETURNING id`;
  [{ id: teacher }] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${school}, 'Zzprof', 'Zzprénom', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  [{ id: payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzparent', 'Zzprénom') RETURNING id`;
  [{ id: student }] =
    await admin`INSERT INTO person (school_id, last_name, first_name, is_student) VALUES (${school}, 'Zzélève', 'Zzprénom', true) RETURNING id`;
  base = {
    discipline: { name: "Zz Jazz" },
    room: { id: room },
    instructorId: teacher,
    type: "group",
    recurrence: "weekly",
    weekday: 1,
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
    await t`DELETE FROM audit_log WHERE school_id = ${school}`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of [
    "enrollment_course",
    "enrollment",
    "closure",
    "suspended_lesson",
    "lesson",
    "course_date",
    "course",
    "discipline",
    "person",
    "instructor",
    "room",
    "site",
    "season",
    "member",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  await admin`DELETE FROM "user" WHERE id = ${desk}`;
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

/** A season of its own, with courses on Mondays (or the given weekdays) and their lessons. */
async function newSeason(weekdays: number[] = [1]) {
  seasons += 1;
  const [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, ${`Zz saison ${seasons}`}, '2026-09-01', '2027-06-30') RETURNING id`;
  const courses: string[] = [];
  for (const weekday of weekdays) {
    const r = await withSchool(school, (tx) => createCourse(tx, season, { ...base, weekday }));
    if (!r.ok) throw new Error(r.message);
    courses.push(r.id);
  }
  await withSchool(school, (tx) => syncLessons(tx, season, TODAY));
  return { season: season as string, courses };
}

const lessonOn = async (courseId: string, date: string) =>
  (await admin`SELECT id FROM lesson WHERE course_id = ${courseId} AND date = ${date}`)[0]?.id as string | undefined;

/** A closure added and its sync, as the closures page does (`close`). */
const closeAndSync = (season: string, entry: z.input<typeof validClosureInput>) =>
  withSchool(school, async (tx) => {
    const r = await addClosure(tx, season, entry);
    if (!r.ok) return r;
    return { ok: true as const, ...(await syncLessons(tx, season, TODAY, undefined, CLOSED)) };
  });
const wholeSchool = { scope: "school" as const, label: "Zz pont", ...CLOSED };

/** Returns once `waiters` other sessions wait on a lock. */
async function untilWaiting(t: postgres.TransactionSql, waiters: number) {
  for (let i = 0; i < 100; i++) {
    // Statistics are a snapshot per transaction: cleared, each read sees the sessions now.
    await t`SELECT pg_stat_clear_snapshot()`;
    const [{ n }] = await t`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND datname = current_database() AND pid <> pg_backend_pid()`;
    if (n >= waiters) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the calls never waited on the lock");
}

/** Postgres error code of a failed call, Drizzle wrapping the driver's error as its cause. */
const codeOf = (error: unknown) => (error as { cause?: { code?: string } }).cause?.code ?? String(error);

/** A call's outcome, its error kept by code: a deadlock rejects with 40P01. */
type Settled<T> = Promise<{ value: T } | { error: unknown }>;
const settle = <T>(p: Promise<T>): Settled<T> =>
  p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error: codeOf(error) }),
  );

/**
 * The admin connection holds the season `FOR SHARE`, which `FOR NO KEY UPDATE` waits for and
 * `KEY SHARE` lets through. `first` starts and waits for the season; `second` starts behind it and
 * goes as far as it can. Once both wait, the season is released: `first` gets it first.
 */
async function meet<A, B>(season: string, first: () => Promise<A>, second: () => Promise<B>) {
  let a: Settled<A> | undefined;
  let b: Settled<B> | undefined;
  await admin.begin(async (t) => {
    await t`SELECT id FROM season WHERE id = ${season} FOR SHARE`;
    a = settle(first());
    await untilWaiting(t, 1);
    b = settle(second());
    await untilWaiting(t, 2);
  });
  if (!a || !b) throw new Error("not started");
  return [await a, await b] as const;
}

describe("a closure's sync and a write of one of the season's courses (#415)", () => {
  it("runs a course edit after the closure, instead of a deadlock", async () => {
    const { season, courses } = await newSeason();
    const [course] = courses;
    // The course form: the course locked (its season first, since #415), saved, then the sync.
    // Before #415 the edit held the course and waited for the season, while the closure's sync
    // held the season and waited for the course (40P01).
    const edit = () =>
      withSchool(school, async (tx) => {
        await lockCourse(tx, course);
        const r = await updateCourse(tx, course, { ...base, level: "Zz avancé" });
        if (r.ok) await syncLessons(tx, season, TODAY);
        return r;
      });
    const [closing, editing] = await meet(season, () => closeAndSync(season, wholeSchool), edit);
    expect(closing).toEqual({ value: { ok: true, added: 0, removed: 1, keptForPack: 0 } });
    expect(editing).toMatchObject({ value: { ok: true, id: course } });
    expect(await lessonOn(course, CLOSED.start)).toBeUndefined();
    expect((await admin`SELECT level FROM course WHERE id = ${course}`)[0].level).toBe("Zz avancé");
  });

  it("runs a course moved on the calendar after the closure, instead of a deadlock", async () => {
    const { season, courses } = await newSeason();
    const [course] = courses;
    // The calendar's drag and drop (`move`): the course moved, then the sync.
    const move = () =>
      withSchool(school, async (tx) => {
        const r = await moveCourse(tx, course, { weekday: 1, startTime: "19:30", durationMinutes: 60 }, true);
        if (r.status === "ok") await syncLessons(tx, season, TODAY);
        return r;
      });
    const [closing, moving] = await meet(season, () => closeAndSync(season, wholeSchool), move);
    expect(closing).toEqual({ value: { ok: true, added: 0, removed: 1, keptForPack: 0 } });
    expect(moving).toEqual({ value: { status: "ok", id: course } });
    expect(await lessonOn(course, CLOSED.start)).toBeUndefined();
  });

  it("runs a lesson moved « et des suivantes » after the closure", async () => {
    const { season, courses } = await newSeason();
    const [course] = courses;
    const later = await lessonOn(course, "2026-11-23");
    if (!later) throw new Error("no lesson generated");
    // The dated calendar (`moveOneLesson`): the lesson and the following ones moved, then the sync.
    // A regression check: unlike the cases around it, this one did not deadlock on main every
    // time (which side got the season first varied), so it does not prove `lockSeasonOfLesson`.
    const move = () =>
      withSchool(school, async (tx) => {
        const r = await moveLesson(
          tx,
          later,
          { date: "2026-11-23", startTime: "19:30", durationMinutes: 60 },
          "following",
        );
        if (r.status !== "refused" && r.since) await syncLessons(tx, r.seasonId, TODAY, r.since);
        return r.status;
      });
    const [closing, moving] = await meet(season, () => closeAndSync(season, wholeSchool), move);
    expect(closing).toEqual({ value: { ok: true, added: 0, removed: 1, keptForPack: 0 } });
    expect(moving).toEqual({ value: "ok" });
    expect(await lessonOn(course, CLOSED.start)).toBeUndefined();
  });

  it("runs a course deletion after a closure of that course, instead of a deadlock", async () => {
    const { season, courses } = await newSeason();
    const [course] = courses;
    // Before #415 the closure's course (`closure_course`, KEY SHARE on the course) held the
    // deletion at the course row's DELETE, while its sync waited for the course the deletion held.
    const closing = () =>
      closeAndSync(season, { scope: "courses", label: "Zz fermeture", ...CLOSED, courseIds: [course] });
    const remove = () => withSchool(school, (tx) => deleteCourse(tx, course));
    const [closed, deletion] = await meet(season, closing, remove);
    expect(closed).toEqual({ value: { ok: true, added: 0, removed: 1, keptForPack: 0 } });
    expect(deletion).toEqual({ value: { ok: true, id: course } });
    expect(await admin`SELECT id FROM lesson WHERE course_id = ${course}`).toHaveLength(0);
  });
});

describe("a sync's courses and an enrollment cancelled at the same moment (#415)", () => {
  it("locks every course in one statement, by id, so a lesson restored meanwhile never adds one out of order", async () => {
    // A Monday and a Tuesday course: each has one lesson on the closed days.
    const { season, courses } = await newSeason([1, 2]);
    const closedDay = new Map([
      [courses[0], CLOSED.start],
      [courses[1], CLOSED.end],
    ]);
    const [low, high] = [...courses].sort();
    const toRestore = await lessonOn(low, closedDay.get(low) ?? "");
    if (!toRestore || !(await lessonOn(high, closedDay.get(high) ?? ""))) throw new Error("no lesson generated");
    // The lower course's lesson cancelled before the closure: the sync leaves it as it is.
    await admin`UPDATE lesson SET status = 'cancelled' WHERE id = ${toRestore}`;
    // Added by hand: the sync below is the one a closure's removal or a season edit runs too.
    await admin`INSERT INTO closure (school_id, season_id, label, start_date, end_date, scope)
      VALUES (${school}, ${season}, 'Zz pont', ${CLOSED.start}, ${CLOSED.end}, 'school')`;
    // An enrollment in both courses, to be cancelled: it locks them by id (`lockCoursesOfEnrollment`).
    const [{ id: enrollment }] =
      await admin`INSERT INTO enrollment (school_id, billing_entity_id, payer_id, season_id, audience, period, gross_price_cents)
        VALUES (${school}, (SELECT id FROM billing_entity WHERE school_id = ${school} AND is_default), ${payer}, ${season}, 'child', 'year', 0) RETURNING id`;
    for (const c of [low, high])
      await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id)
        VALUES (${school}, (SELECT billing_entity_id FROM enrollment WHERE id = ${enrollment}), ${enrollment}, ${student}, ${c})`;

    let syncing: Settled<Awaited<ReturnType<typeof syncLessons>>> | undefined;
    let cancelling: Settled<Awaited<ReturnType<typeof cancelEnrollment>>> | undefined;
    await admin.begin(async (t) => {
      // The higher course held: the sync waits for it. Before #415 it had read the lessons and
      // waited for that course alone; it now holds the lower one already.
      await t`SELECT id FROM course WHERE id = ${high} FOR SHARE`;
      syncing = settle(withSchool(school, (tx) => syncLessons(tx, season, TODAY)));
      await untilWaiting(t, 1);
      // A lesson of the lower course restored meanwhile, on the closed day: one more to remove.
      expect(await withSchool(school, (tx) => restoreLesson(tx, toRestore))).toEqual({ ok: true, id: toRestore });
      // The cancellation locks the lower course, then waits for the higher one (before #415), or
      // waits for the season behind the sync (since #415).
      cancelling = settle(withSchool(school, (tx) => cancelEnrollment(tx, desk, enrollment)));
      await untilWaiting(t, 2);
    });
    if (!syncing || !cancelling) throw new Error("not started");
    // Before #415 the sync, given the higher course, read the restored lesson again and locked
    // the lower course in a further statement, which the cancellation held (40P01).
    expect(await syncing).toEqual({ value: { added: 0, removed: 2, keptForPack: 0 } });
    expect(await cancelling).toEqual({ value: { ok: true, id: enrollment } });
    expect(await admin`SELECT id FROM lesson WHERE id = ${toRestore}`).toHaveLength(0);
  });

  it("makes a cancellation wait for a course edit, whose sync locks the season's lower courses", async () => {
    const { season, courses } = await newSeason([1, 2]);
    const [low, high] = [...courses].sort();
    const [{ id: enrollment }] =
      await admin`INSERT INTO enrollment (school_id, billing_entity_id, payer_id, season_id, audience, period, gross_price_cents)
        VALUES (${school}, (SELECT id FROM billing_entity WHERE school_id = ${school} AND is_default), ${payer}, ${season}, 'child', 'year', 0) RETURNING id`;
    for (const c of [low, high])
      await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id)
        VALUES (${school}, (SELECT billing_entity_id FROM enrollment WHERE id = ${enrollment}), ${enrollment}, ${student}, ${c})`;
    const weekday = high === courses[0] ? 1 : 2;
    // The course form on the higher course, held between its save and its sync until the
    // cancellation waits. Before the fix the cancellation then held the lower course and waited
    // for the edited one, while the edit's sync asked for the lower one (40P01). It now waits for
    // the season the edit holds.
    let open: () => void = () => {};
    let saved: () => void = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    const atGate = new Promise<void>((resolve) => (saved = resolve));
    const edit = settle(
      withSchool(school, async (tx) => {
        await lockCourse(tx, high);
        const r = await updateCourse(tx, high, { ...base, weekday, level: "Zz avancé" });
        saved();
        await gate;
        if (r.ok) await syncLessons(tx, season, TODAY);
        return r.ok;
      }),
    );
    await atGate;
    const cancelling = settle(withSchool(school, (tx) => cancelEnrollment(tx, desk, enrollment)));
    await admin.begin((t) => untilWaiting(t, 1));
    open();
    expect(await edit).toEqual({ value: true });
    expect(await cancelling).toEqual({ value: { ok: true, id: enrollment } });
  });
});
