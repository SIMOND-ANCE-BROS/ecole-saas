import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCourse,
  moveCourse,
  readCourse,
  updateCourse,
  scheduleReferential,
  type CourseInput,
  deleteCourse,
} from "./courses";
import { withSchool } from "./index";

/** Schedule editing, as the application runs it (app_user, RLS). Fictitious data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let otherSchool: string;
let season: string;
let site: string;
let room: string;
let teacher: string;
let inactiveTeacher: string;
let foreignRoom: string;
let base: CourseInput;

const INSTRUCTOR = `(school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents, active)`;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ca-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`cb-${suffix}`}) RETURNING id`;
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: site }] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Centre', '1 rue Test') RETURNING id`;
  [{ id: room }] =
    await admin`INSERT INTO room (school_id, site_id, name, capacity) VALUES (${school}, ${site}, 'Studio', 20) RETURNING id`;
  [{ id: teacher }] = await admin.unsafe(
    `INSERT INTO instructor ${INSTRUCTOR}
    VALUES ($1, 'Durand', 'Camille', 'employee', 'not_applicable', 'hourly', 3000, true) RETURNING id`,
    [school],
  );
  [{ id: inactiveTeacher }] = await admin.unsafe(
    `INSERT INTO instructor ${INSTRUCTOR}
    VALUES ($1, 'Ancien', 'Prof', 'employee', 'not_applicable', 'hourly', 3000, false) RETURNING id`,
    [school],
  );
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${otherSchool}, 'Ailleurs', '2 rue Test') RETURNING id`;
  [{ id: foreignRoom }] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${otherSchool}, ${s.id}, 'Autre') RETURNING id`;
  base = {
    discipline: { name: "Jazz" },
    room: { id: room },
    instructorId: teacher,
    type: "group",
    recurrence: "weekly",
    weekday: 3,
    startDate: null,
    endDate: null,
    dates: [],
    startTime: "17:00",
    durationMinutes: 60,
    ageMin: 8,
    ageMax: 11,
    level: "Débutant",
    maxCapacity: 18,
  };
});

afterAll(async () => {
  for (const t of [
    "enrollment_course",
    "enrollment",
    "relationship",
    "person",
    "course",
    "room",
    "site",
    "discipline",
    "instructor",
    "season",
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  }
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("createCourse", () => {
  it("creates the course and the new discipline, then reads it back", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    expect(r.ok).toBe(true);
    const id = r.ok ? r.id : "";
    const lu = await withSchool(school, (tx) => readCourse(tx, id));
    expect(lu).toMatchObject({
      roomId: room,
      instructorId: teacher,
      weekday: 3,
      startTime: "17:00",
      maxCapacity: 18,
      level: "Débutant",
    });
    const [{ n }] =
      await admin`SELECT count(*)::int AS n FROM discipline WHERE school_id = ${school} AND name = 'Jazz'`;
    expect(n).toBe(1);
  });

  it("reuses an existing discipline, case-insensitively", async () => {
    await withSchool(school, (tx) => createCourse(tx, season, { ...base, discipline: { name: " jazz " }, weekday: 5 }));
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM discipline WHERE school_id = ${school}`;
    expect(n).toBe(1);
  });

  it("creates a room and a site on the fly", async () => {
    const r = await withSchool(school, (tx) =>
      createCourse(tx, season, {
        ...base,
        room: { name: "Salle bleue", capacity: 12, site: { name: "Nord", address: "40 avenue des Arts" } },
      }),
    );
    expect(r.ok).toBe(true);
    const [s] =
      await admin`SELECT s.name, s.capacity, si.name AS site FROM room s JOIN site si ON si.id = s.site_id WHERE s.school_id = ${school} AND s.name = 'Salle bleue'`;
    expect(s).toMatchObject({ capacity: 12, site: "Nord" });
  });

  it("rejects a room from another school", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, { ...base, room: { id: foreignRoom } }));
    expect(r).toEqual({ ok: false, message: "Salle introuvable." });
  });

  it("rejects an inactive instructor for a new course", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, { ...base, instructorId: inactiveTeacher }));
    expect(r).toEqual({ ok: false, message: "Intervenant introuvable ou inactif." });
  });
});

describe("updateCourse", () => {
  it("updates the time and capacity", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    const m = await withSchool(school, (tx) =>
      updateCourse(tx, id, { ...base, startTime: "18:15", maxCapacity: null }),
    );
    expect(m).toEqual({ ok: true, id });
    expect(await withSchool(school, (tx) => readCourse(tx, id))).toMatchObject({
      startTime: "18:15",
      maxCapacity: null,
    });
  });

  it("keeps an instructor who became inactive if already on the course", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    await admin`UPDATE course SET instructor_id = ${inactiveTeacher} WHERE id = ${id}`;
    const m = await withSchool(school, (tx) =>
      updateCourse(tx, id, { ...base, instructorId: inactiveTeacher, level: "Moyen" }),
    );
    expect(m.ok).toBe(true);
  });

  it("does not update an unknown course", async () => {
    const m = await withSchool(otherSchool, (tx) => updateCourse(tx, "00000000-0000-4000-8000-000000000000", base));
    expect(m).toEqual({ ok: false, message: "Ce cours n’existe plus." });
  });
});

describe("deleteCourse", () => {
  it("deletes a course without enrolled students", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    expect(await withSchool(school, (tx) => deleteCourse(tx, id))).toEqual({ ok: true, id });
    expect(await withSchool(school, (tx) => readCourse(tx, id))).toBeNull();
  });

  it("refuses to delete a course with enrolled students", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    const [p] = await admin`INSERT INTO person (school_id, last_name) VALUES (${school}, 'Martin') RETURNING id`;
    const [d] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Martin', 'Léa') RETURNING id`;
    const [i] = await admin`
      INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents, status)
      VALUES (${school}, ${season}, ${p.id}, 'child', 'quarter', 10000, 'active') RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, enrollment_id, student_id, course_id) VALUES (${school}, ${i.id}, ${d.id}, ${id})`;
    expect(await withSchool(school, (tx) => deleteCourse(tx, id))).toEqual({
      ok: false,
      message: "Ce cours a 1 inscription : il ne peut pas être supprimé.",
    });
  });
});

describe("scheduleReferential", () => {
  it("returns the school's disciplines, rooms with their site, and active instructors", async () => {
    const r = await withSchool(school, (tx) => scheduleReferential(tx));
    expect(r.rooms).toContainEqual({ id: room, name: "Studio", site: "Centre", siteId: site, capacity: 20 });
    expect(r.rooms.map((s) => s.id)).not.toContain(foreignRoom);
    expect(r.instructors.map((i) => i.id)).toEqual([teacher]);
    expect(r.sites.map((s) => s.name)).toContain("Centre");
    expect(r.disciplines.map((d) => d.name)).toContain("Jazz");
  });
});

describe("moveCourse (calendar view)", () => {
  it("moves and stretches a course without enrolled students", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    expect(
      await withSchool(school, (tx) =>
        moveCourse(tx, id, { weekday: 4, startTime: "18:15", durationMinutes: 90 }, false),
      ),
    ).toEqual({ status: "ok", id });
    expect(await withSchool(school, (tx) => readCourse(tx, id))).toMatchObject({
      weekday: 4,
      startTime: "18:15",
      durationMinutes: 90,
    });
  });

  it("asks for confirmation when students are enrolled, then moves", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    const [p] = await admin`INSERT INTO person (school_id, last_name) VALUES (${school}, 'Payeur') RETURNING id`;
    const [d] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Petit', 'Lou') RETURNING id`;
    const [i] =
      await admin`INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents, status)
      VALUES (${school}, ${season}, ${p.id}, 'child', 'quarter', 10000, 'active') RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, enrollment_id, student_id, course_id) VALUES (${school}, ${i.id}, ${d.id}, ${id})`;
    const slot = { weekday: 5, startTime: "17:00", durationMinutes: 60 };
    expect(await withSchool(school, (tx) => moveCourse(tx, id, slot, false))).toEqual({
      status: "confirm",
      enrolled: 1,
    });
    expect((await withSchool(school, (tx) => readCourse(tx, id)))?.weekday).toBe(3);
    expect(await withSchool(school, (tx) => moveCourse(tx, id, slot, true))).toEqual({ status: "ok", id });
    expect((await withSchool(school, (tx) => readCourse(tx, id)))?.weekday).toBe(5);
  });

  it("rejects a course ending after midnight, a workshop, and a course from another school", async () => {
    const r = await withSchool(school, (tx) => createCourse(tx, season, base));
    const id = r.ok ? r.id : "";
    expect(
      await withSchool(school, (tx) =>
        moveCourse(tx, id, { weekday: 3, startTime: "23:30", durationMinutes: 60 }, true),
      ),
    ).toEqual({
      status: "refused",
      message: "Le cours finirait après minuit.",
    });
    const stage = await withSchool(school, (tx) =>
      createCourse(tx, season, {
        ...base,
        type: "workshop",
        recurrence: "dates",
        weekday: null,
        dates: ["2026-10-24"],
      }),
    );
    expect(
      await withSchool(school, (tx) =>
        moveCourse(tx, stage.ok ? stage.id : "", { weekday: 3, startTime: "10:00", durationMinutes: 60 }, true),
      ),
    ).toEqual({
      status: "refused",
      message: "Un cours à dates précises se modifie depuis sa fiche.",
    });
    expect(
      await withSchool(otherSchool, (tx) =>
        moveCourse(tx, id, { weekday: 2, startTime: "10:00", durationMinutes: 60 }, true),
      ),
    ).toEqual({
      status: "refused",
      message: "Ce cours n’existe plus.",
    });
  });
});
