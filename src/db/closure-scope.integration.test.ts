import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import {
  addClosure,
  closuresBetween,
  courseLessons,
  deleteClosure,
  listClosures,
  syncLessons,
  syncRoomSeasons,
} from "./lessons";

/** Closures limited to some sites or some courses (#200), as the app does (app_user, RLS). Fictitious data. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let otherSchool: string;
let season: string;
let otherSeason: string;
let centre: string;
let annexe: string;
let foreignSite: string;
let annexeRoom: string;
let centreRoom: string;
let jazz: string; // Thursday, Centre
let ballet: string; // Thursday, Annexe
let nextYear: string; // course of the other season

const TODAY = "2026-11-02"; // a Monday
const THURSDAYS = ["2026-11-05", "2026-11-12", "2026-11-19", "2026-11-26"];

beforeAll(async () => {
  [{ id: school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École A', ${`zza-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École B', ${`zzb-${suffix}`}) RETURNING id`;
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2026-11-30') RETURNING id`;
  [{ id: otherSeason }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2027-2028', '2027-09-01', '2028-06-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Zzdanse') RETURNING id`;
  const newSite = async (schoolId: string, name: string) =>
    (await admin`INSERT INTO site (school_id, name, address) VALUES (${schoolId}, ${name}, '1 rue Zz') RETURNING id`)[0]
      .id as string;
  centre = await newSite(school, "Zz Centre");
  annexe = await newSite(school, "Zz Annexe");
  foreignSite = await newSite(otherSchool, "Zz Ailleurs");
  const newRoom = async (siteId: string, name: string) =>
    (await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${siteId}, ${name}) RETURNING id`)[0]
      .id as string;
  centreRoom = await newRoom(centre, "Zz Studio");
  annexeRoom = await newRoom(annexe, "Zz Salle");
  const [teacher] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${school}, 'Zzprof', 'Zzprénom', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  const newCourse = async (seasonId: string, roomId: string) =>
    (
      await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
        VALUES (${school}, ${seasonId}, ${d.id}, ${roomId}, ${teacher.id}, 4, '18:00', 60) RETURNING id`
    )[0].id as string;
  jazz = await newCourse(season, centreRoom);
  ballet = await newCourse(season, annexeRoom);
  nextYear = await newCourse(otherSeason, centreRoom);
});

afterAll(async () => {
  for (const t of [
    "lesson",
    "closure_course",
    "closure_site",
    "closure",
    "course_date",
    "course",
    "instructor",
    "room",
    "site",
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  }
  for (const t of ["discipline", "season"]) await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const sync = () => withSchool(school, (tx) => syncLessons(tx, season, TODAY));
const datesOf = async (courseId: string) =>
  (await withSchool(school, (tx) => courseLessons(tx, courseId))).map((l) => l.date);
const add = (entry: Parameters<typeof addClosure>[2], seasonId = season) =>
  withSchool(school, (tx) => addClosure(tx, seasonId, entry));
const dates = { start: "2026-11-12", end: "2026-11-12" };

describe("closures limited to sites or courses (#200)", () => {
  it("generates every Thursday for both courses", async () => {
    await sync();
    expect(await datesOf(jazz)).toEqual(THURSDAYS);
    expect(await datesOf(ballet)).toEqual(THURSDAYS);
  });

  it("removes only the lessons held on a closed site, then gives them back", async () => {
    const r = await add({ scope: "sites", label: "Zz travaux", ...dates, siteIds: [annexe] });
    expect(r.ok).toBe(true);
    expect(await sync()).toEqual({ added: 0, removed: 1 });
    expect(await datesOf(ballet)).toEqual(["2026-11-05", "2026-11-19", "2026-11-26"]);
    expect(await datesOf(jazz)).toEqual(THURSDAYS);
    expect(await withSchool(school, (tx) => listClosures(tx, season))).toMatchObject([
      { label: "Zz travaux", scope: { kind: "sites", siteIds: [annexe] }, targets: ["Zz Annexe"] },
    ]);

    // The course moves to the open site: its lesson comes back.
    await admin`UPDATE course SET room_id = ${centreRoom} WHERE id = ${ballet}`;
    expect(await sync()).toEqual({ added: 1, removed: 0 });
    expect(await datesOf(ballet)).toEqual(THURSDAYS);
    await admin`UPDATE course SET room_id = ${annexeRoom} WHERE id = ${ballet}`;
    expect(await sync()).toEqual({ added: 0, removed: 1 });

    await withSchool(school, (tx) => deleteClosure(tx, r.ok ? r.id : ""));
    expect(await sync()).toEqual({ added: 1, removed: 0 });
    expect(await datesOf(ballet)).toEqual(THURSDAYS);
  });

  it("removes only the lessons of the chosen courses", async () => {
    const r = await add({ scope: "courses", label: "Zz gala", ...dates, courseIds: [jazz] });
    expect(r.ok).toBe(true);
    expect(await sync()).toEqual({ added: 0, removed: 1 });
    expect(await datesOf(jazz)).toEqual(["2026-11-05", "2026-11-19", "2026-11-26"]);
    expect(await datesOf(ballet)).toEqual(THURSDAYS);
    const [shown] = await withSchool(school, (tx) => closuresBetween(tx, "2026-11-09", "2026-11-15"));
    expect(shown).toMatchObject({
      scope: { kind: "courses", courseIds: [jazz] },
      targets: ["Zzdanse – jeudi 18:00 – Zz Studio"],
    });
    await withSchool(school, (tx) => deleteClosure(tx, r.ok ? r.id : ""));
    await sync();
  });

  it("refuses a closure without a site or a course, or with one that is not there", async () => {
    expect(await add({ scope: "sites", label: "Zz", ...dates, siteIds: [] })).toEqual({
      ok: false,
      message: "Choisissez au moins un site.",
    });
    expect(await add({ scope: "courses", label: "Zz", ...dates, courseIds: [] })).toEqual({
      ok: false,
      message: "Choisissez au moins un cours.",
    });
    // Another school's site is invisible (RLS); a course of another season is not this season's.
    expect(await add({ scope: "sites", label: "Zz", ...dates, siteIds: [foreignSite] })).toEqual({
      ok: false,
      message: "Un des sites choisis n’existe plus.",
    });
    expect(await add({ scope: "courses", label: "Zz", ...dates, courseIds: [nextYear] })).toEqual({
      ok: false,
      message: "Un des cours choisis n’existe plus dans cette saison.",
    });
    expect(await withSchool(school, (tx) => listClosures(tx, season))).toEqual([]);
  });

  it("keeps the links consistent with the scope in the database", async () => {
    const r = await add({ scope: "school", label: "Zz toute l’école", ...dates });
    const id = r.ok ? r.id : "";
    await expect(
      withSchool(school, (tx) =>
        tx.execute(sql`INSERT INTO closure_site (school_id, closure_id, site_id) VALUES (${school}, ${id}, ${centre})`),
      ),
    ).rejects.toThrow();
    await expect(
      withSchool(school, (tx) => tx.execute(sql`UPDATE closure SET scope = 'sites' WHERE id = ${id}`)),
    ).rejects.toThrow();
    await withSchool(school, (tx) => deleteClosure(tx, id));
  });

  it("keeps a workshop during the holidays, not on its closed site (owner, 2026-10-28)", async () => {
    const [w] =
      await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, recurrence, weekday, start_time, duration_minutes)
      SELECT school_id, season_id, discipline_id, ${annexeRoom}, instructor_id, 'dates', NULL, '10:00', 120 FROM course WHERE id = ${jazz}
      RETURNING id`;
    await admin`INSERT INTO course_date (school_id, course_id, date) VALUES (${school}, ${w.id}, '2026-11-12'), (${school}, ${w.id}, '2026-11-19')`;
    const holidays = await add({ scope: "school", label: "Zz vacances", start: "2026-11-19", end: "2026-11-19" });
    const works = await add({ scope: "sites", label: "Zz travaux", ...dates, siteIds: [annexe] });
    try {
      await sync();
      expect(await datesOf(w.id)).toEqual(["2026-11-19"]);

      // The room moves to the open site: the workshop's lesson comes back.
      await admin`UPDATE room SET site_id = ${centre} WHERE id = ${annexeRoom}`;
      await withSchool(school, (tx) => syncRoomSeasons(tx, annexeRoom, TODAY));
      expect(await datesOf(w.id)).toEqual(["2026-11-12", "2026-11-19"]);
      expect(await datesOf(ballet)).toContain("2026-11-12");
    } finally {
      // Whatever failed above, the next tests find the room and the closures as they were.
      await admin`UPDATE room SET site_id = ${annexe} WHERE id = ${annexeRoom}`;
      for (const r of [holidays, works]) await withSchool(school, (tx) => deleteClosure(tx, r.ok ? r.id : ""));
      await admin`DELETE FROM lesson WHERE course_id = ${w.id}`;
      await admin`DELETE FROM course WHERE id = ${w.id}`;
      await sync();
    }
  });

  it("forgets a deleted course without leaving a link behind", async () => {
    const r = await add({ scope: "courses", label: "Zz gala", ...dates, courseIds: [jazz, ballet] });
    expect(r.ok).toBe(true);
    await admin`DELETE FROM lesson WHERE course_id = ${jazz}`;
    await admin`DELETE FROM course WHERE id = ${jazz}`;
    expect(await withSchool(school, (tx) => listClosures(tx, season))).toMatchObject([
      { scope: { kind: "courses", courseIds: [ballet] }, targets: ["Zzdanse – jeudi 18:00 – Zz Salle"] },
    ]);
    await withSchool(school, (tx) => deleteClosure(tx, r.ok ? r.id : ""));
  });
});
