import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avecEcole } from "./index";
import { apercuInscription, enregistrerInscription, inscriptionsDeLaFamille } from "./inscriptions";
import { coursDeLaSaison } from "./planning";
import { chiffresSaison, dernieresInscriptions } from "./tableau-de-bord";

/** Inscriptions, exécutées comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
const ids = {} as Record<string, string>;

beforeAll(async () => {
  [{ id: ids.ecole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École I', ${`i-${suffixe}`}) RETURNING id`;
  const e = ids.ecole;
  [{ id: ids.saison }] = await admin`INSERT INTO saison (ecole_id, libelle, date_debut, date_fin) VALUES (${e}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  [{ id: ids.autreSaison }] = await admin`INSERT INTO saison (ecole_id, libelle, date_debut, date_fin) VALUES (${e}, '2027-2028', '2027-09-01', '2028-06-30') RETURNING id`;
  for (const [combinaison, prix] of [["{60}", 11000], ["{45,60}", 16500], ["{60,60}", 18500]] as const) {
    await admin`INSERT INTO tarif (ecole_id, saison_id, public, periodicite, combinaison, prix_centimes)
      VALUES (${e}, ${ids.saison}, 'enfant', 'trimestre', ${combinaison}::smallint[], ${prix})`;
  }
  await admin`INSERT INTO reduction (ecole_id, saison_id, code, taux_points_base, seuil_danseurs, publics, cumulable_multi_disciplines)
    VALUES (${e}, ${ids.saison}, 'fratrie', 1000, 2, '{enfant}', false)`;
  const [site] = await admin`INSERT INTO site (ecole_id, nom, adresse) VALUES (${e}, 'Site', 'Adresse') RETURNING id`;
  const [salle] = await admin`INSERT INTO salle (ecole_id, site_id, nom) VALUES (${e}, ${site.id}, 'Salle') RETURNING id`;
  const [prof] = await admin`INSERT INTO intervenant (ecole_id, nom, prenom, statut, regime_tva, mode_remuneration, tarif_centimes)
    VALUES (${e}, 'Prof', 'Test', 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`;
  const [jazz] = await admin`INSERT INTO discipline (ecole_id, nom) VALUES (${e}, 'Jazz') RETURNING id`;
  const [classique] = await admin`INSERT INTO discipline (ecole_id, nom) VALUES (${e}, 'Classique') RETURNING id`;
  const cours = async (saisonId: string, disciplineId: string, duree: number, jour: number) =>
    (await admin`INSERT INTO cours (ecole_id, saison_id, discipline_id, salle_id, intervenant_id, jour_semaine, heure_debut, duree_minutes)
      VALUES (${e}, ${saisonId}, ${disciplineId}, ${salle.id}, ${prof.id}, ${jour}, '17:00', ${duree}) RETURNING id`)[0].id as string;
  ids.jazz60 = await cours(ids.saison, jazz.id, 60, 1);
  ids.jazz45 = await cours(ids.saison, jazz.id, 45, 2);
  ids.classique60 = await cours(ids.saison, classique.id, 60, 3);
  ids.autreSaison60 = await cours(ids.autreSaison, jazz.id, 60, 1);
  [{ id: ids.payeur }] = await admin`INSERT INTO payeur (ecole_id, nom, prenom) VALUES (${e}, 'Famille', 'Test') RETURNING id`;
  [{ id: ids.autrePayeur }] = await admin`INSERT INTO payeur (ecole_id, nom, prenom) VALUES (${e}, 'Autre', 'Famille') RETURNING id`;
  [{ id: ids.zoe }] = await admin`INSERT INTO danseur (ecole_id, payeur_id, nom, prenom) VALUES (${e}, ${ids.payeur}, 'Famille', 'Zoé') RETURNING id`;
  [{ id: ids.noe }] = await admin`INSERT INTO danseur (ecole_id, payeur_id, nom, prenom) VALUES (${e}, ${ids.payeur}, 'Famille', 'Noé') RETURNING id`;
  [{ id: ids.etranger }] = await admin`INSERT INTO danseur (ecole_id, payeur_id, nom, prenom) VALUES (${e}, ${ids.autrePayeur}, 'Autre', 'Max') RETURNING id`;
});

afterAll(async () => {
  for (const t of ["inscription_cours", "inscription", "cours", "danseur", "payeur", "intervenant", "salle", "site", "discipline", "reduction", "tarif", "saison"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE ecole_id = $1`, [ids.ecole]);
  }
  await admin`DELETE FROM ecole WHERE id = ${ids.ecole}`;
  await admin.end();
});

const enfant = (danseurIds: string[], coursIds: string[]) => ({
  danseurIds,
  public: "enfant" as const,
  periodicite: "trimestre" as const,
  coursIds,
});
const apercu = (saisie: ReturnType<typeof enfant>) =>
  avecEcole(ids.ecole, (tx) => apercuInscription(tx, ids.payeur, ids.saison, saisie));
const enregistrer = (saisie: ReturnType<typeof enfant>) =>
  avecEcole(ids.ecole, (tx) => enregistrerInscription(tx, ids.payeur, ids.saison, saisie));

describe("Inscription", () => {
  it("donne un aperçu du prix pour un premier enfant, sans fratrie", async () => {
    const a = await apercu(enfant([ids.zoe], [ids.jazz60]));
    if (a.statut !== "ok") throw new Error(a.message);
    expect(a.nouvelle).toMatchObject({ statut: "ok", prixBrutCentimes: 11000, prixNetCentimes: 11000 });
  });

  it("enregistre l’inscription au prix recalculé côté serveur", async () => {
    const r = await enregistrer(enfant([ids.zoe], [ids.jazz60]));
    if (!r.ok) throw new Error(r.message);
    const [ligne] = await admin`SELECT public, periodicite, prix_brut_centimes, remise_centimes, prix_net_centimes, reductions, tarif_id
      FROM inscription WHERE id = ${r.id}`;
    expect(ligne).toMatchObject({ public: "enfant", periodicite: "trimestre", prix_brut_centimes: 11000, remise_centimes: 0, prix_net_centimes: 11000, reductions: [] });
    expect(ligne.tarif_id).toBeTruthy();
    const coursLies = await admin`SELECT danseur_id, cours_id FROM inscription_cours WHERE inscription_id = ${r.id}`;
    expect(coursLies).toEqual([{ danseur_id: ids.zoe, cours_id: ids.jazz60 }]);
  });

  it("applique la fratrie avec l’inscription déjà enregistrée, et le signale pour elle", async () => {
    const a = await apercu(enfant([ids.noe], [ids.jazz60]));
    if (a.statut !== "ok") throw new Error(a.message);
    expect(a.nouvelle).toMatchObject({ prixBrutCentimes: 11000, remiseCentimes: 1100, prixNetCentimes: 9900 });
    expect(a.autres).toHaveLength(1);
    expect(a.autres[0]).toMatchObject({ danseurs: "Zoé", remiseEnregistree: 0, remiseRecalculee: 1100 });
  });

  it("enregistre le second enfant avec la fratrie (deux cours de la même discipline)", async () => {
    const r = await enregistrer(enfant([ids.noe], [ids.jazz45, ids.jazz60]));
    if (!r.ok) throw new Error(r.message);
    const [ligne] = await admin`SELECT prix_brut_centimes, remise_centimes, reductions FROM inscription WHERE id = ${r.id}`;
    expect(ligne).toMatchObject({ prix_brut_centimes: 16500, remise_centimes: 1650, reductions: ["fratrie"] });
  });

  it("liste les inscriptions de la famille pour la saison", async () => {
    const liste = await avecEcole(ids.ecole, (tx) => inscriptionsDeLaFamille(tx, ids.payeur, ids.saison));
    expect(liste.map((i) => [i.danseurs, i.prixNetCentimes])).toEqual([
      ["Noé", 14850],
      ["Zoé", 11000],
    ]);
  });
});

describe("Refus", () => {
  it("refuse un danseur d’un autre payeur", async () => {
    expect(await enregistrer(enfant([ids.etranger], [ids.jazz60]))).toMatchObject({ ok: false });
  });

  it("refuse un cours d’une autre saison", async () => {
    expect(await enregistrer(enfant([ids.zoe], [ids.autreSaison60]))).toMatchObject({ ok: false });
  });

  it("refuse un couple à un seul danseur", async () => {
    const r = await enregistrer({ ...enfant([ids.zoe], [ids.jazz60]), public: "couple" as never });
    expect(r).toMatchObject({ ok: false, message: "Un couple réunit deux danseurs." });
  });

  it("refuse une combinaison absente de la grille, sans rien enregistrer", async () => {
    const [{ avant }] = await admin`SELECT count(*)::int AS avant FROM inscription WHERE ecole_id = ${ids.ecole}`;
    const r = await enregistrer(enfant([ids.zoe], [ids.jazz60, ids.classique60, ids.jazz45]));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toContain("prix à saisir par l’accueil");
    const [{ apres }] = await admin`SELECT count(*)::int AS apres FROM inscription WHERE ecole_id = ${ids.ecole}`;
    expect(apres).toBe(avant);
  });
});

describe("Tableau de bord et effectifs", () => {
  it("compte les inscriptions, les danseurs et le montant de la saison", async () => {
    const chiffres = await avecEcole(ids.ecole, (tx) => chiffresSaison(tx, ids.saison));
    expect(chiffres).toEqual({ inscriptions: 2, danseurs: 2, totalNetCentimes: 11000 + 14850 });
  });

  it("liste les dernières inscriptions, la plus récente d’abord", async () => {
    const dernieres = await avecEcole(ids.ecole, (tx) => dernieresInscriptions(tx, ids.saison));
    expect(dernieres.map((d) => [d.danseurs, d.famille, d.prixNetCentimes])).toEqual([
      ["Noé", "Famille Test", 14850],
      ["Zoé", "Famille Test", 11000],
    ]);
  });

  it("donne l’effectif de chaque cours", async () => {
    const cours = await avecEcole(ids.ecole, (tx) => coursDeLaSaison(tx, ids.saison));
    const effectif = Object.fromEntries(cours.map((c) => [c.id, c.inscrits]));
    expect(effectif).toEqual({ [ids.jazz60]: 2, [ids.jazz45]: 1, [ids.classique60]: 0 });
  });
});
