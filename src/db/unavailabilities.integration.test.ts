import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addUnavailability,
  slotConflicts,
  lessonAvailabilities,
  listUnavailabilities,
  replaceCalendarUnavailabilities,
  conflictingLessons,
  deleteUnavailability,
} from "./unavailabilities";
import { withSchool } from "./index";

/** Unavailabilities, conflicts and substitutes, as the app does (app_user, RLS). Fictitious data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let otherSchool: string;
let season: string;
let jazz: string;
let camille: string;
let ines: string;
let lucas: string;
let foreign: string;
const lessons: Record<string, string> = {};
const TODAY = "2026-10-19";

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`da-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`db-${suffix}`}) RETURNING id`;
  [{ id: season }] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, '2026-2027', '2026-09-01', '2026-11-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Jazz') RETURNING id`;
  const [z] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Zumba') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Studio') RETURNING id`;
  const teacher = async (schoolId: string, firstName: string) =>
    (
      await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
        VALUES (${schoolId}, 'Prof', ${firstName}, 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`
    )[0].id as string;
  camille = await teacher(school, "Camille");
  ines = await teacher(school, "Inès");
  lucas = await teacher(school, "Lucas");
  foreign = await teacher(otherSchool, "Ailleurs");
  // Jazz on Wednesday 17:00 (Camille); Zumba on Wednesday 17:30 (Lucas, who also teaches jazz elsewhere in the season).
  [{ id: jazz }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${school}, ${season}, ${d.id}, ${room.id}, ${camille}, 3, '17:00', 60) RETURNING id`;
  const [zumba] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${school}, ${season}, ${z.id}, ${room.id}, ${lucas}, 3, '17:30', 60) RETURNING id`;
  await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${school}, ${season}, ${d.id}, ${room.id}, ${lucas}, 5, '18:00', 60)`;
  for (const date of ["2026-11-04", "2026-11-18"]) {
    [{ id: lessons[date] }] =
      await admin`INSERT INTO lesson (school_id, course_id, date, instructor_id) VALUES (${school}, ${jazz}, ${date}, ${camille}) RETURNING id`;
    await admin`INSERT INTO lesson (school_id, course_id, date, instructor_id) VALUES (${school}, ${zumba.id}, ${date}, ${lucas})`;
  }
});

afterAll(async () => {
  for (const t of ["unavailability", "lesson", "course", "instructor", "room", "site", "discipline", "season"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  }
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const instant = (iso: string) => new Date(iso); // instants written with their offset

describe("manually entered unavailabilities", () => {
  it("adds and lists an unavailability; rejects an end before the start", async () => {
    expect(
      await withSchool(school, (tx) =>
        addUnavailability(tx, camille, {
          start: instant("2026-11-10T10:00:00+01:00"),
          end: instant("2026-11-10T09:00:00+01:00"),
          label: null,
        }),
      ),
    ).toEqual({ ok: false, message: "La fin doit suivre le début." });
    const r = await withSchool(school, (tx) =>
      addUnavailability(tx, camille, {
        start: instant("2026-11-04T16:30:00+01:00"),
        end: instant("2026-11-04T19:00:00+01:00"),
        label: " Stage ",
      }),
    );
    expect(r.ok).toBe(true);
    const list = await withSchool(school, (tx) =>
      listUnavailabilities(tx, camille, instant("2026-10-19T00:00:00+02:00")),
    );
    expect(list).toMatchObject([{ source: "manual", label: "Stage" }]);
  });

  it("rejects an instructor from another school", async () => {
    expect(
      await withSchool(school, (tx) =>
        addUnavailability(tx, foreign, {
          start: instant("2026-11-04T10:00:00+01:00"),
          end: instant("2026-11-04T11:00:00+01:00"),
          label: null,
        }),
      ),
    ).toEqual({ ok: false, message: "Intervenant introuvable." });
  });
});

describe("conflicts", () => {
  it("flags the upcoming dates of a weekly slot during an unavailability", async () => {
    const dates = await withSchool(school, (tx) =>
      slotConflicts(
        tx,
        { seasonId: season, instructorId: camille, weekday: 3, startTime: "17:00", durationMinutes: 60 },
        TODAY,
      ),
    );
    expect(dates).toEqual(["2026-11-04"]);
    expect(
      await withSchool(school, (tx) =>
        slotConflicts(
          tx,
          { seasonId: season, instructorId: camille, weekday: 3, startTime: "19:00", durationMinutes: 60 },
          TODAY,
        ),
      ),
    ).toEqual([]);
  });

  it("flags the affected planned lessons of the course", async () => {
    expect([...(await withSchool(school, (tx) => conflictingLessons(tx, jazz, TODAY)))]).toEqual([
      lessons["2026-11-04"],
    ]);
  });
});

describe("substitutes", () => {
  it("reports the regular instructor as unavailable and ranks the substitutes", async () => {
    const d = await withSchool(school, (tx) => lessonAvailabilities(tx, lessons["2026-11-04"]));
    expect(d?.unavailable).toBe(true);
    // Inès is free; Lucas teaches jazz but gives Zumba at 17:30.
    expect(d?.substitutes.map((r) => `${r.name} ${r.free} ${r.reason} ${r.taught}`)).toEqual([
      "Inès Prof true null false",
      "Lucas Prof false autre séance true",
    ]);
    expect((await withSchool(school, (tx) => lessonAvailabilities(tx, lessons["2026-11-18"])))?.unavailable).toBe(
      false,
    );
  });

  it("does not read a lesson from another school", async () => {
    expect(await withSchool(otherSchool, (tx) => lessonAvailabilities(tx, lessons["2026-11-04"]))).toBeNull();
  });
});

describe("calendar sync", () => {
  it("replaces the ranges read within the window, without touching manually entered unavailabilities", async () => {
    const window = { start: instant("2026-11-01T00:00:00+01:00"), end: instant("2026-12-01T00:00:00+01:00") };
    await withSchool(school, (tx) =>
      replaceCalendarUnavailabilities(tx, ines, "google", window, [
        { start: instant("2026-11-18T16:00:00+01:00"), end: instant("2026-11-18T18:00:00+01:00") },
        { start: instant("2026-11-20T10:00:00+01:00"), end: instant("2026-11-20T09:00:00+01:00") }, // invalid, ignored
      ]),
    );
    await withSchool(school, (tx) =>
      replaceCalendarUnavailabilities(tx, ines, "google", window, [
        { start: instant("2026-11-25T16:00:00+01:00"), end: instant("2026-11-25T18:00:00+01:00") },
      ]),
    );
    const list = await withSchool(school, (tx) => listUnavailabilities(tx, ines, instant("2026-10-19T00:00:00+02:00")));
    expect(list.map((i) => `${i.source} ${i.start.toISOString()}`)).toEqual(["google 2026-11-25T15:00:00.000Z"]);

    expect(await withSchool(school, (tx) => deleteUnavailability(tx, list[0].id))).toEqual({
      ok: false,
      message: "Cette indisponibilité n’existe plus ou vient d’un agenda.",
    });
    // Camille's manually entered unavailability is still there.
    expect(
      await withSchool(school, (tx) => listUnavailabilities(tx, camille, instant("2026-10-19T00:00:00+02:00"))),
    ).toHaveLength(1);
  });
});
