import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avecEcole } from "./index";
import {
  ajouterLien,
  creerPersonne,
  danseursPayables,
  lirePersonne,
  listerPersonnes,
  modifierLien,
  modifierPersonne,
  payeursDe,
  rechercherPersonnes,
  type SaisiePersonne,
  supprimerLien,
} from "./personnes";

/** Personnes et liens, lus et écrits comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
let ecole: string;
let autreEcole: string;
let helene: string;
let zoe: string;
let noe: string;
let alex: string;
let cse: string;
let etrangere: string;
let jazz: string;

const vide: SaisiePersonne = {
  type: "particulier",
  nom: "",
  prenom: null,
  raisonSociale: null,
  siren: null,
  dateNaissance: null,
  email: null,
  telephone: null,
  adresse: null,
  notes: null,
};

async function inserer(ecoleId: string, champs: Record<string, string | null>) {
  const [{ id }] = await admin`INSERT INTO person ${admin({ school_id: ecoleId, ...champs })} RETURNING id`;
  return id as string;
}

async function lier(personneId: string, lieAId: string, type: string, paiePour = false, contactUrgence = false) {
  await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for, emergency_contact)
    VALUES (${ecole}, ${personneId}, ${lieAId}, ${type}, ${paiePour}, ${contactUrgence})`;
}

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`pa-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`pb-${suffixe}`}) RETURNING id`;
  helene = await inserer(ecole, {
    last_name: "Lefèvre",
    first_name: "Hélène",
    phone: "06 12 34 56 78",
    email: "helene@exemple.test",
  });
  zoe = await inserer(ecole, { last_name: "Lefèvre", first_name: "Zoé", birth_date: "2015-03-10", notes: "Asthme" });
  noe = await inserer(ecole, { last_name: "Lefèvre", first_name: "Noé", birth_date: "2017-11-02" });
  alex = await inserer(ecole, {
    last_name: "Rivière",
    first_name: "Alex",
    birth_date: "1996-04-05",
    phone: "07 11 22 33 44",
  });
  await admin`UPDATE person SET is_student = true WHERE id = ${alex}`;
  cse = await inserer(ecole, {
    type: "professionnel",
    last_name: "CSE Ateliers",
    company_name: "CSE Ateliers",
    siren: "123456789",
  });
  etrangere = await inserer(autreEcole, { last_name: "Lefèvre", first_name: "Inconnue", phone: "0612345678" });
  await lier(helene, zoe, "representant_legal", true, true);
  await lier(helene, noe, "representant_legal", true);
  await lier(cse, alex, "autre", true);

  const [saison] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${ecole}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${ecole}, 'Jazz') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${ecole}, 'Centre', '1 rue Test') RETURNING id`;
  const [salle] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${ecole}, ${s.id}, 'Studio') RETURNING id`;
  const [prof] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${ecole}, 'Roux', 'Mathis', 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`;
  [{ id: jazz }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${ecole}, ${saison.id}, ${d.id}, ${salle.id}, ${prof.id}, 3, '17:00', 60) RETURNING id`;
  const [i] = await admin`INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents)
    VALUES (${ecole}, ${saison.id}, ${helene}, 'enfant', 'trimestre', 10000) RETURNING id`;
  await admin`INSERT INTO enrollment_course (school_id, enrollment_id, student_id, course_id) VALUES (${ecole}, ${i.id}, ${zoe}, ${jazz})`;
  await admin`INSERT INTO student_document (school_id, student_id, type, valid_until) VALUES (${ecole}, ${zoe}, 'certificat_medical', '2027-09-30')`;
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
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [ecole, autreEcole]);
  }
  await admin`DELETE FROM school WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

const chercher = (q: string) => avecEcole(ecole, (tx) => rechercherPersonnes(tx, q));

describe("rechercherPersonnes", () => {
  it("trouve par nom sans accents, avec les personnes liées, sans l’autre école", async () => {
    const r = await chercher("lefevre");
    expect(r.map((p) => p.prenom)).toEqual(["Hélène", "Noé", "Zoé"]);
    expect(r[0].liees).toEqual(["Noé Lefèvre", "Zoé Lefèvre"]);
    expect(r[2].liees).toEqual(["Hélène Lefèvre"]);
  });

  it("trouve par « prénom nom », raison sociale et téléphone sans espaces", async () => {
    expect((await chercher("zoe lefe")).map((p) => p.id)).toEqual([zoe]);
    expect((await chercher("ateliers")).map((p) => p.id)).toEqual([cse]);
    expect((await chercher("0612345678")).map((p) => p.id)).toEqual([helene]);
  });

  it("ne cherche pas en dessous de deux caractères, et liste toute l’école sinon", async () => {
    expect(await chercher("z")).toEqual([]);
    expect(await avecEcole(ecole, (tx) => listerPersonnes(tx))).toHaveLength(5);
  });
});

describe("lirePersonne", () => {
  it("donne les liens dans les deux sens, les cours et les documents", async () => {
    const z = await avecEcole(ecole, (tx) => lirePersonne(tx, zoe));
    expect(z).toMatchObject({ prenom: "Zoé", dateNaissance: "2015-03-10", notes: "Asthme" });
    expect(z?.liens).toEqual([
      {
        id: expect.any(String),
        autre: { id: helene, nom: "Hélène Lefèvre", telephone: "06 12 34 56 78", email: "helene@exemple.test" },
        sens: "vers",
        type: "representant_legal",
        contactUrgence: true,
        paiePour: true,
      },
    ]);
    expect(z?.cours).toEqual([
      {
        id: jazz,
        saison: "2026-2027",
        discipline: "Jazz",
        niveau: null,
        jourSemaine: 3,
        heureDebut: "17:00",
        statut: "active",
        payeurId: helene,
        presents: 0,
        absents: 0,
      },
    ]);
    expect(z?.documents).toEqual([{ type: "certificat_medical", accorde: true, valideJusqu: "2027-09-30" }]);

    const h = await avecEcole(ecole, (tx) => lirePersonne(tx, helene));
    expect(h?.liens.map((l) => `${l.autre.nom} ${l.sens}`)).toEqual(["Noé Lefèvre de", "Zoé Lefèvre de"]);
  });

  it("ne lit pas une personne d’une autre école, ni un identifiant invalide", async () => {
    expect(await avecEcole(ecole, (tx) => lirePersonne(tx, etrangere))).toBeNull();
    expect(await avecEcole(ecole, (tx) => lirePersonne(tx, "pas-un-uuid"))).toBeNull();
  });
});

describe("danseursPayables et payeursDe", () => {
  it("un parent inscrit ceux pour qui il paie, et lui-même seulement s’il est élève", async () => {
    expect((await avecEcole(ecole, (tx) => danseursPayables(tx, helene))).map((d) => d.prenom)).toEqual(["Noé", "Zoé"]);
    await admin`UPDATE person SET is_student = true WHERE id = ${helene}`;
    expect((await avecEcole(ecole, (tx) => danseursPayables(tx, helene))).map((d) => d.prenom)).toEqual([
      "Hélène",
      "Noé",
      "Zoé",
    ]);
    await admin`UPDATE person SET is_student = false WHERE id = ${helene}`;
  });

  it("un professionnel n’inscrit que ceux pour qui il paie ; un adulte seul s’inscrit lui-même", async () => {
    expect((await avecEcole(ecole, (tx) => danseursPayables(tx, cse))).map((d) => d.id)).toEqual([alex]);
    expect((await avecEcole(ecole, (tx) => danseursPayables(tx, alex))).map((d) => d.id)).toEqual([alex]);
  });

  it("donne les payeurs d’un danseur", async () => {
    expect(await avecEcole(ecole, (tx) => payeursDe(tx, alex))).toEqual([{ id: cse, nom: "CSE Ateliers" }]);
    expect(await avecEcole(ecole, (tx) => payeursDe(tx, helene))).toEqual([]);
  });
});

describe("creerPersonne et modifierPersonne", () => {
  it("crée un danseur seul, puis le modifie", async () => {
    const r = await avecEcole(ecole, (tx) =>
      creerPersonne(
        tx,
        { ...vide, nom: "Martin", prenom: "Léa", dateNaissance: "1990-06-21", telephone: "06 98 76 54 32" },
        false,
      ),
    );
    expect(r.statut).toBe("ok");
    const id = r.statut === "ok" ? r.id : "";
    expect(
      await avecEcole(ecole, (tx) =>
        modifierPersonne(tx, id, { ...vide, nom: "Martin", prenom: "Léa", adresse: "3 rue des Lilas" }),
      ),
    ).toEqual({
      ok: true,
      id,
    });
    expect(await avecEcole(ecole, (tx) => lirePersonne(tx, id))).toMatchObject({
      adresse: "3 rue des Lilas",
      dateNaissance: null,
    });
  });

  it("signale un doublon probable (téléphone sans espaces), puis crée si l’on confirme", async () => {
    const julie = { ...vide, nom: "Petit", prenom: "Julie", telephone: "0612345678" };
    expect(await avecEcole(ecole, (tx) => creerPersonne(tx, julie, false))).toEqual({
      statut: "doublons",
      doublons: [{ id: helene, nom: "Hélène Lefèvre", telephone: "06 12 34 56 78" }],
    });
    expect((await avecEcole(ecole, (tx) => creerPersonne(tx, julie, true))).statut).toBe("ok");
  });

  it("crée une personne déjà liée : un enfant dont Hélène paie les cours", async () => {
    const r = await avecEcole(ecole, (tx) =>
      creerPersonne(tx, { ...vide, nom: "Lefèvre", prenom: "Lou", dateNaissance: "2021-05-04" }, false, {
        autreId: helene,
        de: "autre",
        type: "representant_legal",
        paiePour: true,
        contactUrgence: true,
      }),
    );
    const id = r.statut === "ok" ? r.id : "";
    expect((await avecEcole(ecole, (tx) => danseursPayables(tx, helene))).map((d) => d.prenom)).toContain("Lou");
    expect((await avecEcole(ecole, (tx) => lirePersonne(tx, id)))?.liens[0]).toMatchObject({
      sens: "vers",
      contactUrgence: true,
    });
  });

  it("enregistre un professionnel sous sa raison sociale, sans prénom ni naissance", async () => {
    const r = await avecEcole(ecole, (tx) =>
      creerPersonne(
        tx,
        {
          ...vide,
          type: "professionnel",
          prenom: "X",
          dateNaissance: "2000-01-01",
          raisonSociale: "Mairie",
          siren: "987654321",
        },
        false,
      ),
    );
    const id = r.statut === "ok" ? r.id : "";
    expect(await avecEcole(ecole, (tx) => lirePersonne(tx, id))).toMatchObject({
      nom: "Mairie",
      prenom: null,
      dateNaissance: null,
      raisonSociale: "Mairie",
      siren: "987654321",
    });
  });
});

describe("liens", () => {
  it("refuse un second lien entre deux personnes, quel que soit le sens, et un lien vers soi-même", async () => {
    const base = { type: "autre" as const, contactUrgence: false, paiePour: false };
    expect(await avecEcole(ecole, (tx) => ajouterLien(tx, { ...base, personneId: zoe, lieAId: helene }))).toEqual({
      ok: false,
      message: "Ces deux personnes sont déjà liées.",
    });
    expect(await avecEcole(ecole, (tx) => ajouterLien(tx, { ...base, personneId: zoe, lieAId: zoe }))).toEqual({
      ok: false,
      message: "Une personne ne peut pas être liée à elle-même.",
    });
  });

  it("refuse un lien vers une personne d’une autre école", async () => {
    expect(
      await avecEcole(ecole, (tx) =>
        ajouterLien(tx, {
          personneId: helene,
          lieAId: etrangere,
          type: "conjoint",
          contactUrgence: false,
          paiePour: false,
        }),
      ),
    ).toEqual({ ok: false, message: "Personne introuvable." });
  });

  it("ajoute, modifie puis supprime un lien", async () => {
    const r = await avecEcole(ecole, (tx) =>
      ajouterLien(tx, { personneId: alex, lieAId: noe, type: "autre", contactUrgence: true, paiePour: false }),
    );
    const id = r.ok ? r.id : "";
    expect(
      await avecEcole(ecole, (tx) => modifierLien(tx, id, { type: "autre", contactUrgence: false, paiePour: true })),
    ).toEqual({ ok: true, id });
    expect((await avecEcole(ecole, (tx) => payeursDe(tx, noe))).map((p) => p.id).sort()).toEqual([alex, helene].sort());
    expect(await avecEcole(ecole, (tx) => supprimerLien(tx, id))).toEqual({ ok: true, id });
    expect(await avecEcole(ecole, (tx) => supprimerLien(tx, id))).toEqual({
      ok: false,
      message: "Ce lien n’existe plus.",
    });
  });
});
