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

const vide: PersonInput = {
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

async function insert(schoolId: string, champs: Record<string, string | null>) {
  const [{ id }] = await admin`INSERT INTO person ${admin({ school_id: schoolId, ...champs })} RETURNING id`;
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
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`pa-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`pb-${suffix}`}) RETURNING id`;
  helene = await insert(school, {
    last_name: "Lefèvre",
    first_name: "Hélène",
    phone: "06 12 34 56 78",
    email: "helene@exemple.test",
  });
  zoe = await insert(school, { last_name: "Lefèvre", first_name: "Zoé", birth_date: "2015-03-10", notes: "Asthme" });
  noe = await insert(school, { last_name: "Lefèvre", first_name: "Noé", birth_date: "2017-11-02" });
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
    VALUES (${school}, 'Roux', 'Mathis', 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`;
  [{ id: jazz }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${school}, ${season.id}, ${d.id}, ${room.id}, ${teacher.id}, 3, '17:00', 60) RETURNING id`;
  const [i] = await admin`INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents)
    VALUES (${school}, ${season.id}, ${helene}, 'enfant', 'trimestre', 10000) RETURNING id`;
  await admin`INSERT INTO enrollment_course (school_id, enrollment_id, student_id, course_id) VALUES (${school}, ${i.id}, ${zoe}, ${jazz})`;
  await admin`INSERT INTO student_document (school_id, student_id, type, valid_until) VALUES (${school}, ${zoe}, 'medical_certificate', '2027-09-30')`;
});

afterAll(async () => {
  for (const t of [
    "student_document",
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

describe("rechercherPersonnes", () => {
  it("trouve par nom sans accents, avec les personnes liées, sans l’autre école", async () => {
    const r = await search("lefevre");
    expect(r.map((p) => p.firstName)).toEqual(["Hélène", "Noé", "Zoé"]);
    expect(r[0].liees).toEqual(["Noé Lefèvre", "Zoé Lefèvre"]);
    expect(r[2].liees).toEqual(["Hélène Lefèvre"]);
  });

  it("trouve par « prénom nom », raison sociale et téléphone sans espaces", async () => {
    expect((await search("zoe lefe")).map((p) => p.id)).toEqual([zoe]);
    expect((await search("ateliers")).map((p) => p.id)).toEqual([cse]);
    expect((await search("0612345678")).map((p) => p.id)).toEqual([helene]);
  });

  it("ne cherche pas en dessous de deux caractères, et liste toute l’école sinon", async () => {
    expect(await search("z")).toEqual([]);
    expect(await withSchool(school, (tx) => listPeople(tx))).toHaveLength(5);
  });
});

describe("lirePersonne", () => {
  it("donne les liens dans les deux sens, les cours et les documents", async () => {
    const z = await withSchool(school, (tx) => readPerson(tx, zoe));
    expect(z).toMatchObject({ firstName: "Zoé", birthDate: "2015-03-10", notes: "Asthme" });
    expect(z?.relationships).toEqual([
      {
        id: expect.any(String),
        autre: { id: helene, name: "Hélène Lefèvre", telephone: "06 12 34 56 78", email: "helene@exemple.test" },
        sens: "vers",
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
        payerId: helene,
        presents: 0,
        absents: 0,
      },
    ]);
    expect(z?.documents).toEqual([{ type: "medical_certificate", granted: true, validUntil: "2027-09-30" }]);

    const h = await withSchool(school, (tx) => readPerson(tx, helene));
    expect(h?.relationships.map((l) => `${l.autre.name} ${l.sens}`)).toEqual(["Noé Lefèvre de", "Zoé Lefèvre de"]);
  });

  it("ne lit pas une personne d’une autre école, ni un identifiant invalide", async () => {
    expect(await withSchool(school, (tx) => readPerson(tx, foreign))).toBeNull();
    expect(await withSchool(school, (tx) => readPerson(tx, "pas-un-uuid"))).toBeNull();
  });
});

describe("danseursPayables et payeursDe", () => {
  it("un parent inscrit ceux pour qui il paie, et lui-même seulement s’il est élève", async () => {
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

  it("un professionnel n’inscrit que ceux pour qui il paie ; un adulte seul s’inscrit lui-même", async () => {
    expect((await withSchool(school, (tx) => payableStudents(tx, cse))).map((d) => d.id)).toEqual([alex]);
    expect((await withSchool(school, (tx) => payableStudents(tx, alex))).map((d) => d.id)).toEqual([alex]);
  });

  it("donne les payeurs d’un danseur", async () => {
    expect(await withSchool(school, (tx) => payersOf(tx, alex))).toEqual([{ id: cse, name: "CSE Ateliers" }]);
    expect(await withSchool(school, (tx) => payersOf(tx, helene))).toEqual([]);
  });
});

describe("creerPersonne et modifierPersonne", () => {
  it("crée un danseur seul, puis le modifie", async () => {
    const r = await withSchool(school, (tx) =>
      createPerson(
        tx,
        { ...vide, name: "Martin", firstName: "Léa", birthDate: "1990-06-21", telephone: "06 98 76 54 32" },
        false,
      ),
    );
    expect(r.status).toBe("ok");
    const id = r.status === "ok" ? r.id : "";
    expect(
      await withSchool(school, (tx) =>
        updatePerson(tx, id, { ...vide, name: "Martin", firstName: "Léa", address: "3 rue des Lilas" }),
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

  it("signale un doublon probable (téléphone sans espaces), puis crée si l’on confirme", async () => {
    const julie = { ...vide, name: "Petit", firstName: "Julie", telephone: "0612345678" };
    expect(await withSchool(school, (tx) => createPerson(tx, julie, false))).toEqual({
      status: "doublons",
      duplicates: [{ id: helene, name: "Hélène Lefèvre", telephone: "06 12 34 56 78" }],
    });
    expect((await withSchool(school, (tx) => createPerson(tx, julie, true))).status).toBe("ok");
  });

  it("crée une personne déjà liée : un enfant dont Hélène paie les cours", async () => {
    const r = await withSchool(school, (tx) =>
      createPerson(tx, { ...vide, name: "Lefèvre", firstName: "Lou", birthDate: "2021-05-04" }, false, {
        otherId: helene,
        de: "autre",
        type: "legal_guardian",
        paysFor: true,
        emergencyContact: true,
      }),
    );
    const id = r.status === "ok" ? r.id : "";
    expect((await withSchool(school, (tx) => payableStudents(tx, helene))).map((d) => d.firstName)).toContain("Lou");
    expect((await withSchool(school, (tx) => readPerson(tx, id)))?.relationships[0]).toMatchObject({
      sens: "vers",
      emergencyContact: true,
    });
  });

  it("enregistre un professionnel sous sa raison sociale, sans prénom ni naissance", async () => {
    const r = await withSchool(school, (tx) =>
      createPerson(
        tx,
        {
          ...vide,
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

describe("liens", () => {
  it("refuse un second lien entre deux personnes, quel que soit le sens, et un lien vers soi-même", async () => {
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

  it("refuse un lien vers une personne d’une autre école", async () => {
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

  it("ajoute, modifie puis supprime un lien", async () => {
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
