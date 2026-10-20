import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avecEcole } from "./index";
import { coursDeLaSaison, coursDuPlanning, inscritsDuCours, saisonCourante } from "./planning";

/** Planning, lu comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
let ecole: string;
let autreEcole: string;
let saison2026: string;
let saison2027: string;

async function creerCours(ecoleId: string, saisonId: string, discipline: string, jour: number, heure: string) {
  const [d] = await admin`INSERT INTO discipline (ecole_id, nom) VALUES (${ecoleId}, ${discipline})
    ON CONFLICT (ecole_id, nom) DO UPDATE SET nom = EXCLUDED.nom RETURNING id`;
  const [site] = await admin`SELECT id FROM site WHERE ecole_id = ${ecoleId} LIMIT 1`;
  const [s] = site
    ? [site]
    : await admin`INSERT INTO site (ecole_id, nom, adresse) VALUES (${ecoleId}, 'Site Centre', '1 rue Test') RETURNING id`;
  const [salle] = await admin`INSERT INTO salle (ecole_id, site_id, nom) VALUES (${ecoleId}, ${s.id}, ${`Salle ${discipline}`}) RETURNING id`;
  const [prof] = await admin`
    INSERT INTO intervenant (ecole_id, nom, prenom, statut, regime_tva, mode_remuneration, tarif_centimes)
    VALUES (${ecoleId}, 'Prof', ${discipline}, 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`;
  await admin`
    INSERT INTO cours (ecole_id, saison_id, discipline_id, salle_id, intervenant_id, jour_semaine, heure_debut, duree_minutes, age_min, age_max, niveau)
    VALUES (${ecoleId}, ${saisonId}, ${d.id}, ${salle.id}, ${prof.id}, ${jour}, ${heure}, 60, 8, 10, 'Débutant')`;
}

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École A', ${`pa-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École B', ${`pb-${suffixe}`}) RETURNING id`;
  [{ id: saison2026 }] = await admin`INSERT INTO saison (ecole_id, libelle, date_debut, date_fin)
    VALUES (${ecole}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: saison2027 }] = await admin`INSERT INTO saison (ecole_id, libelle, date_debut, date_fin)
    VALUES (${ecole}, '2027-2028', '2027-09-01', '2028-06-30') RETURNING id`;
  const [b] = await admin`INSERT INTO saison (ecole_id, libelle, date_debut, date_fin)
    VALUES (${autreEcole}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  await creerCours(ecole, saison2026, "Jazz", 3, "17:00");
  await creerCours(ecole, saison2026, "Classique", 1, "18:30");
  await creerCours(ecole, saison2026, "Éveil", 3, "14:00");
  await creerCours(ecole, saison2027, "Zumba", 2, "19:00");
  await creerCours(autreEcole, b.id, "Salsa", 1, "20:00");
});

afterAll(async () => {
  for (const t of ["inscription_cours", "inscription", "lien", "personne", "cours", "intervenant", "salle", "site", "discipline", "saison"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE ecole_id IN ($1, $2)`, [ecole, autreEcole]);
  }
  await admin`DELETE FROM ecole WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

describe("saisonCourante", () => {
  it("prend la saison qui contient le jour", async () => {
    expect(await avecEcole(ecole, (tx) => saisonCourante(tx, "2026-10-19"))).toMatchObject({
      id: saison2026,
      libelle: "2026-2027",
    });
  });

  it("prend la plus récente quand aucune ne contient le jour (été)", async () => {
    expect((await avecEcole(ecole, (tx) => saisonCourante(tx, "2028-08-01")))?.id).toBe(saison2027);
  });

  it("renvoie null sans saison", async () => {
    const [{ id }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('Vide', ${`pv-${suffixe}`}) RETURNING id`;
    expect(await avecEcole(id, (tx) => saisonCourante(tx, "2026-10-19"))).toBeNull();
    await admin`DELETE FROM ecole WHERE id = ${id}`;
  });
});

describe("coursDeLaSaison", () => {
  it("liste les cours de la saison, par jour puis par heure, sans ceux d’une autre école", async () => {
    const cours = await avecEcole(ecole, (tx) => coursDeLaSaison(tx, saison2026));
    expect(cours.map((c) => `${c.jourSemaine} ${c.heureDebut} ${c.discipline}`)).toEqual([
      "1 18:30 Classique",
      "3 14:00 Éveil",
      "3 17:00 Jazz",
    ]);
    expect(cours[0]).toMatchObject({
      dureeMinutes: 60,
      salle: "Salle Classique",
      site: "Site Centre",
      intervenant: "Classique Prof",
      ageMin: 8,
      ageMax: 10,
      niveau: "Débutant",
    });
  });
});

describe("coursDuPlanning et inscritsDuCours", () => {
  it("lit un cours et ses danseurs actifs, à l’essai ou en attente, sans les abandons", async () => {
    const [jazz] = await admin`SELECT c.id FROM cours c JOIN discipline d ON d.id = c.discipline_id
      WHERE c.ecole_id = ${ecole} AND d.nom = 'Jazz'`;
    const [p] = await admin`INSERT INTO personne (ecole_id, nom, prenom, telephone) VALUES (${ecole}, 'Bernard', 'Émilie', '07 11 22 33 44') RETURNING id`;
    const danseurs: Record<string, string> = {};
    for (const prenom of ["Louis", "Alice", "Jules", "Zoé"]) {
      [{ id: danseurs[prenom] }] = await admin`
        INSERT INTO personne (ecole_id, nom, prenom, date_naissance) VALUES (${ecole}, 'Bernard', ${prenom}, '2016-01-15') RETURNING id`;
    }
    for (const [prenom, statut] of [["Louis", "active"], ["Alice", "essai"], ["Jules", "liste_attente"], ["Zoé", "abandon"]]) {
      const [i] = await admin`
        INSERT INTO inscription (ecole_id, saison_id, payeur_id, public, periodicite, prix_brut_centimes, statut)
        VALUES (${ecole}, ${saison2026}, ${p.id}, 'enfant', 'trimestre', 10000, ${statut}) RETURNING id`;
      await admin`INSERT INTO inscription_cours (ecole_id, inscription_id, danseur_id, cours_id) VALUES (${ecole}, ${i.id}, ${danseurs[prenom]}, ${jazz.id})`;
    }

    expect(await avecEcole(ecole, (tx) => coursDuPlanning(tx, jazz.id))).toMatchObject({ discipline: "Jazz", inscrits: 1 });
    const inscrits = await avecEcole(ecole, (tx) => inscritsDuCours(tx, jazz.id));
    expect(inscrits.map((i) => `${i.prenom} ${i.statut}`)).toEqual(["Alice essai", "Jules liste_attente", "Louis active"]);
    expect(inscrits[0]).toMatchObject({ payeur: "Émilie Bernard", telephone: "07 11 22 33 44", payeurId: p.id, dateNaissance: "2016-01-15" });
  });

  it("ne lit pas le cours d’une autre école, ni ses inscrits", async () => {
    const [salsa] = await admin`SELECT id FROM cours WHERE ecole_id = ${autreEcole}`;
    expect(await avecEcole(ecole, (tx) => coursDuPlanning(tx, salsa.id))).toBeNull();
    expect(await avecEcole(ecole, (tx) => inscritsDuCours(tx, salsa.id))).toEqual([]);
    expect(await avecEcole(ecole, (tx) => coursDuPlanning(tx, "pas-un-uuid"))).toBeNull();
  });
});
