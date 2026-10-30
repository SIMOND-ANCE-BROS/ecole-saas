import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import {
  addRelationship,
  createPerson,
  payableStudents,
  readPerson,
  listPeople,
  updateRelationship,
  updatePerson,
  payersOf,
  searchPeople,
  type PersonInput,
  deleteRelationship,
} from "./people";
import { schoolWithDefaultEntity } from "./billing-entity.integration-helpers";

/** People and relationships, read and written as the app does (app_user, RLS). Fictitious data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
let school: string;
let otherSchool: string;
let helene: string;
let zoe: string;
let noe: string;
let alex: string;
let cse: string;
let foreign: string;
let jazz: string;

const empty: PersonInput = {
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
};

async function insert(schoolId: string, fields: Record<string, string | null>) {
  const [{ id }] = await admin`INSERT INTO person ${admin({ school_id: schoolId, ...fields })} RETURNING id`;
  return id as string;
}

async function link(
  personId: string,
  relatedPersonId: string,
  type: string,
  paysFor = false,
  emergencyContact = false,
) {
  await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for, emergency_contact)
    VALUES (${school}, ${personId}, ${relatedPersonId}, ${type}, ${paysFor}, ${emergencyContact})`;
}

beforeAll(async () => {
  [{ id: school }] = await schoolWithDefaultEntity(admin, "École A", `pa-${suffix}`);
  [{ id: otherSchool }] = await schoolWithDefaultEntity(admin, "École B", `pb-${suffix}`);
  helene = await insert(school, {
    last_name: "Lefèvre",
    first_name: "Hélène",
    phone: "06 12 34 56 78",
    email: "helene@exemple.test",
  });
  zoe = await insert(school, { last_name: "Lefèvre", first_name: "Zoé", birth_date: "2015-03-10", notes: "Asthme" });
  noe = await insert(school, { last_name: "Lefèvre", first_name: "Noé", birth_date: "2017-11-02" });
  await admin`UPDATE person SET is_student = true WHERE id IN (${zoe}, ${noe})`;
  alex = await insert(school, {
    last_name: "Rivière",
    first_name: "Alex",
    birth_date: "1996-04-05",
    phone: "07 11 22 33 44",
  });
  await admin`UPDATE person SET is_student = true WHERE id = ${alex}`;
  cse = await insert(school, {
    type: "organisation",
    last_name: "CSE Ateliers",
    company_name: "CSE Ateliers",
    siren: "123456789",
  });
  foreign = await insert(otherSchool, { last_name: "Lefèvre", first_name: "Inconnue", phone: "0612345678" });
  await link(helene, zoe, "legal_guardian", true, true);
  await link(helene, noe, "legal_guardian", true);
  await link(cse, alex, "other", true);

  const [season] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${school}, 'Jazz') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${school}, 'Centre', '1 rue Test') RETURNING id`;
  const [room] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${school}, ${s.id}, 'Studio') RETURNING id`;
  const [teacher] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${school}, 'Roux', 'Mathis', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  [{ id: jazz }] =
    await admin`INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${school}, (SELECT id FROM billing_entity WHERE school_id = ${school} AND is_default), ${season.id}, ${d.id}, ${room.id}, ${teacher.id}, 3, '17:00', 60) RETURNING id`;
  const [i] =
    await admin`INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents)
    VALUES (${school}, (SELECT id FROM billing_entity WHERE school_id = ${school} AND is_default), ${season.id}, ${helene}, 'child', 'quarter', 10000) RETURNING id`;
  await admin`INSERT INTO enrollment_course (school_id, billing_entity_id, enrollment_id, student_id, course_id) VALUES (${school}, (SELECT billing_entity_id FROM enrollment WHERE id = ${i.id}), ${i.id}, ${zoe}, ${jazz})`;
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
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  }
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const search = (q: string) => withSchool(school, (tx) => searchPeople(tx, q));

describe("searchPeople", () => {
  it("finds by name ignoring accents, with related people, without the other school", async () => {
    const r = await search("lefevre");
    expect(r.map((p) => p.firstName)).toEqual(["Hélène", "Noé", "Zoé"]);
    expect(r[0].liees).toEqual(["Noé Lefèvre", "Zoé Lefèvre"]);
    expect(r[2].liees).toEqual(["Hélène Lefèvre"]);
  });

  it('finds by "first last" name, company name and phone without spaces', async () => {
    expect((await search("zoe lefe")).map((p) => p.id)).toEqual([zoe]);
    expect((await search("ateliers")).map((p) => p.id)).toEqual([cse]);
    expect((await search("0612345678")).map((p) => p.id)).toEqual([helene]);
  });

  it("does not search below two characters, and lists the whole school otherwise", async () => {
    expect(await search("z")).toEqual([]);
    expect(await withSchool(school, (tx) => listPeople(tx))).toHaveLength(5);
  });
});

describe("readPerson", () => {
  it("returns relationships in both directions and courses", async () => {
    const z = await withSchool(school, (tx) => readPerson(tx, zoe));
    expect(z).toMatchObject({ firstName: "Zoé", birthDate: "2015-03-10", notes: "Asthme" });
    expect(z?.relationships).toEqual([
      {
        id: expect.any(String),
        other: { id: helene, name: "Hélène Lefèvre", telephone: "06 12 34 56 78", email: "helene@exemple.test" },
        direction: "incoming",
        type: "legal_guardian",
        emergencyContact: true,
        paysFor: true,
      },
    ]);
    expect(z?.courses).toEqual([
      {
        id: jazz,
        season: "2026-2027",
        discipline: "Jazz",
        level: null,
        weekday: 3,
        startTime: "17:00",
        status: "active",
        droppedOn: null,
        payerId: helene,
        presents: 0,
        absents: 0,
      },
    ]);

    const h = await withSchool(school, (tx) => readPerson(tx, helene));
    expect(h?.relationships.map((l) => `${l.other.name} ${l.direction}`)).toEqual([
      "Noé Lefèvre outgoing",
      "Zoé Lefèvre outgoing",
    ]);
  });

  it("does not read a person from another school, nor an invalid id", async () => {
    expect(await withSchool(school, (tx) => readPerson(tx, foreign))).toBeNull();
    expect(await withSchool(school, (tx) => readPerson(tx, "pas-un-uuid"))).toBeNull();
  });
});

describe("payableStudents and payersOf", () => {
  it("a parent enrolls those they pay for, and themselves only if they are a student", async () => {
    expect((await withSchool(school, (tx) => payableStudents(tx, helene))).map((d) => d.firstName)).toEqual([
      "Noé",
      "Zoé",
    ]);
    await admin`UPDATE person SET is_student = true WHERE id = ${helene}`;
    expect((await withSchool(school, (tx) => payableStudents(tx, helene))).map((d) => d.firstName)).toEqual([
      "Hélène",
      "Noé",
      "Zoé",
    ]);
    await admin`UPDATE person SET is_student = false WHERE id = ${helene}`;
  });

  it("an organisation enrolls only those it pays for; an adult on their own enrolls themselves", async () => {
    expect((await withSchool(school, (tx) => payableStudents(tx, cse))).map((d) => d.id)).toEqual([alex]);
    expect((await withSchool(school, (tx) => payableStudents(tx, alex))).map((d) => d.id)).toEqual([alex]);
  });

  it("offers a contact they pay for only once they are a student (#314)", async () => {
    // Hélène pays for a contact who is not a student: offered only once added to the students.
    const contact = await insert(school, { last_name: "Zzcontact", first_name: "Zzpasélève" });
    await link(helene, contact, "other", true);
    const offered = async () => (await withSchool(school, (tx) => payableStudents(tx, helene))).map((d) => d.id);
    expect(await offered()).not.toContain(contact);
    await admin`UPDATE person SET is_student = true WHERE id = ${contact}`;
    expect(await offered()).toContain(contact);
    // Removed so the other tests see Hélène's family unchanged.
    await admin`DELETE FROM relationship WHERE related_person_id = ${contact}`;
    await admin`DELETE FROM person WHERE id = ${contact}`;
  });

  it("returns a student's payers", async () => {
    expect(await withSchool(school, (tx) => payersOf(tx, alex))).toEqual([{ id: cse, name: "CSE Ateliers" }]);
    expect(await withSchool(school, (tx) => payersOf(tx, helene))).toEqual([]);
  });
});

describe("createPerson and updatePerson", () => {
  it("creates a student on their own, then updates them", async () => {
    const r = await withSchool(school, (tx) =>
      createPerson(
        tx,
        { ...empty, name: "Martin", firstName: "Léa", birthDate: "1990-06-21", telephone: "06 98 76 54 32" },
        false,
      ),
    );
    expect(r.status).toBe("ok");
    const id = r.status === "ok" ? r.id : "";
    expect(
      await withSchool(school, (tx) =>
        updatePerson(tx, id, { ...empty, name: "Martin", firstName: "Léa", address: "3 rue des Lilas" }),
      ),
    ).toEqual({
      ok: true,
      id,
    });
    expect(await withSchool(school, (tx) => readPerson(tx, id))).toMatchObject({
      address: "3 rue des Lilas",
      birthDate: null,
    });
  });

  it("flags a likely duplicate (phone without spaces), then creates on confirmation", async () => {
    const julie = { ...empty, name: "Petit", firstName: "Julie", telephone: "0612345678" };
    expect(await withSchool(school, (tx) => createPerson(tx, julie, false))).toEqual({
      status: "duplicates",
      duplicates: [{ id: helene, name: "Hélène Lefèvre", telephone: "06 12 34 56 78" }],
    });
    expect((await withSchool(school, (tx) => createPerson(tx, julie, true))).status).toBe("ok");
  });

  it("creates an already related person: a child whose classes Hélène pays for", async () => {
    const r = await withSchool(school, (tx) =>
      createPerson(tx, { ...empty, name: "Lefèvre", firstName: "Lou", birthDate: "2021-05-04" }, false, {
        otherId: helene,
        source: "other",
        type: "legal_guardian",
        paysFor: true,
        emergencyContact: true,
      }),
    );
    const id = r.status === "ok" ? r.id : "";
    // A contact until marked as a student (#314): only then offered for enrollment.
    const offered = async () => (await withSchool(school, (tx) => payableStudents(tx, helene))).map((d) => d.firstName);
    expect(await offered()).not.toContain("Lou");
    await admin`UPDATE person SET is_student = true WHERE id = ${id}`;
    expect(await offered()).toContain("Lou");
    expect((await withSchool(school, (tx) => readPerson(tx, id)))?.relationships[0]).toMatchObject({
      direction: "incoming",
      emergencyContact: true,
    });
  });

  it("saves an organisation under its company name, without first name or birth date", async () => {
    const r = await withSchool(school, (tx) =>
      createPerson(
        tx,
        {
          ...empty,
          type: "organisation",
          firstName: "X",
          birthDate: "2000-01-01",
          companyName: "Mairie",
          siren: "987654321",
        },
        false,
      ),
    );
    const id = r.status === "ok" ? r.id : "";
    expect(await withSchool(school, (tx) => readPerson(tx, id))).toMatchObject({
      name: "Mairie",
      firstName: null,
      birthDate: null,
      companyName: "Mairie",
      siren: "987654321",
    });
  });
});

describe("relationships", () => {
  it("rejects a second relationship between two people in either direction, and a relationship to oneself", async () => {
    const base = { type: "other" as const, emergencyContact: false, paysFor: false };
    expect(
      await withSchool(school, (tx) => addRelationship(tx, { ...base, personId: zoe, relatedPersonId: helene })),
    ).toEqual({
      ok: false,
      message: "Ces deux personnes sont déjà liées.",
    });
    expect(
      await withSchool(school, (tx) => addRelationship(tx, { ...base, personId: zoe, relatedPersonId: zoe })),
    ).toEqual({
      ok: false,
      message: "Une personne ne peut pas être liée à elle-même.",
    });
  });

  it("rejects a relationship to a person from another school", async () => {
    expect(
      await withSchool(school, (tx) =>
        addRelationship(tx, {
          personId: helene,
          relatedPersonId: foreign,
          type: "partner",
          emergencyContact: false,
          paysFor: false,
        }),
      ),
    ).toEqual({ ok: false, message: "Personne introuvable." });
  });

  it("adds, updates then deletes a relationship", async () => {
    const r = await withSchool(school, (tx) =>
      addRelationship(tx, {
        personId: alex,
        relatedPersonId: noe,
        type: "other",
        emergencyContact: true,
        paysFor: false,
      }),
    );
    const id = r.ok ? r.id : "";
    expect(
      await withSchool(school, (tx) =>
        updateRelationship(tx, id, { type: "other", emergencyContact: false, paysFor: true }),
      ),
    ).toEqual({ ok: true, id });
    expect((await withSchool(school, (tx) => payersOf(tx, noe))).map((p) => p.id).sort()).toEqual(
      [alex, helene].sort(),
    );
    expect(await withSchool(school, (tx) => deleteRelationship(tx, id))).toEqual({ ok: true, id });
    expect(await withSchool(school, (tx) => deleteRelationship(tx, id))).toEqual({
      ok: false,
      message: "Ce lien n’existe plus.",
    });
  });
});
