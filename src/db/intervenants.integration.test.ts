import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avecEcole } from "./index";
import {
  creerIntervenant,
  lireIntervenant,
  listerIntervenants,
  modifierIntervenant,
  type SaisieIntervenant,
} from "./intervenants";

/** Intervenants, lus et écrits comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
let ecole: string;
let autreEcole: string;
let saison: string;
let etranger: string;

const camille: SaisieIntervenant = {
  prenom: "Camille",
  nom: "Durand",
  email: "camille.durand@exemple.test",
  statut: "micro_entreprise",
  siren: "123456789",
  regimeTva: "franchise_293b",
  estDirigeant: false,
  modeRemuneration: "heure",
  tarifCentimes: 4000,
  actif: true,
};

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ia-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`ib-${suffixe}`}) RETURNING id`;
  [{ id: saison }] = await admin`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${ecole}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: etranger }] = await admin`
    INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${autreEcole}, 'Ailleurs', 'Prof', 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`;
});

afterAll(async () => {
  for (const t of ["course", "room", "site", "discipline", "instructor", "season"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [ecole, autreEcole]);
  }
  await admin`DELETE FROM school WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

describe("creerIntervenant et lireIntervenant", () => {
  it("enregistre l’intervenant dans l’école courante", async () => {
    const id = await avecEcole(ecole, (tx) => creerIntervenant(tx, camille));
    expect(await avecEcole(ecole, (tx) => lireIntervenant(tx, id))).toEqual({ id, ...camille });
    const [{ school_id }] = await admin`SELECT school_id FROM instructor WHERE id = ${id}`;
    expect(school_id).toBe(ecole);
  });

  it("ne lit pas un intervenant d’une autre école", async () => {
    expect(await avecEcole(ecole, (tx) => lireIntervenant(tx, etranger))).toBeNull();
  });
});

describe("modifierIntervenant", () => {
  it("modifie et désactive", async () => {
    const id = await avecEcole(ecole, (tx) => creerIntervenant(tx, { ...camille, prenom: "Inès", nom: "Garnier" }));
    const modifie = { ...camille, prenom: "Inès", nom: "Garnier", tarifCentimes: 4500, actif: false };
    expect(await avecEcole(ecole, (tx) => modifierIntervenant(tx, id, modifie))).toBe(true);
    expect(await avecEcole(ecole, (tx) => lireIntervenant(tx, id))).toMatchObject({
      tarifCentimes: 4500,
      actif: false,
    });
  });

  it("ne modifie pas un intervenant d’une autre école", async () => {
    expect(await avecEcole(ecole, (tx) => modifierIntervenant(tx, etranger, camille))).toBe(false);
    const [{ last_name: nom }] = await admin`SELECT last_name FROM instructor WHERE id = ${etranger}`;
    expect(nom).toBe("Ailleurs");
  });
});

describe("listerIntervenants", () => {
  it("liste les actifs d’abord, par nom, avec leurs cours de la saison", async () => {
    const [{ id: lucas }] = await admin`
      INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${ecole}, 'Faure', 'Lucas', 'societe', 'assujetti', 'cours', 3500) RETURNING id`;
    const [d] = await admin`INSERT INTO discipline (school_id, name) VALUES (${ecole}, 'Jazz') RETURNING id`;
    const [s] =
      await admin`INSERT INTO site (school_id, name, address) VALUES (${ecole}, 'Centre', '1 rue Test') RETURNING id`;
    const [salle] =
      await admin`INSERT INTO room (school_id, site_id, name) VALUES (${ecole}, ${s.id}, 'Studio') RETURNING id`;
    await admin`
      INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${ecole}, ${saison}, ${d.id}, ${salle.id}, ${lucas}, 1, '18:00', 60), (${ecole}, ${saison}, ${d.id}, ${salle.id}, ${lucas}, 3, '18:00', 90)`;

    const liste = await avecEcole(ecole, (tx) => listerIntervenants(tx, saison));
    expect(liste.map((i) => `${i.prenom} ${i.nom} ${i.actif ? "actif" : "inactif"} ${i.coursSaison}`)).toEqual([
      "Camille Durand actif 0",
      "Lucas Faure actif 2",
      "Inès Garnier inactif 0",
    ]);
  });
});

describe("identifiant invalide", () => {
  it("lit et modifie sans erreur SQL", async () => {
    expect(await avecEcole(ecole, (tx) => lireIntervenant(tx, "pas-un-uuid"))).toBeNull();
    expect(await avecEcole(ecole, (tx) => modifierIntervenant(tx, "pas-un-uuid", camille))).toBe(false);
  });
});
