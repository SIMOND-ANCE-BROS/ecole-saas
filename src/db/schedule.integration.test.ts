import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { seasonCourses, scheduleCourse, enrolledInCourse, currentSeason } from "./schedule";

/** Schedule, read as the application does (app_user, RLS). Fictitious data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let otherSchool: string;
let season2026: string;
let season2027: string;

async function createCourse(schoolId: string, seasonId: string, discipline: string, day: number, time: string) {
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${schoolId}, ${discipline})
    ON CONFLICT (school_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  const [site] = await admin`SELECT id FROM site WHERE school_id = ${schoolId} LIMIT 1`;
  const [s] = site
    ? [site]
    : await admin`INSERT INTO site (school_id, name, address) VALUES (${schoolId}, 'Site Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${schoolId}, ${s.id}, ${`Salle ${discipline}`}) RETURNING id`;
  const [teacher] = await admin`
    INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${schoolId}, 'Prof', ${discipline}, 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  await admin`
    INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes, age_min, age_max, level)
    VALUES (${schoolId}, ${seasonId}, ${d.id}, ${room.id}, ${teacher.id}, ${day}, ${time}, 60, 8, 10, 'Débutant')`;
}

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`pa-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`pb-${suffix}`}) RETURNING id`;
  [{ id: season2026 }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: season2027 }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2027-2028', '2027-09-01', '2028-06-30') RETURNING id`;
  const [b] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${otherSchool}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  await createCourse(school, season2026, "Jazz", 3, "17:00");
  await createCourse(school, season2026, "Classique", 1, "18:30");
  await createCourse(school, season2026, "Éveil", 3, "14:00");
  await createCourse(school, season2027, "Zumba", 2, "19:00");
  await createCourse(otherSchool, b.id, "Salsa", 1, "20:00");
});

afterAll(async () => {
  for (const t of [
    "enrollment_course",
    "enrollment",
    "relationship",
    "person",
    "course",
    "instructor",
    "room",
    "site",
    "discipline",
    "season",
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  }
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("currentSeason", () => {
  it("picks the season containing the day", async () => {
    expect(await withSchool(school, (tx) => currentSeason(tx, "2026-10-19"))).toMatchObject({
      id: season2026,
      label: "2026-2027",
    });
  });

  it("picks the most recent one when none contains the day (summer)", async () => {
    expect((await withSchool(school, (tx) => currentSeason(tx, "2028-08-01")))?.id).toBe(season2027);
  });

  it("returns null without a season", async () => {
    const [{ id }] = await admin`INSERT INTO school (name, slug) VALUES ('Vide', ${`pv-${suffix}`}) RETURNING id`;
    expect(await withSchool(id, (tx) => currentSeason(tx, "2026-10-19"))).toBeNull();
    await admin`DELETE FROM school WHERE id = ${id}`;
  });
});

describe("seasonCourses", () => {
  it("lists the season's courses by day then time, without those of another school", async () => {
    const courses = await withSchool(school, (tx) => seasonCourses(tx, season2026));
    expect(courses.map((c) => `${c.weekday} ${c.startTime} ${c.discipline}`)).toEqual([
      "1 18:30 Classique",
      "3 14:00 Éveil",
      "3 17:00 Jazz",
    ]);
    expect(courses[0]).toMatchObject({
      durationMinutes: 60,
      room: "Salle Classique",
      site: "Site Centre",
      instructor: "Classique Prof",
      ageMin: 8,
      ageMax: 10,
      level: "Débutant",
    });
  });
});

describe("scheduleCourse and enrolledInCourse", () => {
  it("reads a course and its active, trial or waitlisted students, without dropped ones", async () => {
    const [jazz] = await admin`SELECT c.id FROM course c JOIN discipline d ON d.id = c.discipline_id
      WHERE c.school_id = ${school} AND d.name = 'Jazz'`;
    const [p] =
      await admin`INSERT INTO person (school_id, last_name, first_name, phone) VALUES (${school}, 'Bernard', 'Émilie', '07 11 22 33 44') RETURNING id`;
    const students: Record<string, string> = {};
    for (const firstName of ["Louis", "Alice", "Jules", "Zoé"]) {
      [{ id: students[firstName] }] = await admin`
        INSERT INTO person (school_id, last_name, first_name, birth_date) VALUES (${school}, 'Bernard', ${firstName}, '2016-01-15') RETURNING id`;
    }
    for (const [firstName, status] of [
      ["Louis", "active"],
      ["Alice", "trial"],
      ["Jules", "waitlist"],
      ["Zoé", "dropped"],
    ]) {
      const [i] = await admin`
        INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents, status)
        VALUES (${school}, ${season2026}, ${p.id}, 'child', 'quarter', 10000, ${status}) RETURNING id`;
      await admin`INSERT INTO enrollment_course (school_id, enrollment_id, student_id, course_id) VALUES (${school}, ${i.id}, ${students[firstName]}, ${jazz.id})`;
    }

    expect(await withSchool(school, (tx) => scheduleCourse(tx, jazz.id))).toMatchObject({
      discipline: "Jazz",
      enrolled: 1,
    });
    const enrolled = await withSchool(school, (tx) => enrolledInCourse(tx, jazz.id));
    expect(enrolled.map((i) => `${i.firstName} ${i.status}`)).toEqual([
      "Alice trial",
      "Jules waitlist",
      "Louis active",
    ]);
    expect(enrolled[0]).toMatchObject({
      payer: "Émilie Bernard",
      telephone: "07 11 22 33 44",
      payerId: p.id,
      birthDate: "2016-01-15",
    });
  });

  it("does not read a course from another school, nor its enrolled students", async () => {
    const [salsa] = await admin`SELECT id FROM course WHERE school_id = ${otherSchool}`;
    expect(await withSchool(school, (tx) => scheduleCourse(tx, salsa.id))).toBeNull();
    expect(await withSchool(school, (tx) => enrolledInCourse(tx, salsa.id))).toEqual([]);
    expect(await withSchool(school, (tx) => scheduleCourse(tx, "pas-un-uuid"))).toBeNull();
  });
});
