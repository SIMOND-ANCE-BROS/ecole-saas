import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import {
  createInstructor,
  readInstructor,
  listInstructors,
  updateInstructor,
  type InstructorInput,
} from "./instructors";

/** Instructors, read and written as the application does (app_user, RLS). Fictitious data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let otherSchool: string;
let season: string;
let foreign: string;

const camille: InstructorInput = {
  firstName: "Camille",
  name: "Durand",
  email: "camille.durand@exemple.test",
  status: "sole_trader",
  siren: "123456789",
  vatRegime: "franchise_293b",
  isOwner: false,
  payMode: "hourly",
  rateCents: 4000,
  active: true,
};

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ia-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`ib-${suffix}`}) RETURNING id`;
  [{ id: season }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: foreign }] = await admin`
    INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${otherSchool}, 'Ailleurs', 'Prof', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
});

afterAll(async () => {
  for (const t of ["course", "room", "site", "discipline", "instructor", "season"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  }
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("createInstructor and readInstructor", () => {
  it("saves the instructor in the current school", async () => {
    const id = await withSchool(school, (tx) => createInstructor(tx, camille));
    expect(await withSchool(school, (tx) => readInstructor(tx, id))).toEqual({ id, ...camille });
    const [{ school_id }] = await admin`SELECT school_id FROM instructor WHERE id = ${id}`;
    expect(school_id).toBe(school);
  });

  it("does not read an instructor from another school", async () => {
    expect(await withSchool(school, (tx) => readInstructor(tx, foreign))).toBeNull();
  });
});

describe("updateInstructor", () => {
  it("updates and deactivates", async () => {
    const id = await withSchool(school, (tx) =>
      createInstructor(tx, { ...camille, firstName: "Inès", name: "Garnier" }),
    );
    const modified = { ...camille, firstName: "Inès", name: "Garnier", rateCents: 4500, active: false };
    expect(await withSchool(school, (tx) => updateInstructor(tx, id, modified, "2026-10-29"))).toEqual({ ok: true });
    expect(await withSchool(school, (tx) => readInstructor(tx, id))).toMatchObject({
      rateCents: 4500,
      active: false,
    });
  });

  it("does not update an instructor from another school", async () => {
    expect(await withSchool(school, (tx) => updateInstructor(tx, foreign, camille, "2026-10-29"))).toMatchObject({
      ok: false,
    });
    const [{ last_name: name }] = await admin`SELECT last_name FROM instructor WHERE id = ${foreign}`;
    expect(name).toBe("Ailleurs");
  });
});

describe("listInstructors", () => {
  it("lists active instructors first, by name, with their courses of the season", async () => {
    const [{ id: lucas }] = await admin`
      INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${school}, 'Faure', 'Lucas', 'company', 'vat_registered', 'per_lesson', 3500) RETURNING id`;
    const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Jazz') RETURNING id`;
    const [s] =
      await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Centre', '1 rue Test') RETURNING id`;
    const [room] =
      await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Studio') RETURNING id`;
    await admin`
      INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${school}, ${season}, ${d.id}, ${room.id}, ${lucas}, 1, '18:00', 60), (${school}, ${season}, ${d.id}, ${room.id}, ${lucas}, 3, '18:00', 90)`;

    const list = await withSchool(school, (tx) => listInstructors(tx, season));
    expect(list.map((i) => `${i.firstName} ${i.name} ${i.active ? "actif" : "inactif"} ${i.seasonCourses}`)).toEqual([
      "Camille Durand actif 0",
      "Lucas Faure actif 2",
      "Inès Garnier inactif 0",
    ]);
  });
});

describe("invalid id", () => {
  it("reads and updates without an SQL error", async () => {
    expect(await withSchool(school, (tx) => readInstructor(tx, "pas-un-uuid"))).toBeNull();
    expect(await withSchool(school, (tx) => updateInstructor(tx, "pas-un-uuid", camille, "2026-10-29"))).toMatchObject({
      ok: false,
    });
  });
});
