import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addGuardian,
  createStudent,
  setBilling,
  readContact,
  readStudent,
  countContacts,
  countStudents,
  listContacts,
  listStudents,
  CreationRefusal,
  type StudentInput,
} from "./students";
import { withSchool } from "./index";
import type { PersonInput } from "./people";

/** Students and contacts (#77), as the application runs them (app_user, RLS). Fictitious data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const TODAY = "2026-10-20";
let school: string;
let otherSchool: string;
let foreign: string;

const person = (champs: Partial<PersonInput>): PersonInput => ({
  type: "individual",
  name: "",
  firstName: null,
  companyName: null,
  siren: null,
  birthDate: null,
  email: null,
  telephone: null,
  address: null,
  notes: null,
  ...champs,
});

const create = (s: StudentInput, confirmed = false) => withSchool(school, (tx) => createStudent(tx, s, confirmed));
const record = (id: string) => withSchool(school, (tx) => readStudent(tx, id, TODAY));
const idDe = (r: Awaited<ReturnType<typeof create>>) => {
  if (r.status !== "ok") throw new Error("création refusée");
  return r.id;
};

let zoe: string;
let helene: string;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ea-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`eb-${suffix}`}) RETURNING id`;
  [{ id: foreign }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${otherSchool}, 'Ailleurs', 'Inconnue') RETURNING id`;
});

afterAll(async () => {
  for (const t of ["relationship", "person"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("guided creation", () => {
  it("creates a minor with a new guardian, emergency contact and payer", async () => {
    zoe = idDe(
      await create({
        student: person({ name: "Lefèvre", firstName: "Zoé", birthDate: "2015-03-10" }),
        guardian: { newPerson: person({ name: "Lefèvre", firstName: "Hélène", telephone: "06 12 34 56 78" }) },
        toNotify: true,
        billing: { type: "guardian" },
      }),
    );
    const z = await record(zoe);
    expect(z).toMatchObject({ isStudent: true, firstName: "Zoé" });
    expect(z?.guardians).toMatchObject([
      { name: "Hélène Lefèvre", toNotify: true, paysFor: true, telephone: "06 12 34 56 78" },
    ]);
    helene = z?.guardians[0].id as string;
    expect(z?.billedTo).toEqual({ type: "person", id: helene, name: "Hélène Lefèvre" });

    const h = await withSchool(school, (tx) => readContact(tx, helene));
    expect(h).toMatchObject({
      isStudent: false,
      students: [{ id: zoe, guardian: true, paysFor: true, toNotify: true }],
    });
  });

  it("flags the already known guardian, then links the brother to the same payer: siblings", async () => {
    const noe = {
      student: person({ name: "Lefèvre", firstName: "Noé", birthDate: "2017-11-02" }),
      guardian: { newPerson: person({ name: "Lefèvre", firstName: "Hélène", telephone: "0612345678" }) },
      toNotify: true,
      billing: { type: "guardian" as const },
    };
    expect(await create(noe)).toMatchObject({
      status: "duplicates",
      duplicates: [{ role: "responsable", id: helene }],
    });
    const id = idDe(await create({ ...noe, guardian: { id: helene } }));
    expect((await record(id))?.siblings).toEqual([{ id: zoe, firstName: "Zoé" }]);
    expect((await record(zoe))?.siblings.map((f) => f.firstName)).toEqual(["Noé"]);
  });

  it("creates an adult on their own who pays for themselves, and flags a minor without a payer", async () => {
    const ines = idDe(
      await create({
        student: person({ name: "Moreau", firstName: "Inès", birthDate: "1992-07-14" }),
        guardian: null,
        toNotify: false,
        billing: { type: "self" },
      }),
    );
    expect((await record(ines))?.billedTo).toEqual({ type: "self" });
    const lou = idDe(
      await create({
        student: person({ name: "Petit", firstName: "Lou", birthDate: "2020-01-01" }),
        guardian: null,
        toNotify: false,
        billing: { type: "self" },
      }),
    );
    expect((await record(lou))?.billedTo).toEqual({ type: "none" });
  });

  it("bills an organisation created on the fly", async () => {
    const paul = idDe(
      await create({
        student: person({ name: "Durand", firstName: "Paul", birthDate: "1980-01-01" }),
        guardian: null,
        toNotify: false,
        billing: {
          type: "other",
          payer: { newPerson: person({ type: "organisation", companyName: "CSE Ateliers", siren: "123456789" }) },
        },
      }),
    );
    expect((await record(paul))?.billedTo).toMatchObject({ type: "person", name: "CSE Ateliers" });
    expect((await withSchool(school, (tx) => listContacts(tx, "ateliers"))).map((c) => c.students)).toEqual([["Paul"]]);
  });

  it("saves nothing when one part is rejected (guardian from another school)", async () => {
    const [{ before }] = await admin`SELECT count(*)::int AS before FROM person WHERE school_id = ${school}`;
    await expect(
      create(
        {
          student: person({ name: "Seul", firstName: "Max", birthDate: "2016-01-01" }),
          guardian: { id: foreign },
          toNotify: true,
          billing: { type: "guardian" },
        },
        true,
      ),
    ).rejects.toBeInstanceOf(CreationRefusal);
    const [{ after }] = await admin`SELECT count(*)::int AS after FROM person WHERE school_id = ${school}`;
    expect(typeof before).toBe("number");
    expect(after).toBe(before);
  });
});

describe("lists", () => {
  it("lists students with guardians and payer, and finds a child by their mother's phone", async () => {
    const students = await withSchool(school, (tx) => listStudents(tx));
    expect(students.map((e) => e.firstName)).toEqual(["Paul", "Noé", "Zoé", "Inès", "Lou"]);
    expect(students.find((e) => e.firstName === "Zoé")).toMatchObject({
      guardians: ["Hélène Lefèvre"],
      billedTo: "Hélène Lefèvre",
      telephone: "06 12 34 56 78",
    });
    expect((await withSchool(school, (tx) => listStudents(tx, "0612345678"))).map((e) => e.firstName)).toEqual([
      "Noé",
      "Zoé",
    ]);
    expect(await withSchool(school, (tx) => listStudents(tx, "x"))).toEqual([]);
  });

  it("lists contacts without students, nor those of another school", async () => {
    const contacts = await withSchool(school, (tx) => listContacts(tx));
    expect(contacts.map((c) => c.companyName ?? c.firstName)).toEqual(["CSE Ateliers", "Hélène"]);
    expect(contacts.find((c) => c.firstName === "Hélène")?.students.sort()).toEqual(["Noé", "Zoé"]);
  });

  it("counts all the matching rows and pages them (#107)", async () => {
    expect(await withSchool(school, (tx) => countStudents(tx))).toBe(5);
    expect(await withSchool(school, (tx) => countStudents(tx, "0612345678"))).toBe(2);
    expect(await withSchool(school, (tx) => countStudents(tx, "x"))).toBe(0);
    expect(await withSchool(school, (tx) => countContacts(tx))).toBe(2);
    // Page 2 starts after the first PAGE_SIZE rows: empty for this small school.
    expect(await withSchool(school, (tx) => listStudents(tx, "", { page: 2 }))).toEqual([]);
    expect((await withSchool(school, (tx) => listStudents(tx, "", { page: 1 }))).length).toBe(5);
  });
});

describe("changes from the person record", () => {
  it("changes the payer: the student herself, then her mother again", async () => {
    expect(await withSchool(school, (tx) => setBilling(tx, zoe, { type: "self" }))).toEqual({
      ok: true,
      id: zoe,
    });
    expect((await record(zoe))?.billedTo).toEqual({ type: "none" }); // minor without a payer: flagged
    await withSchool(school, (tx) => setBilling(tx, zoe, { type: "person", id: helene }));
    expect((await record(zoe))?.billedTo).toMatchObject({ type: "person", id: helene });
  });

  it("reverses a relationship entered the other way round to make them the payer", async () => {
    const [{ id: conjoint }] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Moreau', 'Sam') RETURNING id`;
    const [{ id: ines }] = await admin`SELECT id FROM person WHERE school_id = ${school} AND first_name = 'Inès'`;
    await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type) VALUES (${school}, ${ines}, ${conjoint}, 'partner')`;
    await withSchool(school, (tx) => setBilling(tx, ines, { type: "person", id: conjoint }));
    const f = await record(ines);
    expect(f?.billedTo).toMatchObject({ type: "person", name: "Sam Moreau" });
    expect(f?.otherRelationships).toMatchObject([{ name: "Sam Moreau", relation: "partner", paysFor: true }]);
  });

  it("makes an existing relative a guardian, and rejects a guardian from another school", async () => {
    const [{ id: lou }] = await admin`SELECT id FROM person WHERE school_id = ${school} AND first_name = 'Lou'`;
    expect((await withSchool(school, (tx) => addGuardian(tx, lou, { id: helene }, true))).ok).toBe(true);
    expect((await record(lou))?.guardians).toMatchObject([{ id: helene, toNotify: true, paysFor: false }]);
    expect(await withSchool(school, (tx) => addGuardian(tx, lou, { id: foreign }, true))).toEqual({
      ok: false,
      message: "Responsable introuvable.",
    });
  });

  it("does not read a student from another school", async () => {
    expect(await withSchool(otherSchool, (tx) => readStudent(tx, zoe, TODAY))).toBeNull();
  });
});
