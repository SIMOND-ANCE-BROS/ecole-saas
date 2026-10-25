import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCalendarToken, calendarState, readCalendar, revokeCalendarToken } from "./calendar-feed";
import { readInstructor, updateInstructor } from "./instructors";
import { withSchool } from "./index";

/** An instructor's iCal subscription, as the app does (app_user, RLS). Fictitious data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let otherSchool: string;
let camille: string;
let ines: string;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ga-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`gb-${suffix}`}) RETURNING id`;
  const [season] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Jazz') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Studio') RETURNING id`;
  const teacher = async (firstName: string) =>
    (
      await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
        VALUES (${school}, 'Prof', ${firstName}, 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`
    )[0].id as string;
  camille = await teacher("Camille");
  ines = await teacher("Inès");
  const [c] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes, level)
    VALUES (${school}, ${season.id}, ${d.id}, ${room.id}, ${camille}, 3, '17:00', 60, 'Débutant') RETURNING id`;
  await admin`INSERT INTO lesson (school_id, course_id, date, instructor_id, status) VALUES
    (${school}, ${c.id}, '2026-10-14', ${camille}, 'done'),
    (${school}, ${c.id}, '2026-11-04', ${camille}, 'planned'),
    (${school}, ${c.id}, '2026-11-18', ${ines}, 'planned'),
    (${school}, ${c.id}, '2026-11-25', ${camille}, 'cancelled')`;
});

afterAll(async () => {
  for (const t of ["lesson", "course", "instructor", "room", "site", "discipline", "season"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  }
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("iCal subscription", () => {
  it("creates a token of which only the hash is kept, and gives the upcoming lessons without the substituted one", async () => {
    const token = await withSchool(school, (tx) => createCalendarToken(tx, camille));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [{ calendar_token_hash: calendarTokenHash }] =
      await admin`SELECT calendar_token_hash FROM instructor WHERE id = ${camille}`;
    expect(calendarTokenHash).not.toBe(token);
    expect(calendarTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await withSchool(school, (tx) => calendarState(tx, camille))).toBeInstanceOf(Date);

    const calendar = await withSchool(school, (tx) => readCalendar(tx, token as string, "2026-10-20"));
    expect(calendar?.name).toBe("Cours de Camille, École A");
    expect(calendar?.lessons.map((s) => `${s.date} ${s.title} ${s.cancelled}`)).toEqual([
      "2026-11-04 Jazz Débutant false",
      "2026-11-25 Jazz Débutant true",
    ]);
    expect(calendar?.lessons[0]).toMatchObject({
      startTime: "17:00",
      durationMinutes: 60,
      place: "Studio, Centre, 1 rue Test",
    });
  });

  it("gives the substitute the lesson they teach", async () => {
    const token = await withSchool(school, (tx) => createCalendarToken(tx, ines));
    expect(
      (await withSchool(school, (tx) => readCalendar(tx, token as string, "2026-10-20")))?.lessons.map((s) => s.date),
    ).toEqual(["2026-11-18"]);
  });

  it("rejects a token from another school, an unknown token, and a replaced or revoked token", async () => {
    const old = (await withSchool(school, (tx) => createCalendarToken(tx, camille))) as string;
    expect(await withSchool(otherSchool, (tx) => readCalendar(tx, old, "2026-10-20"))).toBeNull();
    expect(await withSchool(school, (tx) => readCalendar(tx, "x".repeat(43), "2026-10-20"))).toBeNull();
    expect(await withSchool(school, (tx) => readCalendar(tx, "court", "2026-10-20"))).toBeNull();

    const next = (await withSchool(school, (tx) => createCalendarToken(tx, camille))) as string;
    expect(await withSchool(school, (tx) => readCalendar(tx, old, "2026-10-20"))).toBeNull();
    expect(await withSchool(school, (tx) => revokeCalendarToken(tx, camille))).toBe(true);
    expect(await withSchool(school, (tx) => readCalendar(tx, next, "2026-10-20"))).toBeNull();
    expect(await withSchool(school, (tx) => calendarState(tx, camille))).toBeNull();
  });

  it("cuts off the link of a deactivated instructor, even when restored by hand in the database", async () => {
    const token = (await withSchool(school, (tx) => createCalendarToken(tx, ines))) as string;
    const record = await withSchool(school, (tx) => readInstructor(tx, ines));
    if (!record) throw new Error("intervenant introuvable");
    const { id, ...entry } = record;
    expect(id).toBe(ines);
    await withSchool(school, (tx) => updateInstructor(tx, ines, { ...entry, active: false }));
    expect(await withSchool(school, (tx) => calendarState(tx, ines))).toBeNull();

    // Even if the hash came back (backup restore), an inactive instructor reads nothing.
    const [{ fingerprint }] = await admin`SELECT encode(sha256(${token}::bytea), 'hex') AS fingerprint`;
    await admin`UPDATE instructor SET calendar_token_hash = ${fingerprint} WHERE id = ${ines}`;
    expect(await withSchool(school, (tx) => readCalendar(tx, token, "2026-10-20"))).toBeNull();
  });
});
