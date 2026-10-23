import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ajouterResponsable,
  creerEleve,
  definirFacturation,
  lireContact,
  lireEleve,
  listerContacts,
  listerEleves,
  RefusCreation,
  type SaisieEleve,
} from "./eleves";
import { avecEcole } from "./index";
import type { SaisiePersonne } from "./personnes";

/** Élèves et contacts (#77), comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
const AUJOURDHUI = "2026-10-20";
let ecole: string;
let autreEcole: string;
let etranger: string;

const personne = (champs: Partial<SaisiePersonne>): SaisiePersonne => ({
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
  ...champs,
});

const creer = (s: SaisieEleve, confirme = false) => avecEcole(ecole, (tx) => creerEleve(tx, s, confirme));
const fiche = (id: string) => avecEcole(ecole, (tx) => lireEleve(tx, id, AUJOURDHUI));
const idDe = (r: Awaited<ReturnType<typeof creer>>) => {
  if (r.statut !== "ok") throw new Error("création refusée");
  return r.id;
};

let zoe: string;
let helene: string;

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ea-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`eb-${suffixe}`}) RETURNING id`;
  [{ id: etranger }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${autreEcole}, 'Ailleurs', 'Inconnue') RETURNING id`;
});

afterAll(async () => {
  for (const t of ["relationship", "person"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [ecole, autreEcole]);
  await admin`DELETE FROM school WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

describe("création guidée", () => {
  it("crée une mineure avec un nouveau responsable, à prévenir et facturé", async () => {
    zoe = idDe(
      await creer({
        eleve: personne({ nom: "Lefèvre", prenom: "Zoé", dateNaissance: "2015-03-10" }),
        responsable: { nouveau: personne({ nom: "Lefèvre", prenom: "Hélène", telephone: "06 12 34 56 78" }) },
        aPrevenir: true,
        facturation: { type: "responsable" },
      }),
    );
    const z = await fiche(zoe);
    expect(z).toMatchObject({ eleve: true, prenom: "Zoé" });
    expect(z?.responsables).toMatchObject([
      { nom: "Hélène Lefèvre", aPrevenir: true, paie: true, telephone: "06 12 34 56 78" },
    ]);
    helene = z?.responsables[0].id as string;
    expect(z?.factureA).toEqual({ type: "personne", id: helene, nom: "Hélène Lefèvre" });

    const h = await avecEcole(ecole, (tx) => lireContact(tx, helene));
    expect(h).toMatchObject({ eleve: false, eleves: [{ id: zoe, responsable: true, paie: true, aPrevenir: true }] });
  });

  it("signale le responsable déjà connu, puis rattache le frère au même payeur : fratrie", async () => {
    const noe = {
      eleve: personne({ nom: "Lefèvre", prenom: "Noé", dateNaissance: "2017-11-02" }),
      responsable: { nouveau: personne({ nom: "Lefèvre", prenom: "Hélène", telephone: "0612345678" }) },
      aPrevenir: true,
      facturation: { type: "responsable" as const },
    };
    expect(await creer(noe)).toMatchObject({ statut: "doublons", doublons: [{ role: "responsable", id: helene }] });
    const id = idDe(await creer({ ...noe, responsable: { id: helene } }));
    expect((await fiche(id))?.fratrie).toEqual([{ id: zoe, prenom: "Zoé" }]);
    expect((await fiche(zoe))?.fratrie.map((f) => f.prenom)).toEqual(["Noé"]);
  });

  it("crée un adulte seul, qui paie lui-même, et signale un mineur sans payeur", async () => {
    const ines = idDe(
      await creer({
        eleve: personne({ nom: "Moreau", prenom: "Inès", dateNaissance: "1992-07-14" }),
        responsable: null,
        aPrevenir: false,
        facturation: { type: "eleve" },
      }),
    );
    expect((await fiche(ines))?.factureA).toEqual({ type: "eleve" });
    const lou = idDe(
      await creer({
        eleve: personne({ nom: "Petit", prenom: "Lou", dateNaissance: "2020-01-01" }),
        responsable: null,
        aPrevenir: false,
        facturation: { type: "eleve" },
      }),
    );
    expect((await fiche(lou))?.factureA).toEqual({ type: "aucun" });
  });

  it("facture un organisme créé dans la foulée", async () => {
    const paul = idDe(
      await creer({
        eleve: personne({ nom: "Durand", prenom: "Paul", dateNaissance: "1980-01-01" }),
        responsable: null,
        aPrevenir: false,
        facturation: {
          type: "autre",
          payeur: { nouveau: personne({ type: "professionnel", raisonSociale: "CSE Ateliers", siren: "123456789" }) },
        },
      }),
    );
    expect((await fiche(paul))?.factureA).toMatchObject({ type: "personne", nom: "CSE Ateliers" });
    expect((await avecEcole(ecole, (tx) => listerContacts(tx, "ateliers"))).map((c) => c.eleves)).toEqual([["Paul"]]);
  });

  it("n’enregistre rien quand une partie est refusée (responsable d’une autre école)", async () => {
    const [{ avant }] = await admin`SELECT count(*)::int AS before FROM person WHERE school_id = ${ecole}`;
    await expect(
      creer(
        {
          eleve: personne({ nom: "Seul", prenom: "Max", dateNaissance: "2016-01-01" }),
          responsable: { id: etranger },
          aPrevenir: true,
          facturation: { type: "responsable" },
        },
        true,
      ),
    ).rejects.toBeInstanceOf(RefusCreation);
    const [{ apres }] = await admin`SELECT count(*)::int AS after FROM person WHERE school_id = ${ecole}`;
    expect(apres).toBe(avant);
  });
});

describe("listes", () => {
  it("liste les élèves avec responsables et payeur, et retrouve un enfant par le téléphone de sa mère", async () => {
    const eleves = await avecEcole(ecole, (tx) => listerEleves(tx));
    expect(eleves.map((e) => e.prenom)).toEqual(["Paul", "Noé", "Zoé", "Inès", "Lou"]);
    expect(eleves.find((e) => e.prenom === "Zoé")).toMatchObject({
      responsables: ["Hélène Lefèvre"],
      factureA: "Hélène Lefèvre",
      telephone: "06 12 34 56 78",
    });
    expect((await avecEcole(ecole, (tx) => listerEleves(tx, "0612345678"))).map((e) => e.prenom)).toEqual([
      "Noé",
      "Zoé",
    ]);
    expect(await avecEcole(ecole, (tx) => listerEleves(tx, "x"))).toEqual([]);
  });

  it("liste les contacts sans les élèves, ni ceux d’une autre école", async () => {
    const contacts = await avecEcole(ecole, (tx) => listerContacts(tx));
    expect(contacts.map((c) => c.raisonSociale ?? c.prenom)).toEqual(["CSE Ateliers", "Hélène"]);
    expect(contacts.find((c) => c.prenom === "Hélène")?.eleves.sort()).toEqual(["Noé", "Zoé"]);
  });
});

describe("modifications depuis la fiche", () => {
  it("change le payeur : l’élève elle-même, puis à nouveau sa mère", async () => {
    expect(await avecEcole(ecole, (tx) => definirFacturation(tx, zoe, { type: "eleve" }))).toEqual({
      ok: true,
      id: zoe,
    });
    expect((await fiche(zoe))?.factureA).toEqual({ type: "aucun" }); // mineure sans payeur : signalé
    await avecEcole(ecole, (tx) => definirFacturation(tx, zoe, { type: "personne", id: helene }));
    expect((await fiche(zoe))?.factureA).toMatchObject({ type: "personne", id: helene });
  });

  it("retourne un lien saisi dans l’autre sens pour en faire le payeur", async () => {
    const [{ id: conjoint }] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${ecole}, 'Moreau', 'Sam') RETURNING id`;
    const [{ id: ines }] = await admin`SELECT id FROM person WHERE school_id = ${ecole} AND first_name = 'Inès'`;
    await admin`INSERT INTO relationship (school_id, person_id, related_person_id, type) VALUES (${ecole}, ${ines}, ${conjoint}, 'conjoint')`;
    await avecEcole(ecole, (tx) => definirFacturation(tx, ines, { type: "personne", id: conjoint }));
    const f = await fiche(ines);
    expect(f?.factureA).toMatchObject({ type: "personne", nom: "Sam Moreau" });
    expect(f?.autres).toMatchObject([{ nom: "Sam Moreau", relation: "conjoint", paie: true }]);
  });

  it("fait d’un proche existant un responsable, et refuse un responsable d’une autre école", async () => {
    const [{ id: lou }] = await admin`SELECT id FROM person WHERE school_id = ${ecole} AND first_name = 'Lou'`;
    expect((await avecEcole(ecole, (tx) => ajouterResponsable(tx, lou, { id: helene }, true))).ok).toBe(true);
    expect((await fiche(lou))?.responsables).toMatchObject([{ id: helene, aPrevenir: true, paie: false }]);
    expect(await avecEcole(ecole, (tx) => ajouterResponsable(tx, lou, { id: etranger }, true))).toEqual({
      ok: false,
      message: "Responsable introuvable.",
    });
  });

  it("ne lit pas un élève d’une autre école", async () => {
    expect(await avecEcole(autreEcole, (tx) => lireEleve(tx, zoe, AUJOURDHUI))).toBeNull();
  });
});
