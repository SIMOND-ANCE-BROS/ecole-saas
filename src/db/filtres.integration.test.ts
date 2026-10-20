import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COLONNES_CONTACTS, COLONNES_ELEVES } from "../domaine/filtres/colonnes";
import { appliquerFiltre, lireFiltre } from "../domaine/filtres/filtres";
import { ageAu } from "../domaine/personnes/age";
import { type LigneEleve, listerContacts, listerEleves } from "./eleves";
import { avecEcole } from "./index";

/** Filtres par colonne traduits en SQL (#87), comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
const AUJOURDHUI = "2026-10-20";
let ecole: string;
let autreEcole: string;

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
  await personne(ecole, "Bernard", "Hugo", { naissance: "2014-01-10", telephone: "07 11 22 33 44", eleve: true });
  // Inès, sans date de naissance : deux responsables, payée par un CSE.
  const ines = await personne(ecole, "Moreau", "Inès", { eleve: true });
  await lien(await personne(ecole, "Moreau", "Paul"), ines, "representant_legal");
  await lien(await personne(ecole, "Petit", "Anne"), ines, "representant_legal");
  await lien(await personne(ecole, "CSE", null, { societe: "CSE Ateliers" }), ines, "autre", true);
  // Une Léa dans une autre école : jamais visible.
  await personne(autreEcole, "Ailleurs", "Léa", { naissance: "2018-03-01", eleve: true });
});

afterAll(async () => {
  for (const t of ["lien", "personne"]) await admin.unsafe(`DELETE FROM ${t} WHERE ecole_id IN ($1, $2)`, [ecole, autreEcole]);
  await admin`DELETE FROM ecole WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

const eleves = async (f: string[], mode?: string) =>
  (await avecEcole(ecole, (tx) => listerEleves(tx, "", { filtre: lireFiltre(f, mode, COLONNES_ELEVES), aujourdhui: AUJOURDHUI }))).map((e) => e.prenom);
const contacts = async (f: string[]) =>
  (await avecEcole(ecole, (tx) => listerContacts(tx, "", { filtre: lireFiltre(f, null, COLONNES_CONTACTS) }))).map((c) => c.raisonSociale ?? c.prenom);

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

describe("contacts", () => {
  it("élèves suivis, nom d'organisme, e-mail renseigné", async () => {
    expect(await contacts(["eleves.contient.lea"])).toEqual(["Sophie"]);
    expect(await contacts(["nom.contient.ateliers"])).toEqual(["CSE Ateliers"]);
    expect(await contacts(["email.non_vide"])).toEqual(["Sophie"]);
  });
});
