import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { addClosure, syncLessons } from "./lessons";
import { updateSeason } from "./settings";

/**
 * A season's lessons follow its new dates (#270): `updateSeason` re-syncs them in the same
 * transaction. Planned lessons outside the dates go, those with attendance or a lesson pack
 * counted on them stay (#225) and are counted in `outside`; added weeks get their lessons,
 * closures still applied. Fictitious data deleted at the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let season: string;
let course: string;
let student: string;
let pack: string;
let discipline: string;
let room: string;
let teacher: string;
let substitute: string;

const TODAY = "2026-11-02"; // a Monday
const LABEL = "2026-2027";

beforeAll(async () => {
  [{ id: school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École dates', ${`zzd-${suffix}`}) RETURNING id`;
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, ${LABEL}, '2026-09-01', '2026-12-31') RETURNING id`;
  [{ id: discipline }] =
    await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Zztango') RETURNING id`;
  const [site] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Zz Centre', '1 rue Zz') RETURNING id`;
  [{ id: room }] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${site.id}, 'Zz Studio') RETURNING id`;
  [{ id: teacher }, { id: substitute }] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${school}, 'Zzprof', 'Zzprénom', 'employee', 'not_applicable', 'hourly', 3000),
             (${school}, 'Zzremplaçant', 'Zzprénom', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  [{ id: student }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzélève', 'Zzprénom') RETURNING id`;
  [{ id: pack }] = await admin`INSERT INTO lesson_pack (school_id, payer_id, people_count, lesson_count, price_cents)
    VALUES (${school}, ${student}, 1, 5, 20000) RETURNING id`;
  // Thursday 18:00, weekly.
  [{ id: course }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${school}, ${season}, ${discipline}, ${room}, ${teacher}, 4, '18:00', 60) RETURNING id`;
  // The Thursday 19 November is closed.
  const closed = await withSchool(school, (tx) =>
    addClosure(tx, season, { scope: "school", label: "Zz Stage", start: "2026-11-16", end: "2026-11-20" }),
  );
  if (!closed.ok) throw new Error(closed.message);
  await withSchool(school, (tx) => syncLessons(tx, season, TODAY));
});

afterAll(async () => {
  for (const t of [
    "attendance",
    "lesson_pack_usage",
    "lesson_pack",
    "suspended_lesson",
    "lesson",
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

const dates = async () =>
  (
    await admin<{ date: string }[]>`SELECT date::text AS date FROM lesson WHERE course_id = ${course} ORDER BY date`
  ).map((l) => l.date);
const lessonOn = async (date: string) =>
  (await admin<{ id: string }[]>`SELECT id FROM lesson WHERE course_id = ${course} AND date = ${date}`)[0].id;
const edit = (startDate: string, endDate: string, label = LABEL) =>
  withSchool(school, (tx) => updateSeason(tx, season, { label, startDate, endDate }, TODAY));

describe("season dates and lessons (#270)", () => {
  it("starts from the lessons of the course, the closed Thursday left out", async () => {
    expect(await dates()).toEqual([
      "2026-11-05",
      "2026-11-12",
      "2026-11-26",
      "2026-12-03",
      "2026-12-10",
      "2026-12-17",
      "2026-12-24",
      "2026-12-31",
    ]);
  });

  it("a new label only leaves the lessons as they are", async () => {
    // A stale lesson on a Friday: only a sync would remove it.
    await admin`INSERT INTO lesson (school_id, course_id, date, instructor_id) VALUES (${school}, ${course}, '2026-11-06', ${teacher})`;
    expect(await edit("2026-09-01", "2026-12-31", "Zz 2026-2027")).toEqual({ ok: true, id: season, outside: 0 });
    expect(await dates()).toContain("2026-11-06");
    expect((await edit("2026-09-01", "2026-12-31")).ok).toBe(true);
    expect(await dates()).toContain("2026-11-06");
  });

  it("shortening removes the planned lessons after the new end, keeps those with attendance, a pack or moved inside", async () => {
    await admin`INSERT INTO attendance (school_id, lesson_id, student_id, present)
      VALUES (${school}, ${await lessonOn("2026-12-10")}, ${student}, true)`;
    await admin`INSERT INTO lesson_pack_usage (school_id, lesson_pack_id, lesson_id)
      VALUES (${school}, ${pack}, ${await lessonOn("2026-12-17")})`;
    // A substitute at another time on 3 December: removed all the same, nothing kept aside (pinned).
    await admin`UPDATE lesson SET instructor_id = ${substitute}, start_time = '19:00' WHERE id = ${await lessonOn("2026-12-03")}`;
    // The 24 December lesson moved to Friday 27 November, inside the new dates: the move stands.
    await admin`UPDATE lesson SET date = '2026-11-27', planned_date = '2026-12-24' WHERE id = ${await lessonOn("2026-12-24")}`;

    expect(await edit("2026-09-01", "2026-11-30")).toEqual({ ok: true, id: season, outside: 2 });
    expect(await dates()).toEqual(["2026-11-05", "2026-11-12", "2026-11-26", "2026-11-27", "2026-12-10", "2026-12-17"]);
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM suspended_lesson WHERE course_id = ${course}`;
    expect(n).toBe(0);
  });

  it("a later start removes the upcoming planned lessons before it, keeps and counts a pack one", async () => {
    await admin`INSERT INTO lesson_pack_usage (school_id, lesson_pack_id, lesson_id)
      VALUES (${school}, ${pack}, ${await lessonOn("2026-11-12")})`;
    expect(await edit("2026-11-16", "2026-11-30")).toEqual({ ok: true, id: season, outside: 3 });
    expect(await dates()).toEqual(["2026-11-12", "2026-11-26", "2026-11-27", "2026-12-10", "2026-12-17"]);
  });

  it("a plain sync removes an upcoming planned lesson before the season's start", async () => {
    await admin`INSERT INTO lesson (school_id, course_id, date, instructor_id) VALUES (${school}, ${course}, '2026-11-09', ${teacher})`;
    expect((await withSchool(school, (tx) => syncLessons(tx, season, TODAY))).removed).toBe(1);
    expect(await dates()).toEqual(["2026-11-12", "2026-11-26", "2026-11-27", "2026-12-10", "2026-12-17"]);
  });

  it("lengthening creates the lessons of the added weeks, closures still applied", async () => {
    expect(await edit("2026-09-01", "2027-01-15")).toEqual({ ok: true, id: season, outside: 0 });
    expect(await dates()).toEqual([
      "2026-11-05",
      "2026-11-12",
      "2026-11-26",
      "2026-11-27",
      "2026-12-03",
      "2026-12-10",
      "2026-12-17",
      "2026-12-31",
      "2027-01-07",
      "2027-01-14",
    ]);
    // The 3 December lesson comes back plain: its substitute and time were not kept (pinned).
    const [back] = await admin`SELECT instructor_id AS instructor, start_time AS "startTime" FROM lesson
      WHERE id = ${await lessonOn("2026-12-03")}`;
    expect(back).toEqual({ instructor: teacher, startTime: null });
  });

  it("a refused edit changes no lesson", async () => {
    expect((await edit("2026-11-17", "2027-01-15")).ok).toBe(false); // the closure would fall outside
    expect(await dates()).toHaveLength(10);
  });

  it("refuses a start moved by an odd number of weeks over a course every other week", async () => {
    const [valse] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Zzvalse') RETURNING id`;
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, recurrence, weekday, start_time, duration_minutes)
      VALUES (${school}, ${season}, ${valse.id}, ${room}, ${teacher}, 'biweekly', 2, '19:00', 60)`;
    await withSchool(school, (tx) => syncLessons(tx, season, TODAY));

    expect(await edit("2026-09-08", "2027-01-15")).toEqual({
      ok: false,
      message:
        "Décaler le début d’un nombre impair de semaines inverserait les semaines de ce cours une semaine sur deux : Zzvalse – mardi 19:00 – Zz Studio. Donnez d’abord une date de début à ce cours, ou décalez d’un nombre pair de semaines.",
    });
    const [{ s }] = await admin`SELECT start_date::text AS s FROM season WHERE id = ${season}`;
    expect(s).toBe("2026-09-01");
    // Two weeks later: same weeks, accepted.
    expect((await edit("2026-09-15", "2027-01-15")).ok).toBe(true);
  });
});
