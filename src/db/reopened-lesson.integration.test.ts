import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { addClosure, changeInstructor, deleteClosure, moveLesson, syncLessons } from "./lessons";

/**
 * A lesson removed by a closure comes back as it was once the closure is
 * removed (#206): its substitute, its own time, its new date. Each case has
 * its own course and removes its own closure. Fictitious data.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let season: string;
let discipline: string;
let room: string;
let teacher: string;
let otherTeacher: string;
let substitute: string;

const TODAY = "2026-11-02"; // a Monday

const newInstructor = async (lastName: string) =>
  (
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${school}, ${lastName}, 'Zzprénom', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`
  )[0].id as string;

beforeAll(async () => {
  [{ id: school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École reprise', ${`zzr-${suffix}`}) RETURNING id`;
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2026-11-30') RETURNING id`;
  [{ id: discipline }] =
    await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Zzjazz') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Zz Centre', '1 rue Zz') RETURNING id`;
  [{ id: room }] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Zz Studio') RETURNING id`;
  teacher = await newInstructor("Zzprof");
  otherTeacher = await newInstructor("Zzautre");
  substitute = await newInstructor("Zzremplaçant");
});

afterAll(async () => {
  for (const t of [
    "suspended_lesson",
    "lesson",
    "closure_course",
    "closure",
    "course",
    "instructor",
    "room",
    "site",
    "discipline",
    "season",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

/** A Thursday 18:00 course of its own, with its lessons generated. */
async function newCourse(): Promise<string> {
  const [{ id }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${school}, ${season}, ${discipline}, ${room}, ${teacher}, 4, '18:00', 60) RETURNING id`;
  await sync();
  return id as string;
}

const sync = () => withSchool(school, (tx) => syncLessons(tx, season, TODAY));
const lessons = (courseId: string) =>
  admin<
    {
      id: string;
      date: string;
      planned: string | null;
      start: string | null;
      duration: number | null;
      instructor: string;
    }[]
  >`
    SELECT id, date::text AS date, planned_date::text AS planned, to_char(start_time, 'HH24:MI') AS start,
           duration_minutes AS duration, instructor_id AS instructor
    FROM lesson WHERE course_id = ${courseId} ORDER BY coalesce(planned_date, date)`;
const lessonOn = async (courseId: string, reference: string) =>
  (await lessons(courseId)).find((l) => (l.planned ?? l.date) === reference);
const kept = async (courseId: string) =>
  admin<{ reference: string; instructor: string | null }[]>`
    SELECT reference_date::text AS reference, instructor_id AS instructor
    FROM suspended_lesson WHERE course_id = ${courseId} ORDER BY reference_date`;
const close = async (start: string, end: string, courseIds?: string[]) => {
  const r = await withSchool(school, (tx) =>
    addClosure(
      tx,
      season,
      courseIds
        ? { scope: "courses", label: "Zz gala", start, end, courseIds }
        : { scope: "school", label: "Zz vacances", start, end },
    ),
  );
  if (!r.ok) throw new Error(r.message);
  return r.id;
};
const reopen = async (closureId: string) => {
  await withSchool(school, (tx) => deleteClosure(tx, closureId));
  return sync();
};
const substituteOn = async (courseId: string, reference: string, instructorId = substitute) => {
  const l = await lessonOn(courseId, reference);
  if (!l) throw new Error(`no lesson on ${reference}`);
  const r = await withSchool(school, (tx) => changeInstructor(tx, l.id, instructorId));
  if (!r.ok) throw new Error(r.message);
};
const move = async (
  courseId: string,
  reference: string,
  slot: { date: string; startTime: string; durationMinutes: number },
) => {
  const l = await lessonOn(courseId, reference);
  if (!l) throw new Error(`no lesson on ${reference}`);
  const r = await withSchool(school, (tx) => moveLesson(tx, l.id, slot, "lesson"));
  if (r.status !== "ok") throw new Error("move refused");
};

describe("a lesson removed by a closure, then given back (#206)", () => {
  it("keeps its substitute, its own time and its new date", async () => {
    const jazz = await newCourse();
    await substituteOn(jazz, "2026-11-12");
    await move(jazz, "2026-11-19", { date: "2026-11-20", startTime: "19:00", durationMinutes: 45 });

    const closure = await close("2026-11-12", "2026-11-26");
    expect(await sync()).toEqual({ added: 0, removed: 3 });
    // 26/11 is a plain lesson: removed, but not kept aside; no instructor kept for the moved one.
    expect(await kept(jazz)).toEqual([
      { reference: "2026-11-12", instructor: substitute },
      { reference: "2026-11-19", instructor: null },
    ]);

    expect(await reopen(closure)).toEqual({ added: 3, removed: 0 });
    expect(await lessonOn(jazz, "2026-11-12")).toMatchObject({
      date: "2026-11-12",
      start: null,
      instructor: substitute,
    });
    expect(await lessonOn(jazz, "2026-11-19")).toMatchObject({
      date: "2026-11-20",
      planned: "2026-11-19",
      start: "19:00",
      duration: 45,
      instructor: teacher,
    });
    expect(await lessonOn(jazz, "2026-11-26")).toMatchObject({ planned: null, start: null, instructor: teacher });
    expect(await kept(jazz)).toEqual([]);
  });

  it("works the same for a closure of some courses only", async () => {
    const jazz = await newCourse();
    await substituteOn(jazz, "2026-11-12");
    const closure = await close("2026-11-12", "2026-11-12", [jazz]);
    await sync();
    expect(await lessonOn(jazz, "2026-11-12")).toBeUndefined();
    expect(await kept(jazz)).toEqual([{ reference: "2026-11-12", instructor: substitute }]);
    await reopen(closure);
    expect(await lessonOn(jazz, "2026-11-12")).toMatchObject({ instructor: substitute });
    expect(await kept(jazz)).toEqual([]);
  });

  it("gives the lesson to the course's main instructor of today, with no substitution", async () => {
    const jazz = await newCourse();
    // Own time on the same date, main instructor T1.
    await move(jazz, "2026-11-12", { date: "2026-11-12", startTime: "19:30", durationMinutes: 60 });
    const closure = await close("2026-11-12", "2026-11-12");
    await sync();
    await admin`UPDATE course SET instructor_id = ${otherTeacher} WHERE id = ${jazz}`;
    await reopen(closure);
    expect(await lessonOn(jazz, "2026-11-12")).toMatchObject({ start: "19:30", instructor: otherTeacher });
  });

  it("does not give back a substitute who is no longer active", async () => {
    const jazz = await newCourse();
    const leaving = await newInstructor("Zzparti");
    await substituteOn(jazz, "2026-11-12", leaving);
    const closure = await close("2026-11-12", "2026-11-12");
    await sync();
    await admin`UPDATE instructor SET active = false WHERE id = ${leaving}`;
    await reopen(closure);
    expect(await lessonOn(jazz, "2026-11-12")).toMatchObject({ instructor: teacher });
    expect(await kept(jazz)).toEqual([]);
  });

  it("falls back to the plain lesson when its new date was taken meanwhile", async () => {
    const jazz = await newCourse();
    await substituteOn(jazz, "2026-11-19");
    await move(jazz, "2026-11-19", { date: "2026-11-20", startTime: "19:00", durationMinutes: 45 });
    const closure = await close("2026-11-19", "2026-11-19");
    await sync();
    // While 19/11 is closed, 12/11 is moved onto Friday 20/11.
    await move(jazz, "2026-11-12", { date: "2026-11-20", startTime: "18:00", durationMinutes: 60 });
    await reopen(closure);
    expect(await lessonOn(jazz, "2026-11-19")).toMatchObject({
      date: "2026-11-19",
      planned: null,
      start: null,
      instructor: substitute,
    });
    expect(await lessonOn(jazz, "2026-11-12")).toMatchObject({ date: "2026-11-20" });
    expect(await kept(jazz)).toEqual([]);
  });

  it("forgets a lesson the course no longer meets on", async () => {
    const jazz = await newCourse();
    await substituteOn(jazz, "2026-11-12");
    const closure = await close("2026-11-12", "2026-11-12");
    await sync();
    // The course moves to Fridays while closed: its Thursday lesson is not given back.
    await admin`UPDATE course SET weekday = 5 WHERE id = ${jazz}`;
    await reopen(closure);
    expect(await kept(jazz)).toEqual([]);
    expect(await lessonOn(jazz, "2026-11-12")).toBeUndefined();
    expect(await lessonOn(jazz, "2026-11-13")).toMatchObject({ instructor: teacher, start: null });
  });
});
