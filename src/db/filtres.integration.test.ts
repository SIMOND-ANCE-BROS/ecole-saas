import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ecrireFiltreColonne } from "../domaine/filtres/colonne";
import { COLONNES_CONTACTS, COLONNES_ELEVES } from "../domaine/filtres/colonnes";
import { appliquerFiltre, FILTRE_VIDE, lireFiltre, lireTri, VIDE, versParametres } from "../domaine/filtres/filtres";
import { ageAu } from "../domaine/personnes/age";
import { type LigneEleve, libellesCoursSaison, listerContacts, listerEleves } from "./eleves";
import { avecEcole } from "./index";

/** Filtres par colonne traduits en SQL (#87), comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
const AUJOURDHUI = "2026-10-20";
let ecole: string;
let autreEcole: string;
let saison: string;

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École A', ${`fa-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École B', ${`fb-${suffixe}`}) RETURNING id`;
  const personne = async (e: string, nom: string, prenom: string | null, champs: { naissance?: string; telephone?: string; eleve?: boolean; societe?: string; email?: string } = {}) =>
    (
      await admin`INSERT INTO personne (ecole_id, nom, prenom, date_naissance, telephone, eleve, type, raison_sociale, siren, email)
        VALUES (${e}, ${nom}, ${prenom}, ${champs.naissance ?? null}, ${champs.telephone ?? null}, ${champs.eleve ?? false},
          ${champs.societe ? "professionnel" : "particulier"}, ${champs.societe ?? null}, ${champs.societe ? "123456789" : null}, ${champs.email ?? null}) RETURNING id`
    )[0].id as string;
  const lien = (de: string, vers: string, type: string, paie = false, urgence = false) =>
    admin`INSERT INTO lien (ecole_id, personne_id, lie_a_id, type, paie_pour, contact_urgence) VALUES (${ecole}, ${de}, ${vers}, ${type}, ${paie}, ${urgence})`;

  // Léa, 8 ans : sa mère est responsable, paie et se prévient (son téléphone s'affiche pour Léa).
  const lea = await personne(ecole, "Martin", "Léa", { naissance: "2018-03-01", eleve: true });
  const sophie = await personne(ecole, "Martin", "Sophie", { telephone: "06 12 34 56 78", email: "sophie@exemple.test" });
  await lien(sophie, lea, "representant_legal", true, true);
  // Hugo, 12 ans : ni responsable ni payeur.
  const hugo = await personne(ecole, "Bernard", "Hugo", { naissance: "2014-01-10", telephone: "07 11 22 33 44", eleve: true });
  // Inès, sans date de naissance : deux responsables, payée par un CSE.
  const ines = await personne(ecole, "Moreau", "Inès", { eleve: true });
  await lien(await personne(ecole, "Moreau", "Paul"), ines, "representant_legal");
  await lien(await personne(ecole, "Petit", "Anne"), ines, "representant_legal");
  await lien(await personne(ecole, "CSE", null, { societe: "CSE Ateliers" }), ines, "autre", true);
  // Saison : Léa inscrite au jazz du lundi 17:00, Hugo en liste d'attente sur le même cours, Inès sans inscription.
  [{ id: saison }] = await admin`INSERT INTO saison (ecole_id, libelle, date_debut, date_fin) VALUES (${ecole}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [d] = await admin`INSERT INTO discipline (ecole_id, nom) VALUES (${ecole}, 'Jazz') RETURNING id`;
  const [site] = await admin`INSERT INTO site (ecole_id, nom, adresse) VALUES (${ecole}, 'Centre', '1 rue Test') RETURNING id`;
  const [salle] = await admin`INSERT INTO salle (ecole_id, site_id, nom) VALUES (${ecole}, ${site.id}, 'Studio') RETURNING id`;
  const [prof] = await admin`INSERT INTO intervenant (ecole_id, nom, prenom, statut, regime_tva, mode_remuneration, tarif_centimes)
    VALUES (${ecole}, 'Prof', 'Lucas', 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`;
  const [jazz] = await admin`INSERT INTO cours (ecole_id, saison_id, discipline_id, salle_id, intervenant_id, jour_semaine, heure_debut, duree_minutes)
    VALUES (${ecole}, ${saison}, ${d.id}, ${salle.id}, ${prof.id}, 1, '17:00', 60) RETURNING id`;
  for (const [danseur, payeur, statut] of [[lea, sophie, "active"], [hugo, hugo, "liste_attente"]]) {
    const [i] = await admin`INSERT INTO inscription (ecole_id, saison_id, payeur_id, public, periodicite, prix_brut_centimes, statut)
      VALUES (${ecole}, ${saison}, ${payeur}, 'enfant', 'trimestre', 10000, ${statut}) RETURNING id`;
    await admin`INSERT INTO inscription_cours (ecole_id, inscription_id, danseur_id, cours_id) VALUES (${ecole}, ${i.id}, ${danseur}, ${jazz.id})`;
  }
  // Une Léa dans une autre école : jamais visible.
  await personne(autreEcole, "Ailleurs", "Léa", { naissance: "2018-03-01", eleve: true });
});

afterAll(async () => {
  for (const t of ["inscription_cours", "inscription", "cours", "intervenant", "salle", "site", "discipline", "saison", "lien", "personne"]) await admin.unsafe(`DELETE FROM ${t} WHERE ecole_id IN ($1, $2)`, [ecole, autreEcole]);
  await admin`DELETE FROM ecole WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

const eleves = async (f: string[], mode?: string) =>
  (await avecEcole(ecole, (tx) => listerEleves(tx, "", { filtre: lireFiltre(f, mode, COLONNES_ELEVES), aujourdhui: AUJOURDHUI, saisonId: saison }))).map(
    (e) => e.prenom,
  );
const contacts = async (f: string[]) =>
  (await avecEcole(ecole, (tx) => listerContacts(tx, "", { filtre: lireFiltre(f, null, COLONNES_CONTACTS) }))).map((c) => c.raisonSociale ?? c.prenom);

const tries = async (sort: string, order: string) =>
  (await avecEcole(ecole, (tx) => listerEleves(tx, "", { tri: lireTri(sort, order, COLONNES_ELEVES), aujourdhui: AUJOURDHUI, saisonId: saison }))).map((e) => e.prenom);

describe("tri et boutons de filtre (#107)", () => {
  it("trie par une colonne, les vides en dernier dans les deux sens", async () => {
    expect(await tries("age", "asc")).toEqual(["Léa", "Hugo", "Inès"]);
    expect(await tries("age", "desc")).toEqual(["Hugo", "Léa", "Inès"]);
    expect(await tries("nom", "desc")).toEqual(["Léa", "Inès", "Hugo"]);
    expect(await tries("responsables", "asc")).toEqual(["Inès", "Léa", "Hugo"]);
  });

  it("cases à cocher (statut, cours, « vide ») et bornes, comme en mémoire", async () => {
    const def = (id: string) => COLONNES_ELEVES.find((c) => c.id === id)!;
    const par = (id: string, fc: Parameters<typeof ecrireFiltreColonne>[2]) =>
      eleves(versParametres(ecrireFiltreColonne(FILTRE_VIDE, def(id), fc)).map(([, v]) => v));
    expect(await par("inscription", { choix: ["Inscrit"] })).toEqual(["Léa"]);
    expect(await par("inscription", { choix: ["En attente", VIDE] })).toEqual(["Hugo", "Inès"]);
    const libelles = await avecEcole(ecole, (tx) => libellesCoursSaison(tx, saison));
    expect(libelles).toEqual(["Jazz lun. 17:00"]);
    expect(await par("cours", { choix: libelles })).toEqual(["Léa"]);
    expect(await par("cours", { choix: [VIDE] })).toEqual(["Hugo", "Inès"]);
    expect(await par("age", { min: "8", max: "12" })).toEqual(["Hugo", "Léa"]);
    expect(await par("naissance", { min: "2018-03-01" })).toEqual(["Léa"]);
  });
});

describe("élèves", () => {
  it("nom, accents ignorés, sans voir l'autre école", async () => {
    expect(await eleves(["nom.contient.LEA"])).toEqual(["Léa"]);
  });

  it("âge : comparaison, et vide sans date de naissance", async () => {
    expect(await eleves(["age.sup.10"])).toEqual(["Hugo"]);
    expect(await eleves(["age.vide"])).toEqual(["Inès"]);
    expect(await eleves(["age.different.8"])).toEqual(["Hugo", "Inès"]);
  });

  it("responsables : un élément de la liste, ou liste vide", async () => {
    expect(await eleves(["responsables.est.anne petit"])).toEqual(["Inès"]);
    expect(await eleves(["responsables.vide"])).toEqual(["Hugo"]);
  });

  it("facturé à et téléphone (celui du responsable à prévenir compte)", async () => {
    expect(await eleves(["facture.contient.ateliers"])).toEqual(["Inès"]);
    expect(await eleves(["facture.vide"])).toEqual(["Hugo"]);
    expect(await eleves(["telephone.contient.12 34"])).toEqual(["Léa"]);
    expect(await eleves(["telephone.vide"])).toEqual(["Inès"]);
  });

  it("OU et ET", async () => {
    expect(await eleves(["nom.commence.hugo", "age.vide"], "ou")).toEqual(["Hugo", "Inès"]);
    expect(await eleves(["nom.commence.hugo", "age.vide"])).toEqual([]);
  });

  it("une apostrophe ou un % restent de simples caractères", async () => {
    expect(await eleves(["nom.contient.o'brien"])).toEqual([]);
    expect(await eleves(["nom.contient.%"])).toEqual([]);
  });

  it("SQL et évaluation en mémoire donnent le même résultat", async () => {
    const toutes = await avecEcole(ecole, (tx) => listerEleves(tx, "", { aujourdhui: AUJOURDHUI }));
    const colonnes = COLONNES_ELEVES.map((c) => ({
      ...c,
      valeur: (e: LigneEleve) =>
        ({
          nom: [e.prenom, e.nom].filter(Boolean).join(" "),
          age: e.dateNaissance ? ageAu(e.dateNaissance, AUJOURDHUI) : null,
          responsables: e.responsables,
          facture: e.factureA,
          telephone: e.telephone,
        })[c.id],
    }));
    for (const f of [["nom.ne_contient_pas.martin"], ["age.inf_egal.8"], ["responsables.contient.moreau"], ["facture.non_vide", "telephone.commence.06"]]) {
      const enMemoire = appliquerFiltre(toutes, lireFiltre(f, null, COLONNES_ELEVES), colonnes).map((e) => e.prenom);
      expect(await eleves(f), f.join(" ")).toEqual(enMemoire);
    }
  });
});

describe("colonnes ajoutées (#89)", () => {
  it("valeurs : e-mail du responsable, cours de la saison, statut, personnes à prévenir", async () => {
    const lignes = await avecEcole(ecole, (tx) => listerEleves(tx, "", { aujourdhui: AUJOURDHUI, saisonId: saison }));
    const lea = lignes.find((e) => e.prenom === "Léa");
    expect(lea).toMatchObject({ email: "sophie@exemple.test", cours: ["Jazz lun. 17:00"], inscription: "Inscrit", prevenir: ["Sophie Martin, 06 12 34 56 78"] });
    // La liste d'attente n'est pas un cours suivi.
    expect(lignes.find((e) => e.prenom === "Hugo")).toMatchObject({ cours: [], inscription: "En attente" });
    expect(lignes.find((e) => e.prenom === "Inès")).toMatchObject({ cours: [], inscription: null, email: null });
  });

  it("filtres sur ces colonnes", async () => {
    expect(await eleves(["cours.contient.jazz"])).toEqual(["Léa"]);
    expect(await eleves(["inscription.est.en attente"])).toEqual(["Hugo"]);
    expect(await eleves(["inscription.vide"])).toEqual(["Inès"]);
    expect(await eleves(["naissance.inf.2015-01-01"])).toEqual(["Hugo"]);
    expect(await eleves(["naissance.vide"])).toEqual(["Inès"]);
    expect(await eleves(["email.non_vide"])).toEqual(["Léa"]);
    expect(await eleves(["prevenir.contient.06 12"])).toEqual(["Léa"]);
  });

  it("sans saison : ni cours ni inscription", async () => {
    const lignes = await avecEcole(ecole, (tx) => listerEleves(tx, "", { aujourdhui: AUJOURDHUI }));
    expect(lignes.every((e) => e.cours.length === 0 && e.inscription === null)).toBe(true);
  });
});

describe("contacts", () => {
  it("élèves suivis, nom d'organisme, e-mail renseigné", async () => {
    expect(await contacts(["eleves.contient.lea"])).toEqual(["Sophie"]);
    expect(await contacts(["nom.contient.ateliers"])).toEqual(["CSE Ateliers"]);
    expect(await contacts(["email.non_vide"])).toEqual(["Sophie"]);
  });
});
