import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addGuardian,
  createStudent,
  setBilling,
  readContact,
  readStudent,
  listContacts,
  listStudents,
  CreationRefusal,
  type StudentInput,
} from "./students";
import { withSchool } from "./index";
import type { PersonInput } from "./people";

/** Élèves et contacts (#77), comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const TODAY = "2026-10-20";
let school: string;
let otherSchool: string;
let foreign: string;

const person = (champs: Partial<PersonInput>): PersonInput => ({
  type: "particulier",
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

describe("création guidée", () => {
  it("crée une mineure avec un nouveau responsable, à prévenir et facturé", async () => {
    zoe = idDe(
      await create({
        student: person({ name: "Lefèvre", firstName: "Zoé", birthDate: "2015-03-10" }),
        guardian: { newPerson: person({ name: "Lefèvre", firstName: "Hélène", telephone: "06 12 34 56 78" }) },
        toNotify: true,
        billing: { type: "responsable" },
      }),
    );
    const z = await record(zoe);
    expect(z).toMatchObject({ isStudent: true, firstName: "Zoé" });
    expect(z?.guardians).toMatchObject([
      { name: "Hélène Lefèvre", toNotify: true, paysFor: true, telephone: "06 12 34 56 78" },
    ]);
    helene = z?.guardians[0].id as string;
    expect(z?.billedTo).toEqual({ type: "personne", id: helene, name: "Hélène Lefèvre" });

    const h = await withSchool(school, (tx) => readContact(tx, helene));
    expect(h).toMatchObject({
      isStudent: false,
      students: [{ id: zoe, guardian: true, paysFor: true, toNotify: true }],
    });
  });

  it("signale le responsable déjà connu, puis rattache le frère au même payeur : fratrie", async () => {
    const noe = {
      student: person({ name: "Lefèvre", firstName: "Noé", birthDate: "2017-11-02" }),
      guardian: { newPerson: person({ name: "Lefèvre", firstName: "Hélène", telephone: "0612345678" }) },
      toNotify: true,
      billing: { type: "responsable" as const },
    };
    expect(await create(noe)).toMatchObject({ status: "doublons", duplicates: [{ role: "responsable", id: helene }] });
    const id = idDe(await create({ ...noe, guardian: { id: helene } }));
    expect((await record(id))?.siblings).toEqual([{ id: zoe, firstName: "Zoé" }]);
    expect((await record(zoe))?.siblings.map((f) => f.firstName)).toEqual(["Noé"]);
  });

  it("crée un adulte seul, qui paie lui-même, et signale un mineur sans payeur", async () => {
    const ines = idDe(
      await create({
        student: person({ name: "Moreau", firstName: "Inès", birthDate: "1992-07-14" }),
        guardian: null,
        toNotify: false,
        billing: { type: "eleve" },
      }),
    );
    expect((await record(ines))?.billedTo).toEqual({ type: "eleve" });
    const lou = idDe(
      await create({
        student: person({ name: "Petit", firstName: "Lou", birthDate: "2020-01-01" }),
        guardian: null,
        toNotify: false,
        billing: { type: "eleve" },
      }),
    );
    expect((await record(lou))?.billedTo).toEqual({ type: "aucun" });
  });

  it("facture un organisme créé dans la foulée", async () => {
    const paul = idDe(
      await create({
        student: person({ name: "Durand", firstName: "Paul", birthDate: "1980-01-01" }),
        guardian: null,
        toNotify: false,
        billing: {
          type: "autre",
          payeur: { newPerson: person({ type: "professionnel", companyName: "CSE Ateliers", siren: "123456789" }) },
        },
      }),
    );
    expect((await record(paul))?.billedTo).toMatchObject({ type: "personne", name: "CSE Ateliers" });
    expect((await withSchool(school, (tx) => listContacts(tx, "ateliers"))).map((c) => c.students)).toEqual([["Paul"]]);
  });

  it("n’enregistre rien quand une partie est refusée (responsable d’une autre école)", async () => {
    const [{ before }] = await admin`SELECT count(*)::int AS before FROM person WHERE school_id = ${school}`;
    await expect(
      create(
        {
          student: person({ name: "Seul", firstName: "Max", birthDate: "2016-01-01" }),
          guardian: { id: foreign },
          toNotify: true,
          billing: { type: "responsable" },
        },
        true,
      ),
    ).rejects.toBeInstanceOf(CreationRefusal);
    const [{ after }] = await admin`SELECT count(*)::int AS after FROM person WHERE school_id = ${school}`;
    expect(typeof before).toBe("number");
    expect(after).toBe(before);
  });
});

describe("listes", () => {
  it("liste les élèves avec responsables et payeur, et retrouve un enfant par le téléphone de sa mère", async () => {
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

  it("liste les contacts sans les élèves, ni ceux d’une autre école", async () => {
    const contacts = await withSchool(school, (tx) => listContacts(tx));
    expect(contacts.map((c) => c.companyName ?? c.firstName)).toEqual(["CSE Ateliers", "Hélène"]);
    expect(contacts.find((c) => c.firstName === "Hélène")?.students.sort()).toEqual(["Noé", "Zoé"]);
  });
});

describe("modifications depuis la fiche", () => {
  it("change le payeur : l’élève elle-même, puis à nouveau sa mère", async () => {
    expect(await withSchool(school, (tx) => setBilling(tx, zoe, { type: "eleve" }))).toEqual({
      ok: true,
      id: zoe,
    });
    expect((await record(zoe))?.billedTo).toEqual({ type: "aucun" }); // mineure sans payeur : signalé
    await withSchool(school, (tx) => setBilling(tx, zoe, { type: "personne", id: helene }));
    expect((await record(zoe))?.billedTo).toMatchObject({ type: "personne", id: helene });
  });

  it("retourne un lien saisi dans l’autre sens pour en faire le payeur", async () => {
    const [{ id: conjoint }] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Moreau', 'Sam') RETURNING id`;
    const [{ id: ines }] = await admin`SELECT id FROM person WHERE school_id = ${school} AND first_name = 'Inès'`;
    await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type) VALUES (${school}, ${ines}, ${conjoint}, 'conjoint')`;
    await withSchool(school, (tx) => setBilling(tx, ines, { type: "personne", id: conjoint }));
    const f = await record(ines);
    expect(f?.billedTo).toMatchObject({ type: "personne", name: "Sam Moreau" });
    expect(f?.otherRelationships).toMatchObject([{ name: "Sam Moreau", relation: "conjoint", paysFor: true }]);
  });

  it("fait d’un proche existant un responsable, et refuse un responsable d’une autre école", async () => {
    const [{ id: lou }] = await admin`SELECT id FROM person WHERE school_id = ${school} AND first_name = 'Lou'`;
    expect((await withSchool(school, (tx) => addGuardian(tx, lou, { id: helene }, true))).ok).toBe(true);
    expect((await record(lou))?.guardians).toMatchObject([{ id: helene, toNotify: true, paysFor: false }]);
    expect(await withSchool(school, (tx) => addGuardian(tx, lou, { id: foreign }, true))).toEqual({
      ok: false,
      message: "Responsable introuvable.",
    });
  });

  it("ne lit pas un élève d’une autre école", async () => {
    expect(await withSchool(otherSchool, (tx) => readStudent(tx, zoe, TODAY))).toBeNull();
  });
});
