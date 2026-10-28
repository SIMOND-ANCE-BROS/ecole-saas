import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { addClosure, changeInstructor, deleteClosure, moveLesson, syncLessons } from "./lessons";

/**
 * A lesson removed by a closure comes back as it was once the closure is
 * removed (#206): its substitute, its own time, its new date. Fictitious data.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let season: string;
let teacher: string;
let substitute: string;
let jazz: string; // Thursday 18:00

const TODAY = "2026-11-02"; // a Monday

beforeAll(async () => {
  [{ id: school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École reprise', ${`zzr-${suffix}`}) RETURNING id`;
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2026-11-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Zzjazz') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Zz Centre', '1 rue Zz') RETURNING id`;
  const [r] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Zz Studio') RETURNING id`;
  const newInstructor = async (lastName: string) =>
    (
      await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
        VALUES (${school}, ${lastName}, 'Zzprénom', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`
    )[0].id as string;
  teacher = await newInstructor("Zzprof");
  substitute = await newInstructor("Zzremplaçant");
  [{ id: jazz }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${school}, ${season}, ${d.id}, ${r.id}, ${teacher}, 4, '18:00', 60) RETURNING id`;
});

afterAll(async () => {
  for (const t of [
    "suspended_lesson",
    "lesson",
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

const sync = () => withSchool(school, (tx) => syncLessons(tx, season, TODAY));
const lessons = () =>
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
    FROM lesson WHERE course_id = ${jazz} ORDER BY coalesce(planned_date, date)`;
const lessonOn = async (reference: string) => (await lessons()).find((l) => (l.planned ?? l.date) === reference);
const closeThursdays = async (end = "2026-11-19") => {
  const r = await withSchool(school, (tx) =>
    addClosure(tx, season, { scope: "school", label: "Zz vacances", start: "2026-11-12", end }),
  );
  if (!r.ok) throw new Error(r.message);
  return r.id;
};

describe("a lesson removed by a closure, then given back (#206)", () => {
  it("keeps its substitute, its own time and its new date", async () => {
    await sync();
    const substituted = await lessonOn("2026-11-12");
    const moved = await lessonOn("2026-11-19");
    if (!substituted || !moved) throw new Error("lessons not generated");
    expect((await withSchool(school, (tx) => changeInstructor(tx, substituted.id, substitute))).ok).toBe(true);
    const m = await withSchool(school, (tx) =>
      moveLesson(tx, moved.id, { date: "2026-11-20", startTime: "19:00", durationMinutes: 45 }, "lesson"),
    );
    expect(m.status).toBe("ok");

    const closure = await closeThursdays();
    expect(await sync()).toEqual({ added: 0, removed: 2 });
    expect((await lessons()).map((l) => l.planned ?? l.date)).toEqual(["2026-11-05", "2026-11-26"]);

    await withSchool(school, (tx) => deleteClosure(tx, closure));
    expect(await sync()).toEqual({ added: 2, removed: 0 });
    expect(await lessonOn("2026-11-12")).toMatchObject({
      date: "2026-11-12",
      planned: null,
      start: null,
      instructor: substitute,
    });
    expect(await lessonOn("2026-11-19")).toMatchObject({
      date: "2026-11-20",
      planned: "2026-11-19",
      start: "19:00",
      duration: 45,
      instructor: teacher,
    });
    // Nothing left to restore once given back.
    expect(await admin`SELECT 1 FROM suspended_lesson WHERE school_id = ${school}`).toHaveLength(0);
  });

  it("does not keep a plain lesson, and forgets a date the course no longer meets on", async () => {
    const substituted = await lessonOn("2026-11-12");
    if (!substituted) throw new Error("lesson missing");
    // 26/11 is a plain lesson: removed, but not kept aside.
    const closure = await closeThursdays("2026-11-26");
    expect(await sync()).toEqual({ added: 0, removed: 3 });
    // Only the substituted and the moved lessons are kept aside, not the plain ones.
    expect(await admin`SELECT 1 FROM suspended_lesson WHERE school_id = ${school}`).toHaveLength(2);

    // The course moves to Fridays while closed: its Thursday lessons are not restored.
    await admin`UPDATE course SET weekday = 5 WHERE id = ${jazz}`;
    await withSchool(school, (tx) => deleteClosure(tx, closure));
    await sync();
    expect(await admin`SELECT 1 FROM suspended_lesson WHERE school_id = ${school}`).toHaveLength(0);
    expect(await lessonOn("2026-11-13")).toMatchObject({ date: "2026-11-13", instructor: teacher, start: null });
    await admin`UPDATE course SET weekday = 4 WHERE id = ${jazz}`;
    await sync();
  });
});
