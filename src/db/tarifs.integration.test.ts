import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avecEcole } from "./index";
import { apercuInscription } from "./inscriptions";
import {
  enregistrerCarnet,
  enregistrerFratrie,
  enregistrerPrix,
  grilleSaison,
  lireFratrie,
  listerCarnets,
  supprimerCarnet,
} from "./tarifs";

/** Grille tarifaire, fratrie et carnets saisis (#80), comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
let ecole: string;
let autreEcole: string;
let saison: string;
let zumba: string;
let coursZumba: string;
let ines: string;
let payeur: string;

const prix = (s: Parameters<typeof enregistrerPrix>[2]) => avecEcole(ecole, (tx) => enregistrerPrix(tx, saison, s));

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ta-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`tb-${suffixe}`}) RETURNING id`;
  [{ id: saison }] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${ecole}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: zumba }] = await admin`INSERT INTO discipline (school_id, name) VALUES (${ecole}, 'Zumba') RETURNING id`;
  const [s] =
    await admin`INSERT INTO site (school_id, name, address) VALUES (${ecole}, 'Centre', '1 rue Test') RETURNING id`;
  const [salle] =
    await admin`INSERT INTO room (school_id, site_id, name) VALUES (${ecole}, ${s.id}, 'Studio') RETURNING id`;
  const [p] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${ecole}, 'Prof', 'Lucas', 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`;
  [{ id: coursZumba }] =
    await admin`INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${ecole}, ${saison}, ${zumba}, ${salle.id}, ${p.id}, 1, '19:00', 60) RETURNING id`;
  // Payée par un tiers (lien « paie pour ») : indépendant de la façon dont l'élève elle-même est marquée.
  [{ id: ines }] =
    await admin`INSERT INTO person (school_id, last_name, first_name, birth_date) VALUES (${ecole}, 'Moreau', 'Inès', '1992-07-14') RETURNING id`;
  [{ id: payeur }] =
    await admin`INSERT INTO person (school_id, last_name, company_name, type, siren) VALUES (${ecole}, 'CSE', 'CSE Ateliers', 'professionnel', '123456789') RETURNING id`;
  await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type, pays_for) VALUES (${ecole}, ${payeur}, ${ines}, 'autre', true)`;
});

afterAll(async () => {
  for (const t of [
    "enrollment_course",
    "enrollment",
    "lesson_pack_tariff",
    "discount",
    "tariff",
    "relationship",
    "person",
    "course",
    "instructor",
    "room",
    "site",
    "discipline",
    "season",
  ]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [ecole, autreEcole]);
  }
  await admin`DELETE FROM school WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

describe("grille", () => {
  it("enregistre des prix, trie la combinaison, distingue une ligne réservée à une discipline", async () => {
    await prix({
      public: "adulte",
      combinaison: [60],
      disciplineId: null,
      periodicite: "trimestre",
      prixCentimes: 12000,
    });
    await prix({ public: "adulte", combinaison: [60], disciplineId: null, periodicite: "annee", prixCentimes: 30500 });
    await prix({
      public: "adulte",
      combinaison: [90, 60],
      disciplineId: null,
      periodicite: "trimestre",
      prixCentimes: 24000,
    });
    await prix({
      public: "adulte",
      combinaison: [60, 60],
      disciplineId: zumba,
      periodicite: "trimestre",
      prixCentimes: 19000,
    });
    await prix({
      public: "enfant",
      combinaison: [45],
      disciplineId: null,
      periodicite: "trimestre",
      prixCentimes: 8500,
    });
    // Correction d'un prix : la case est mise à jour, pas dupliquée.
    await prix({
      public: "adulte",
      combinaison: [60],
      disciplineId: null,
      periodicite: "trimestre",
      prixCentimes: 12500,
    });

    const grille = await avecEcole(ecole, (tx) => grilleSaison(tx, saison));
    expect(
      grille.map(
        (l) =>
          `${l.public} ${l.combinaison.join("+")} ${l.discipline ?? "toutes"} T${l.prix.trimestre?.centimes ?? "-"} A${l.prix.annee?.centimes ?? "-"}`,
      ),
    ).toEqual([
      "enfant 45 toutes T8500 A-",
      "adulte 60 toutes T12500 A30500",
      "adulte 60+90 toutes T24000 A-",
      "adulte 60+60 Zumba T19000 A-",
    ]);
  });

  it("le moteur de tarif utilise le prix saisi", async () => {
    const r = await avecEcole(ecole, (tx) =>
      apercuInscription(tx, payeur, saison, {
        danseurIds: [ines],
        public: "adulte",
        periodicite: "trimestre",
        coursIds: [coursZumba],
      }),
    );
    expect(r).toMatchObject({ statut: "ok", nouvelle: { statut: "ok", prixBrutCentimes: 12500 } });
  });

  it("retire une case libre, refuse de retirer une case déjà utilisée par une inscription", async () => {
    expect(
      (
        await prix({
          public: "adulte",
          combinaison: [60],
          disciplineId: null,
          periodicite: "annee",
          prixCentimes: null,
        })
      ).ok,
    ).toBe(true);
    const [{ id: tarifId }] =
      await admin`SELECT id FROM tariff WHERE season_id = ${saison} AND audience = 'adulte' AND period = 'trimestre' AND combination = '{60}'`;
    await admin`INSERT INTO enrollment (school_id, season_id, payer_id, tariff_id, audience, period, gross_price_cents)
      VALUES (${ecole}, ${saison}, ${payeur}, ${tarifId}, 'adulte', 'trimestre', 12500)`;
    expect(
      await prix({
        public: "adulte",
        combinaison: [60],
        disciplineId: null,
        periodicite: "trimestre",
        prixCentimes: null,
      }),
    ).toEqual({
      ok: false,
      message: "Ce prix sert déjà à des inscriptions : modifiez-le plutôt que de le retirer.",
    });
    // Changer son prix reste possible : l'inscription garde le sien.
    expect(
      (
        await prix({
          public: "adulte",
          combinaison: [60],
          disciplineId: null,
          periodicite: "trimestre",
          prixCentimes: 13000,
        })
      ).ok,
    ).toBe(true);
    const ligne = (await avecEcole(ecole, (tx) => grilleSaison(tx, saison))).find(
      (l) => l.public === "adulte" && l.combinaison.join() === "60" && !l.disciplineId,
    );
    expect(ligne?.prix.trimestre).toMatchObject({ centimes: 13000, utilise: true });
  });

  it("refuse une combinaison vide, une discipline ou une saison d’une autre école", async () => {
    expect(
      await prix({
        public: "adulte",
        combinaison: [],
        disciplineId: null,
        periodicite: "trimestre",
        prixCentimes: 100,
      }),
    ).toEqual({
      ok: false,
      message: "Indiquez au moins un cours",
    });
    const [{ id: autreDiscipline }] =
      await admin`INSERT INTO discipline (school_id, name) VALUES (${autreEcole}, 'Salsa') RETURNING id`;
    expect(
      await prix({
        public: "adulte",
        combinaison: [60],
        disciplineId: autreDiscipline,
        periodicite: "trimestre",
        prixCentimes: 100,
      }),
    ).toEqual({
      ok: false,
      message: "Discipline introuvable.",
    });
    expect(await avecEcole(autreEcole, (tx) => grilleSaison(tx, saison))).toEqual([]);
  });
});

describe("fratrie et carnets", () => {
  it("enregistre, modifie et retire la règle fratrie ; refuse taux et montant à la fois", async () => {
    const regle = {
      tauxPointsBase: 1000,
      montantCentimes: null,
      seuilDanseurs: 2,
      publics: ["enfant" as const],
      cumulableMultiDisciplines: false,
    };
    expect((await avecEcole(ecole, (tx) => enregistrerFratrie(tx, saison, regle))).ok).toBe(true);
    await avecEcole(ecole, (tx) => enregistrerFratrie(tx, saison, { ...regle, tauxPointsBase: 1500 }));
    expect(await avecEcole(ecole, (tx) => lireFratrie(tx, saison))).toMatchObject({
      tauxPointsBase: 1500,
      publics: ["enfant"],
    });
    expect(await avecEcole(ecole, (tx) => enregistrerFratrie(tx, saison, { ...regle, montantCentimes: 1000 }))).toEqual(
      {
        ok: false,
        message: "Indiquez un pourcentage ou un montant, pas les deux.",
      },
    );
    await avecEcole(ecole, (tx) => enregistrerFratrie(tx, saison, null));
    expect(await avecEcole(ecole, (tx) => lireFratrie(tx, saison))).toBeNull();
  });

  it("crée, met à jour et retire un carnet", async () => {
    const r = await avecEcole(ecole, (tx) =>
      enregistrerCarnet(tx, saison, { nbSeances: 5, personnesMax: 1, prixCentimes: 25000 }),
    );
    await avecEcole(ecole, (tx) =>
      enregistrerCarnet(tx, saison, { nbSeances: 5, personnesMax: 1, prixCentimes: 24000 }),
    );
    expect(await avecEcole(ecole, (tx) => listerCarnets(tx, saison))).toMatchObject([
      { nbSeances: 5, personnesMax: 1, prixCentimes: 24000 },
    ]);
    expect(await avecEcole(autreEcole, (tx) => supprimerCarnet(tx, r.ok ? r.id : ""))).toEqual({
      ok: false,
      message: "Ce carnet n’existe plus.",
    });
    expect((await avecEcole(ecole, (tx) => supprimerCarnet(tx, r.ok ? r.id : ""))).ok).toBe(true);
  });
});
