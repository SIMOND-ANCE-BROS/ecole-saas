import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { addRelationship, searchPeople, updateRelationship, type PersonInput } from "./people";
import { addGuardian, createStudent, CreationRefusal, setBilling } from "./students";
import { GUARDIAN_PERSON_TYPES, ORGANISATION_GUARDIAN_REFUSAL } from "../domain/people/guardian";

/**
 * An organisation cannot be a legal guardian (#216, recommended rule pending
 * the school's validation); it can still pay for a student. Run as the app
 * does (app_user, RLS). Fictitious data deleted at the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let student: string;
let parent: string;
let organisation: string;

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

const count = async (table: "person" | "relationship") => {
  const [{ n }] = await admin.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE school_id = $1`, [school]);
  return n as number;
};

const relationshipOf = async (personId: string, relatedPersonId: string) => {
  const [r] = await admin`SELECT id, type, pays_for FROM relationship
    WHERE person_id = ${personId} AND related_person_id = ${relatedPersonId}`;
  return r as { id: string; type: string; pays_for: boolean } | undefined;
};

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zz', ${`gz-${suffix}`}) RETURNING id`;
  student = await insert({ last_name: "Zzélève", first_name: "Zoé", birth_date: "2015-03-10", is_student: true });
  parent = await insert({ last_name: "Zzélève", first_name: "Hélène" });
  organisation = await insert({
    type: "organisation",
    last_name: "Zzmairie",
    company_name: "Zzmairie de démonstration",
    siren: "000000000",
  });
});

afterAll(async () => {
  for (const t of ["relationship", "person"]) await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

describe("guardian search", () => {
  it("offers only individuals to the guardian search, every person elsewhere", async () => {
    const guardians = await withSchool(school, (tx) => searchPeople(tx, "zz", GUARDIAN_PERSON_TYPES));
    expect(guardians.map((p) => p.type)).toEqual(["individual", "individual"]);
    const all = await withSchool(school, (tx) => searchPeople(tx, "zz"));
    expect(all.map((p) => p.id)).toContain(organisation);
  });
});

describe("refusing an organisation as legal guardian", () => {
  it("refuses the relationship and writes nothing", async () => {
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

  it("refuses an existing organisation from the student record", async () => {
    const r = await withSchool(school, (tx) => addGuardian(tx, student, { id: organisation }, false));
    expect(r).toEqual({ ok: false, message: ORGANISATION_GUARDIAN_REFUSAL });
    expect(await relationshipOf(organisation, student)).toBeUndefined();
  });

  it("refuses a new organisation from the student record without creating it", async () => {
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
    const r = await withSchool(school, (tx) => addGuardian(tx, student, { id: parent }, true));
    expect(r.ok).toBe(true);
    expect((await relationshipOf(parent, student))?.type).toBe("legal_guardian");
  });
});

describe("an organisation still pays for a student", () => {
  it("bills the organisation (« Facturé à ») with an « other » relationship", async () => {
    const r = await withSchool(school, (tx) => setBilling(tx, student, { type: "person", id: organisation }));
    expect(r.ok).toBe(true);
    expect(await relationshipOf(organisation, student)).toMatchObject({ type: "other", pays_for: true });
  });

  it("refuses turning that relationship into a legal guardian", async () => {
    const link = await relationshipOf(organisation, student);
    if (!link) throw new Error("relationship missing");
    const r = await withSchool(school, (tx) =>
      updateRelationship(tx, link.id, { type: "legal_guardian", emergencyContact: false, paysFor: true }),
    );
    expect(r).toEqual({ ok: false, message: ORGANISATION_GUARDIAN_REFUSAL });
    // The existing « Facturé à » relationship is not turned into a guardian one either.
    const again = await withSchool(school, (tx) => addGuardian(tx, student, { id: organisation }, false));
    expect(again).toEqual({ ok: false, message: ORGANISATION_GUARDIAN_REFUSAL });
    expect(await relationshipOf(organisation, student)).toMatchObject({ type: "other", pays_for: true });
  });

  it("refuses billing that would reverse a relationship into an organisation guardian, keeping the payer", async () => {
    const other = await insert({
      type: "organisation",
      last_name: "Zzasso",
      company_name: "Zzasso",
      siren: "000000000",
    });
    // Legacy or imported row: the student recorded as guardian of an organisation.
    await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type)
      VALUES (${school}, ${student}, ${other}, 'legal_guardian')`;
    const r = await withSchool(school, (tx) => setBilling(tx, student, { type: "person", id: other }));
    expect(r).toEqual({ ok: false, message: ORGANISATION_GUARDIAN_REFUSAL });
    expect(await relationshipOf(student, other)).toMatchObject({ type: "legal_guardian" });
    expect((await relationshipOf(organisation, student))?.pays_for).toBe(true);
  });
});
