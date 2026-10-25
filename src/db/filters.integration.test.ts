import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeColumnFilter } from "../domain/filters/column-filter";
import { CONTACT_COLUMNS, type ColumnId, STUDENT_COLUMNS } from "../domain/filters/columns";
import { applyFilter, type Cell, EMPTY_FILTER, readFilter, readSort, EMPTY, toParams } from "../domain/filters/filters";
import { ageAt } from "../domain/people/age";
import { type StudentRow, seasonCourseLabels, listContacts, listStudents } from "./students";
import { withSchool } from "./index";

/** Column filters translated to SQL (#87), as the app does (app_user, RLS). Fictitious data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const TODAY = "2026-10-20";
let school: string;
let otherSchool: string;
let season: string;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`fa-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`fb-${suffix}`}) RETURNING id`;
  const person = async (
    e: string,
    name: string,
    firstName: string | null,
    champs: { birth?: string; telephone?: string; student?: boolean; societe?: string; email?: string } = {},
  ) =>
    (
      await admin`INSERT INTO person (school_id, last_name, first_name, birth_date, phone, is_student, type, company_name, siren, email)
        VALUES (${e}, ${name}, ${firstName}, ${champs.birth ?? null}, ${champs.telephone ?? null}, ${champs.student ?? false},
          ${champs.societe ? "organisation" : "individual"}, ${champs.societe ?? null}, ${champs.societe ? "123456789" : null}, ${champs.email ?? null}) RETURNING id`
    )[0].id as string;
  const relationship = (de: string, to: string, type: string, paysFor = false, emergency = false) =>
    admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for, emergency_contact) VALUES (${school}, ${de}, ${to}, ${type}, ${paysFor}, ${emergency})`;

  // Léa, 8: her mother is her guardian, pays and is the emergency contact (her phone is shown for Léa).
  const lea = await person(school, "Martin", "Léa", { birth: "2018-03-01", student: true });
  const sophie = await person(school, "Martin", "Sophie", {
    telephone: "06 12 34 56 78",
    email: "sophie@exemple.test",
  });
  await relationship(sophie, lea, "legal_guardian", true, true);
  // Hugo, 12: neither guardian nor payer.
  const hugo = await person(school, "Bernard", "Hugo", {
    birth: "2014-01-10",
    telephone: "07 11 22 33 44",
    student: true,
  });
  // Inès, no date of birth: two guardians, paid for by a CSE.
  const ines = await person(school, "Moreau", "Inès", { student: true });
  await relationship(await person(school, "Moreau", "Paul"), ines, "legal_guardian");
  await relationship(await person(school, "Petit", "Anne"), ines, "legal_guardian");
  await relationship(await person(school, "CSE", null, { societe: "CSE Ateliers" }), ines, "other", true);
  // Season: Léa enrolled in Monday 17:00 jazz, Hugo on the waitlist for the same course, Inès not enrolled.
  [{ id: season }] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Jazz') RETURNING id`;
  const [site] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${site.id}, 'Studio') RETURNING id`;
  const [teacher] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${school}, 'Prof', 'Lucas', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  const [jazz] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${school}, ${season}, ${d.id}, ${room.id}, ${teacher.id}, 1, '17:00', 60) RETURNING id`;
  for (const [student, payer, status] of [
    [lea, sophie, "active"],
    [hugo, hugo, "waitlist"],
  ]) {
    const [i] =
      await admin`INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents, status)
      VALUES (${school}, ${season}, ${payer}, 'child', 'quarter', 10000, ${status}) RETURNING id`;
    await admin`INSERT INTO enrollment_course (school_id, enrollment_id, student_id, course_id) VALUES (${school}, ${i.id}, ${student}, ${jazz.id})`;
  }
  // A Léa in another school: never visible.
  await person(otherSchool, "Ailleurs", "Léa", { birth: "2018-03-01", student: true });
});

afterAll(async () => {
  for (const t of [
    "enrollment_course",
    "enrollment",
    "course",
    "instructor",
    "room",
    "site",
    "discipline",
    "season",
    "relationship",
    "person",
  ])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const students = async (f: string[], mode?: string) =>
  (
    await withSchool(school, (tx) =>
      listStudents(tx, "", { filter: readFilter(f, mode, STUDENT_COLUMNS), today: TODAY, seasonId: season }),
    )
  ).map((e) => e.firstName);
const contacts = async (f: string[]) =>
  (await withSchool(school, (tx) => listContacts(tx, "", { filter: readFilter(f, null, CONTACT_COLUMNS) }))).map(
    (c) => c.companyName ?? c.firstName,
  );

const sorted = async (sort: string, order: string) =>
  (
    await withSchool(school, (tx) =>
      listStudents(tx, "", { currentSort: readSort(sort, order, STUDENT_COLUMNS), today: TODAY, seasonId: season }),
    )
  ).map((e) => e.firstName);

describe("sorting and filter buttons (#107)", () => {
  it("sorts by a column, with empty values last in both directions", async () => {
    expect(await sorted("age", "asc")).toEqual(["Léa", "Hugo", "Inès"]);
    expect(await sorted("age", "desc")).toEqual(["Hugo", "Léa", "Inès"]);
    expect(await sorted("nom", "desc")).toEqual(["Léa", "Inès", "Hugo"]);
    expect(await sorted("responsables", "asc")).toEqual(["Inès", "Léa", "Hugo"]);
  });

  it("checkboxes (status, course, « vide ») and bounds, as in memory", async () => {
    const def = (id: string) => STUDENT_COLUMNS.find((c) => c.id === id)!;
    const par = (id: string, fc: Parameters<typeof writeColumnFilter>[2]) =>
      students(toParams(writeColumnFilter(EMPTY_FILTER, def(id), fc)).map(([, v]) => v));
    expect(await par("inscription", { choice: ["Inscrit"] })).toEqual(["Léa"]);
    expect(await par("inscription", { choice: ["En attente", EMPTY] })).toEqual(["Hugo", "Inès"]);
    const labels = await withSchool(school, (tx) => seasonCourseLabels(tx, season));
    expect(labels).toEqual(["Jazz lun. 17:00"]);
    expect(await par("cours", { choice: labels })).toEqual(["Léa"]);
    expect(await par("cours", { choice: [EMPTY] })).toEqual(["Hugo", "Inès"]);
    expect(await par("age", { min: "8", max: "12" })).toEqual(["Hugo", "Léa"]);
    expect(await par("naissance", { min: "2018-03-01" })).toEqual(["Léa"]);
  });
});

describe("students", () => {
  it("name, ignoring accents, without seeing the other school", async () => {
    expect(await students(["nom.contient.LEA"])).toEqual(["Léa"]);
  });

  it("age: comparison, and empty without a birth date", async () => {
    expect(await students(["age.sup.10"])).toEqual(["Hugo"]);
    expect(await students(["age.vide"])).toEqual(["Inès"]);
    expect(await students(["age.different.8"])).toEqual(["Hugo", "Inès"]);
  });

  it("guardians: one item of the list, or an empty list", async () => {
    expect(await students(["responsables.est.anne petit"])).toEqual(["Inès"]);
    expect(await students(["responsables.vide"])).toEqual(["Hugo"]);
  });

  it("billed to and phone (the emergency-contact guardian's phone counts)", async () => {
    expect(await students(["facture.contient.ateliers"])).toEqual(["Inès"]);
    expect(await students(["facture.vide"])).toEqual(["Hugo"]);
    expect(await students(["telephone.contient.12 34"])).toEqual(["Léa"]);
    expect(await students(["telephone.vide"])).toEqual(["Inès"]);
  });

  it("OR and AND", async () => {
    expect(await students(["nom.commence.hugo", "age.vide"], "ou")).toEqual(["Hugo", "Inès"]);
    expect(await students(["nom.commence.hugo", "age.vide"])).toEqual([]);
  });

  it("an apostrophe or a % stays a plain character", async () => {
    expect(await students(["nom.contient.o'brien"])).toEqual([]);
    expect(await students(["nom.contient.%"])).toEqual([]);
  });

  it("SQL and in-memory evaluation give the same result", async () => {
    const toutes = await withSchool(school, (tx) => listStudents(tx, "", { today: TODAY }));
    const columns = STUDENT_COLUMNS.map((c) => ({
      ...c,
      value: (e: StudentRow) => {
        const cells: Partial<Record<ColumnId<typeof STUDENT_COLUMNS>, Cell>> = {
          nom: [e.firstName, e.name].filter(Boolean).join(" "),
          age: e.birthDate ? ageAt(e.birthDate, TODAY) : null,
          responsables: e.guardians,
          facture: e.billedTo,
          telephone: e.telephone,
        };
        return cells[c.id];
      },
    }));
    for (const f of [
      ["nom.ne_contient_pas.martin"],
      ["age.inf_egal.8"],
      ["responsables.contient.moreau"],
      ["facture.non_vide", "telephone.commence.06"],
    ]) {
      const inMemory = applyFilter(toutes, readFilter(f, null, STUDENT_COLUMNS), columns).map((e) => e.firstName);
      expect(await students(f), f.join(" ")).toEqual(inMemory);
    }
  });
});

describe("added columns (#89)", () => {
  it("values: guardian e-mail, season courses, status, emergency contacts", async () => {
    const rows = await withSchool(school, (tx) => listStudents(tx, "", { today: TODAY, seasonId: season }));
    const lea = rows.find((e) => e.firstName === "Léa");
    expect(lea).toMatchObject({
      email: "sophie@exemple.test",
      courses: ["Jazz lun. 17:00"],
      enrollmentStatus: "Inscrit",
      toNotify: ["Sophie Martin, 06 12 34 56 78"],
    });
    // The waitlist is not a course attended.
    expect(rows.find((e) => e.firstName === "Hugo")).toMatchObject({ courses: [], enrollmentStatus: "En attente" });
    expect(rows.find((e) => e.firstName === "Inès")).toMatchObject({
      courses: [],
      enrollmentStatus: null,
      email: null,
    });
  });

  it("filters on these columns", async () => {
    expect(await students(["cours.contient.jazz"])).toEqual(["Léa"]);
    expect(await students(["inscription.est.en attente"])).toEqual(["Hugo"]);
    expect(await students(["inscription.vide"])).toEqual(["Inès"]);
    expect(await students(["naissance.inf.2015-01-01"])).toEqual(["Hugo"]);
    expect(await students(["naissance.vide"])).toEqual(["Inès"]);
    expect(await students(["email.non_vide"])).toEqual(["Léa"]);
    expect(await students(["prevenir.contient.06 12"])).toEqual(["Léa"]);
  });

  it("without a season: no course and no enrollment", async () => {
    const rows = await withSchool(school, (tx) => listStudents(tx, "", { today: TODAY }));
    expect(rows.every((e) => e.courses.length === 0 && e.enrollmentStatus === null)).toBe(true);
  });
});

describe("contacts", () => {
  it("related students, organisation name, e-mail filled in", async () => {
    expect(await contacts(["eleves.contient.lea"])).toEqual(["Sophie"]);
    expect(await contacts(["nom.contient.ateliers"])).toEqual(["CSE Ateliers"]);
    expect(await contacts(["email.non_vide"])).toEqual(["Sophie"]);
  });
});
