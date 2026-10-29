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

const TODAY = "2026-11-02"; // a Monday
const LABEL = "2026-2027";

beforeAll(async () => {
  [{ id: school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École dates', ${`zzd-${suffix}`}) RETURNING id`;
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, ${LABEL}, '2026-09-01', '2026-12-18') RETURNING id`;
  const [discipline] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Zztango') RETURNING id`;
  const [site] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Zz Centre', '1 rue Zz') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${site.id}, 'Zz Studio') RETURNING id`;
  const [teacher] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${school}, 'Zzprof', 'Zzprénom', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  [{ id: student }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzélève', 'Zzprénom') RETURNING id`;
  [{ id: pack }] = await admin`INSERT INTO lesson_pack (school_id, payer_id, people_count, lesson_count, price_cents)
    VALUES (${school}, ${student}, 1, 5, 20000) RETURNING id`;
  // Thursday 18:00, weekly.
  [{ id: course }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${school}, ${season}, ${discipline.id}, ${room.id}, ${teacher.id}, 4, '18:00', 60) RETURNING id`;
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
const edit = (startDate: string, endDate: string) =>
  withSchool(school, (tx) => updateSeason(tx, season, { label: LABEL, startDate, endDate }, TODAY));

describe("season dates and lessons (#270)", () => {
  it("starts from the lessons of the course, the closed Thursday left out", async () => {
    expect(await dates()).toEqual(["2026-11-05", "2026-11-12", "2026-11-26", "2026-12-03", "2026-12-10", "2026-12-17"]);
  });

  it("shortening removes the planned lessons after the new end, keeps those with attendance or a pack", async () => {
    await admin`INSERT INTO attendance (school_id, lesson_id, student_id, present)
      VALUES (${school}, ${await lessonOn("2026-12-10")}, ${student}, true)`;
    await admin`INSERT INTO lesson_pack_usage (school_id, lesson_pack_id, lesson_id)
      VALUES (${school}, ${pack}, ${await lessonOn("2026-12-17")})`;

    expect(await edit("2026-09-01", "2026-11-30")).toEqual({ ok: true, id: season, outside: 2 });
    expect(await dates()).toEqual(["2026-11-05", "2026-11-12", "2026-11-26", "2026-12-10", "2026-12-17"]);
  });

  it("a later start removes the upcoming planned lessons before it", async () => {
    expect(await edit("2026-11-10", "2026-11-30")).toEqual({ ok: true, id: season, outside: 2 });
    expect(await dates()).toEqual(["2026-11-12", "2026-11-26", "2026-12-10", "2026-12-17"]);
  });

  it("lengthening creates the lessons of the added weeks, closures still applied", async () => {
    expect(await edit("2026-09-01", "2027-01-15")).toEqual({ ok: true, id: season, outside: 0 });
    expect(await dates()).toEqual([
      "2026-11-05",
      "2026-11-12",
      "2026-11-26",
      "2026-12-03",
      "2026-12-10",
      "2026-12-17",
      "2026-12-24",
      "2026-12-31",
      "2027-01-07",
      "2027-01-14",
    ]);
  });

  it("a refused edit changes no lesson", async () => {
    expect((await edit("2026-11-17", "2027-01-15")).ok).toBe(false); // the closure would fall outside
    expect(await dates()).toHaveLength(10);
  });
});
