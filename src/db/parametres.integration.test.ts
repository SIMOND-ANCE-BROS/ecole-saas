import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avecEcole } from "./index";
import {
  creerDiscipline,
  creerSaison,
  creerSalle,
  creerSite,
  listerDisciplines,
  listerLieux,
  listerSaisons,
  modifierSaison,
  modifierSalle,
  renommerDiscipline,
  supprimerDiscipline,
  supprimerSalle,
  supprimerSite,
} from "./parametres";

/** Paramètres de l'école (#80), comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
let ecole: string;
let autreEcole: string;
let saison2026: string;
let jazz: string;
let centre: string;
let studio: string;

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École A', ${`pa-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École B', ${`pb-${suffixe}`}) RETURNING id`;
  await admin`INSERT INTO discipline (ecole_id, nom) VALUES (${autreEcole}, 'Jazz')`;
});

afterAll(async () => {
  for (const t of ["tarif_carnet", "reduction", "tarif", "cours", "intervenant", "salle", "site", "discipline", "saison"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE ecole_id IN ($1, $2)`, [ecole, autreEcole]);
  }
  await admin`DELETE FROM ecole WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

describe("saisons", () => {
  it("crée une saison, refuse un libellé pris, des dates inversées ou qui chevauchent", async () => {
    const r = await avecEcole(ecole, (tx) => creerSaison(tx, { libelle: "2026-2027", dateDebut: "2026-09-01", dateFin: "2027-06-30" }, null));
    expect(r.ok).toBe(true);
    saison2026 = r.ok ? r.id : "";
    expect(await avecEcole(ecole, (tx) => creerSaison(tx, { libelle: "2026-2027", dateDebut: "2027-09-01", dateFin: "2028-06-30" }, null))).toEqual({
      ok: false,
      message: "Une saison porte déjà ce libellé.",
    });
    expect(await avecEcole(ecole, (tx) => creerSaison(tx, { libelle: "X", dateDebut: "2028-06-30", dateFin: "2028-01-01" }, null))).toEqual({
      ok: false,
      message: "La fin doit suivre le début.",
    });
    expect(await avecEcole(ecole, (tx) => creerSaison(tx, { libelle: "Été", dateDebut: "2027-06-01", dateFin: "2027-08-31" }, null))).toEqual({
      ok: false,
      message: "Ces dates chevauchent la saison 2026-2027.",
    });
  });

  it("reprend la grille, les réductions et les carnets de la saison précédente", async () => {
    await admin`INSERT INTO tarif (ecole_id, saison_id, public, periodicite, combinaison, prix_centimes)
      VALUES (${ecole}, ${saison2026}, 'enfant', 'trimestre', '{60}', 11000), (${ecole}, ${saison2026}, 'adulte', 'annee', '{60,90}', 61500)`;
    await admin`INSERT INTO reduction (ecole_id, saison_id, code, taux_points_base, seuil_danseurs, publics, cumulable_multi_disciplines)
      VALUES (${ecole}, ${saison2026}, 'fratrie', 1000, 2, '{enfant}', false)`;
    await admin`INSERT INTO tarif_carnet (ecole_id, saison_id, nb_seances, personnes_max, prix_centimes) VALUES (${ecole}, ${saison2026}, 5, 1, 25000)`;
    const r = await avecEcole(ecole, (tx) => creerSaison(tx, { libelle: "2027-2028", dateDebut: "2027-09-01", dateFin: "2028-06-30" }, saison2026));
    const id = r.ok ? r.id : "";
    const [{ tarifs }] = await admin`SELECT count(*)::int AS tarifs FROM tarif WHERE saison_id = ${id}`;
    const [{ fratrie }] = await admin`SELECT taux_points_base AS fratrie FROM reduction WHERE saison_id = ${id} AND code = 'fratrie'`;
    const [{ carnets }] = await admin`SELECT count(*)::int AS carnets FROM tarif_carnet WHERE saison_id = ${id}`;
    expect({ tarifs, fratrie, carnets }).toEqual({ tarifs: 2, fratrie: 1000, carnets: 1 });
    expect((await avecEcole(ecole, (tx) => listerSaisons(tx))).map((s) => `${s.libelle} ${s.tarifs}`)).toEqual(["2027-2028 2", "2026-2027 2"]);
  });

  it("modifie les dates d’une saison, sans chevaucher l’autre", async () => {
    const saisie = { libelle: "2026-2027", dateDebut: "2026-08-25", dateFin: "2027-07-05" };
    expect((await avecEcole(ecole, (tx) => modifierSaison(tx, saison2026, saisie))).ok).toBe(true);
    expect(await avecEcole(ecole, (tx) => modifierSaison(tx, saison2026, { ...saisie, dateFin: "2027-09-15" }))).toEqual({
      ok: false,
      message: "Ces dates chevauchent la saison 2027-2028.",
    });
  });
});

describe("disciplines", () => {
  it("crée, refuse un doublon sans tenir compte de la casse, renomme", async () => {
    const r = await avecEcole(ecole, (tx) => creerDiscipline(tx, "Jazz"));
    jazz = r.ok ? r.id : "";
    expect(await avecEcole(ecole, (tx) => creerDiscipline(tx, " jazz "))).toEqual({ ok: false, message: "Cette discipline existe déjà." });
    expect((await avecEcole(ecole, (tx) => creerDiscipline(tx, "Hip-hop"))).ok).toBe(true);
    expect(await avecEcole(ecole, (tx) => renommerDiscipline(tx, jazz, "Hip-hop"))).toEqual({ ok: false, message: "Cette discipline existe déjà." });
    expect((await avecEcole(ecole, (tx) => renommerDiscipline(tx, jazz, "Modern’jazz"))).ok).toBe(true);
    // La discipline « Jazz » de l'autre école n'est ni vue ni gênante.
    expect((await avecEcole(ecole, (tx) => listerDisciplines(tx))).map((d) => d.nom)).toEqual(["Hip-hop", "Modern’jazz"]);
  });
});

describe("sites et salles", () => {
  it("crée un site et ses salles, les liste, modifie une salle", async () => {
    const s = await avecEcole(ecole, (tx) => creerSite(tx, { nom: "Centre", adresse: "1 rue Test", permanence: true }));
    centre = s.ok ? s.id : "";
    const r = await avecEcole(ecole, (tx) => creerSalle(tx, { siteId: centre, nom: "Studio", capacite: 20 }));
    studio = r.ok ? r.id : "";
    await avecEcole(ecole, (tx) => creerSalle(tx, { siteId: centre, nom: "Annexe", capacite: null }));
    expect(await avecEcole(ecole, (tx) => modifierSalle(tx, studio, { siteId: centre, nom: "Grand studio", capacite: 25 }))).toEqual({ ok: true, id: studio });
    expect(await avecEcole(ecole, (tx) => listerLieux(tx))).toMatchObject([
      { nom: "Centre", permanence: true, salles: [{ nom: "Annexe", capacite: null }, { nom: "Grand studio", capacite: 25, cours: 0 }] },
    ]);
  });

  it("refuse de retirer une salle qui a des cours, un site qui a des salles, une discipline utilisée", async () => {
    const [p] = await admin`INSERT INTO intervenant (ecole_id, nom, prenom, statut, regime_tva, mode_remuneration, tarif_centimes)
      VALUES (${ecole}, 'Prof', 'Camille', 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`;
    await admin`INSERT INTO cours (ecole_id, saison_id, discipline_id, salle_id, intervenant_id, jour_semaine, heure_debut, duree_minutes)
      VALUES (${ecole}, ${saison2026}, ${jazz}, ${studio}, ${p.id}, 3, '17:00', 60)`;
    expect(await avecEcole(ecole, (tx) => supprimerSalle(tx, studio))).toEqual({
      ok: false,
      message: "Des cours ont lieu dans Grand studio : déplacez-les d’abord.",
    });
    expect(await avecEcole(ecole, (tx) => supprimerSite(tx, centre))).toEqual({ ok: false, message: "Centre a encore des salles : retirez-les d’abord." });
    expect(await avecEcole(ecole, (tx) => supprimerDiscipline(tx, jazz))).toEqual({
      ok: false,
      message: "Modern’jazz est utilisée (1 cours, 0 tarif) : retirez-les d’abord.",
    });
  });

  it("retire une salle inutilisée, refuse une salle ou un site d’une autre école", async () => {
    const annexe = (await avecEcole(ecole, (tx) => listerLieux(tx)))[0].salles.find((s) => s.nom === "Annexe")?.id as string;
    expect(await avecEcole(ecole, (tx) => supprimerSalle(tx, annexe))).toEqual({ ok: true, id: annexe });
    expect(await avecEcole(autreEcole, (tx) => supprimerSalle(tx, studio))).toEqual({ ok: false, message: "Cette salle n’existe plus." });
    expect(await avecEcole(autreEcole, (tx) => creerSalle(tx, { siteId: centre, nom: "Intrus", capacite: null }))).toEqual({
      ok: false,
      message: "Site introuvable.",
    });
  });
});
