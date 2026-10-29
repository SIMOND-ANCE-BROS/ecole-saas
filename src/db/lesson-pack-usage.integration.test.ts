import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteCourse } from "./courses";
import { withSchool } from "./index";
import { addClosure, changeInstructor, deleteClosure, syncLessons } from "./lessons";

/**
 * A lesson a lesson pack was counted on is never deleted (#225, recommended rule pending
 * the school's validation): a closure keeps it as is, a course deletion is refused. No app
 * code writes `lesson_pack_usage` yet: the rows are inserted here. Each case has its own
 * course. Fictitious data.
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
let substitute: string;
let pack: string;

const TODAY = "2026-11-02"; // a Monday
const THURSDAYS = ["2026-11-05", "2026-11-12", "2026-11-19", "2026-11-26"];

const newInstructor = async (lastName: string) =>
  (
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${school}, ${lastName}, 'Zzprénom', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`
  )[0].id as string;

beforeAll(async () => {
  [{ id: school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École carnets', ${`zzc-${suffix}`}) RETURNING id`;
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2026-11-30') RETURNING id`;
  [{ id: discipline }] =
    await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Zzsalsa') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Zz Centre', '1 rue Zz') RETURNING id`;
  [{ id: room }] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Zz Studio') RETURNING id`;
  teacher = await newInstructor("Zzprof");
  substitute = await newInstructor("Zzremplaçant");
  const [payer] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzpayeur', 'Zzprénom') RETURNING id`;
  [{ id: pack }] = await admin`INSERT INTO lesson_pack (school_id, payer_id, people_count, lesson_count, price_cents)
    VALUES (${school}, ${payer.id}, 1, 5, 20000) RETURNING id`;
});

afterAll(async () => {
  for (const t of [
    "lesson_pack_usage",
    "lesson_pack",
    "suspended_lesson",
    "lesson",
    "closure_course",
    "closure",
    "course",
    "person",
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

/** A Thursday 18:00 course of its own, with its lessons generated. */
async function newCourse(): Promise<string> {
  const [{ id }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${school}, ${season}, ${discipline}, ${room}, ${teacher}, 4, '18:00', 60) RETURNING id`;
  await sync();
  return id as string;
}

const lessons = (courseId: string) =>
  admin<{ id: string; date: string; instructor: string }[]>`
    SELECT id, date::text AS date, instructor_id AS instructor FROM lesson WHERE course_id = ${courseId} ORDER BY date`;
const lessonOn = async (courseId: string, date: string) => {
  const l = (await lessons(courseId)).find((x) => x.date === date);
  if (!l) throw new Error(`no lesson on ${date}`);
  return l;
};
/** Counts a lesson of the pack on the lesson, as the private-lesson flow will. */
const usePack = async (lessonId: string) =>
  admin`INSERT INTO lesson_pack_usage (school_id, lesson_pack_id, lesson_id) VALUES (${school}, ${pack}, ${lessonId})`;
const closeCourse = async (courseId: string, start: string, end: string) => {
  const r = await withSchool(school, (tx) =>
    addClosure(tx, season, { scope: "courses", label: "Zz gala", start, end, courseIds: [courseId] }),
  );
  if (!r.ok) throw new Error(r.message);
  return r.id;
};

describe("a closure over a lesson with lesson-pack usage (#225)", () => {
  it("keeps the lesson as is, reports it, and leaves it alone once the closure is removed", async () => {
    const salsa = await newCourse();
    const used = await lessonOn(salsa, "2026-11-12");
    await withSchool(school, (tx) => changeInstructor(tx, used.id, substitute));
    await usePack(used.id);

    const closure = await closeCourse(salsa, "2026-11-12", "2026-11-19");
    expect(await sync()).toEqual({ added: 0, removed: 1, keptForPack: 1 });
    // Same row, same substitute: nothing was deleted nor recreated.
    expect(await lessons(salsa)).toEqual([
      expect.objectContaining({ date: "2026-11-05" }),
      { id: used.id, date: "2026-11-12", instructor: substitute },
      expect.objectContaining({ date: "2026-11-26" }),
    ]);
    // Kept, not removed: nothing set aside for it (#206).
    expect(
      await admin`SELECT reference_date::text AS reference FROM suspended_lesson WHERE course_id = ${salsa}`,
    ).toEqual([]);

    await withSchool(school, (tx) => deleteClosure(tx, closure));
    expect(await sync()).toEqual({ added: 1, removed: 0, keptForPack: 0 });
    expect((await lessons(salsa)).map((l) => l.date)).toEqual(THURSDAYS);
    expect(await lessonOn(salsa, "2026-11-12")).toEqual({ id: used.id, date: "2026-11-12", instructor: substitute });
  });
});

describe("deleting a course with lesson-pack usage (#225)", () => {
  it("is refused with a French message, the course and its lessons stay", async () => {
    const salsa = await newCourse();
    await usePack((await lessonOn(salsa, "2026-11-19")).id);

    expect(await withSchool(school, (tx) => deleteCourse(tx, salsa))).toEqual({
      ok: false,
      message: "Ce cours a des séances déjà décomptées d’un carnet : il ne peut pas être supprimé.",
    });
    expect((await lessons(salsa)).map((l) => l.date)).toEqual(THURSDAYS);
  });

  it("still deletes a course whose lessons have no pack usage", async () => {
    const salsa = await newCourse();
    expect(await withSchool(school, (tx) => deleteCourse(tx, salsa))).toEqual({ ok: true, id: salsa });
    expect(await lessons(salsa)).toEqual([]);
  });
});
