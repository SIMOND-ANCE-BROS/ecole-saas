import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { addRelationship, searchPeople, updatePerson, updateRelationship, type PersonInput } from "./people";
import { addGuardian, billTo, createStudent, CreationRefusal, setBilling } from "./students";
import {
  GUARDIAN_BECOMES_ORGANISATION_REFUSAL,
  GUARDIAN_PERSON_TYPES,
  ORGANISATION_GUARDIAN_REFUSAL,
  ORGANISATION_WARD_REFUSAL,
  REVERSED_GUARDIAN_PAYER_REFUSAL,
} from "../domain/people/guardian";

/**
 * Legal guardians are individuals, and so are the people they are guardian
 * of (#216, recommended rule pending the school's validation); an
 * organisation can still pay for a student. Run as the app does (app_user,
 * RLS). Each test builds its own people: none depends on another's writes.
 * Fictitious data deleted at the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;

const individual = (fields: Partial<PersonInput>): PersonInput => ({
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
  ...fields,
});

async function insert(fields: Record<string, string | boolean | null>) {
  const [{ id }] = await admin`INSERT INTO person ${admin({ school_id: school, ...fields })} RETURNING id`;
  return id as string;
}

const newStudent = (firstName: string) =>
  insert({ last_name: "Zzélève", first_name: firstName, birth_date: "2015-03-10", is_student: true });
const newOrganisation = (name: string) =>
  insert({ type: "organisation", last_name: name, company_name: name, siren: "000000000" });

const count = async (table: "person" | "relationship") => {
  const [{ n }] = await admin.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE school_id = $1`, [school]);
  return n as number;
};

const relationshipOf = async (personId: string, relatedPersonId: string) => {
  const [r] = await admin`SELECT id, type, pays_for FROM relationship
    WHERE person_id = ${personId} AND related_person_id = ${relatedPersonId}`;
  return r as { id: string; type: string; pays_for: boolean } | undefined;
};

const link = (personId: string, relatedPersonId: string, type: string, paysFor = false) =>
  admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for)
    VALUES (${school}, ${personId}, ${relatedPersonId}, ${type}, ${paysFor}) RETURNING id`.then(
    ([r]) => r.id as string,
  );

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zz', ${`gz-${suffix}`}) RETURNING id`;
});

afterAll(async () => {
  for (const t of ["relationship", "person"]) await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

describe("guardian search", () => {
  it("offers only individuals to the guardian search, every person elsewhere", async () => {
    const student = await newStudent("Zia");
    const organisation = await newOrganisation("Zzrecherche");
    const guardians = await withSchool(school, (tx) => searchPeople(tx, "zz", GUARDIAN_PERSON_TYPES));
    expect(guardians.map((p) => p.id)).toContain(student);
    expect(guardians.every((p) => p.type === "individual")).toBe(true);
    const all = await withSchool(school, (tx) => searchPeople(tx, "zz"));
    expect(all.map((p) => p.id)).toContain(organisation);
  });
});

describe("refusing an organisation on either side of a legal guardian relationship", () => {
  it("refuses an organisation as legal guardian and writes nothing", async () => {
    const [student, organisation] = [await newStudent("Zoé"), await newOrganisation("Zzmairie")];
    const before = await count("relationship");
    const r = await withSchool(school, (tx) =>
      addRelationship(tx, {
        personId: organisation,
        relatedPersonId: student,
        type: "legal_guardian",
        emergencyContact: false,
        paysFor: false,
      }),
    );
    expect(r).toEqual({ ok: false, message: ORGANISATION_GUARDIAN_REFUSAL });
    expect(await count("relationship")).toBe(before);
  });

  it("refuses a legal guardian for an organisation", async () => {
    const [parent, organisation] = [await newStudent("Hélène"), await newOrganisation("Zzpupille")];
    const r = await withSchool(school, (tx) =>
      addRelationship(tx, {
        personId: parent,
        relatedPersonId: organisation,
        type: "legal_guardian",
        emergencyContact: false,
        paysFor: false,
      }),
    );
    expect(r).toEqual({ ok: false, message: ORGANISATION_WARD_REFUSAL });
    expect(await relationshipOf(parent, organisation)).toBeUndefined();
  });

  it("refuses an existing organisation from the student record", async () => {
    const [student, organisation] = [await newStudent("Zélie"), await newOrganisation("Zzcse")];
    const r = await withSchool(school, (tx) => addGuardian(tx, student, { id: organisation }, false));
    expect(r).toEqual({ ok: false, message: ORGANISATION_GUARDIAN_REFUSAL });
    expect(await relationshipOf(organisation, student)).toBeUndefined();
  });

  it("refuses a new organisation from the student record without creating it", async () => {
    const student = await newStudent("Zacharie");
    const before = await count("person");
    const r = await withSchool(school, (tx) =>
      addGuardian(
        tx,
        student,
        { newPerson: individual({ type: "organisation", companyName: "Zzservice", siren: "000000000" }) },
        false,
      ),
    );
    expect(r).toEqual({ ok: false, message: ORGANISATION_GUARDIAN_REFUSAL });
    expect(await count("person")).toBe(before);
  });

  it("refuses the guided creation with an organisation as guardian, and saves nothing", async () => {
    const organisation = await newOrganisation("Zzguide");
    const before = await count("person");
    const created = withSchool(school, (tx) =>
      createStudent(
        tx,
        {
          student: individual({ name: "Zzseul", firstName: "Max", birthDate: "2016-01-01" }),
          guardian: { id: organisation },
          toNotify: false,
          billing: { type: "guardian" },
        },
        true,
      ),
    );
    await expect(created).rejects.toBeInstanceOf(CreationRefusal);
    await expect(created).rejects.toThrow(ORGANISATION_GUARDIAN_REFUSAL);
    expect(await count("person")).toBe(before);
  });

  it("keeps an individual as guardian", async () => {
    const [student, parent] = [await newStudent("Zébulon"), await newStudent("Hector")];
    const r = await withSchool(school, (tx) => addGuardian(tx, student, { id: parent }, true));
    expect(r.ok).toBe(true);
    expect((await relationshipOf(parent, student))?.type).toBe("legal_guardian");
  });
});

describe("changing a person into an organisation", () => {
  it("refuses it for a legal guardian and leaves the person unchanged", async () => {
    const [student, parent] = [await newStudent("Zita"), await newStudent("Henri")];
    await link(parent, student, "legal_guardian");
    const r = await withSchool(school, (tx) =>
      updatePerson(
        tx,
        parent,
        individual({ type: "organisation", name: "Zzélève", companyName: "Zzélève SARL", siren: "000000000" }),
      ),
    );
    expect(r).toEqual({ ok: false, message: GUARDIAN_BECOMES_ORGANISATION_REFUSAL });
    const [p] = await admin`SELECT type, company_name FROM person WHERE id = ${parent}`;
    expect(p).toEqual({ type: "individual", company_name: null });
  });

  it("accepts it for a payer that is no legal guardian", async () => {
    const [student, payer] = [await newStudent("Zara"), await newStudent("Hugo")];
    await link(payer, student, "other", true);
    const r = await withSchool(school, (tx) =>
      updatePerson(tx, payer, individual({ type: "organisation", companyName: "Zzhugo SAS", siren: "000000000" })),
    );
    expect(r.ok).toBe(true);
  });
});

describe("an organisation still pays for a student", () => {
  it("bills the organisation (« Facturé à ») with an « other » relationship", async () => {
    const [student, organisation] = [await newStudent("Zénon"), await newOrganisation("Zzpayeur")];
    const r = await withSchool(school, (tx) => setBilling(tx, student, { type: "person", id: organisation }));
    expect(r.ok).toBe(true);
    expect(await relationshipOf(organisation, student)).toMatchObject({ type: "other", pays_for: true });
  });

  it("refuses turning a « Facturé à » relationship into a legal guardian one", async () => {
    const [student, organisation] = [await newStudent("Zéphyr"), await newOrganisation("Zzpaie")];
    const id = await link(organisation, student, "other", true);
    const r = await withSchool(school, (tx) =>
      updateRelationship(tx, id, { type: "legal_guardian", emergencyContact: false, paysFor: true }),
    );
    expect(r).toEqual({ ok: false, message: ORGANISATION_GUARDIAN_REFUSAL });
    const again = await withSchool(school, (tx) => addGuardian(tx, student, { id: organisation }, false));
    expect(again).toEqual({ ok: false, message: ORGANISATION_GUARDIAN_REFUSAL });
    expect(await relationshipOf(organisation, student)).toMatchObject({ type: "other", pays_for: true });
  });

  it("refuses billing that would reverse a relationship into an organisation guardian, keeping the payer", async () => {
    const [student, payer, other] = [
      await newStudent("Zoltan"),
      await newStudent("Hervé"),
      await newOrganisation("Zzasso"),
    ];
    await link(payer, student, "legal_guardian", true);
    // Legacy or imported row: the student recorded as guardian of an organisation.
    await link(student, other, "legal_guardian");
    const r = await withSchool(school, (tx) => setBilling(tx, student, { type: "person", id: other }));
    expect(r).toEqual({ ok: false, message: REVERSED_GUARDIAN_PAYER_REFUSAL });
    expect(await relationshipOf(student, other)).toMatchObject({ type: "legal_guardian" });
    expect((await relationshipOf(payer, student))?.pays_for).toBe(true);
  });
});

describe("a refused billing change keeps the previous « Facturé à » (#269)", () => {
  const MISSING = "00000000-0000-4000-8000-000000000269";

  it("keeps the previous payer when the new one cannot be found", async () => {
    const [student, payer] = [await newStudent("Zacharie"), await newStudent("Zélie")];
    await link(payer, student, "legal_guardian", true);
    const r = await withSchool(school, (tx) => setBilling(tx, student, { type: "person", id: MISSING }));
    expect(r).toEqual({ ok: false, message: "Personne introuvable." });
    expect((await relationshipOf(payer, student))?.pays_for).toBe(true);
  });

  it("keeps the previous payer when the payer belongs to another school", async () => {
    const [{ id: other }] =
      await admin`INSERT INTO school (name, slug) VALUES ('École Zz bis', ${`gz2-${suffix}`}) RETURNING id`;
    try {
      const [{ id: foreign }] = await admin`INSERT INTO person (school_id, last_name, first_name)
        VALUES (${other}, 'Zzailleurs', 'Zoran') RETURNING id`;
      const [student, payer] = [await newStudent("Zadig"), await newStudent("Zita")];
      await link(payer, student, "other", true);
      const r = await withSchool(school, (tx) => setBilling(tx, student, { type: "person", id: foreign as string }));
      expect(r).toEqual({ ok: false, message: "Personne introuvable." });
      expect((await relationshipOf(payer, student))?.pays_for).toBe(true);
    } finally {
      await admin`DELETE FROM person WHERE school_id = ${other}`;
      await admin`DELETE FROM school WHERE id = ${other}`;
    }
  });

  it("keeps no new payer when billing a student that no longer exists", async () => {
    const before = await count("person");
    const r = await withSchool(school, (tx) =>
      billTo(tx, MISSING, { newPerson: individual({ name: "Zzorphelin", firstName: "Zébulon" }) }),
    );
    expect(r).toEqual({ ok: false, message: "Cet élève n’existe plus." });
    expect(await count("person")).toBe(before);
  });

  it("still records a new payer when the change is accepted", async () => {
    const [student, payer] = [await newStudent("Zéa"), await newStudent("Zohra")];
    await link(payer, student, "legal_guardian", true);
    const r = await withSchool(school, (tx) =>
      billTo(tx, student, { newPerson: individual({ name: "Zzpayeur", firstName: "Zeno" }) }),
    );
    expect(r).toEqual({ ok: true, id: student });
    expect((await relationshipOf(payer, student))?.pays_for).toBe(false);
    const [created] = await admin`SELECT r.type, r.pays_for FROM relationship r JOIN person p ON p.id = r.person_id
      WHERE r.related_person_id = ${student} AND p.first_name = 'Zeno'`;
    expect(created).toEqual({ type: "other", pays_for: true });
  });
});
