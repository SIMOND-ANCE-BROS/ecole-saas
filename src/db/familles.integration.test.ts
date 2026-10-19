import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lireFamille, listerFamilles, rechercherFamilles } from "./familles";
import { avecEcole } from "./index";

/**
 * Recherche et fiche famille, exécutées comme l'application (app_user, RLS).
 * Données fictives créées en administrateur et supprimées à la fin.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
let ecole: string;
let autreEcole: string;
let lefevre: string;
let etrangere: string;

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École A', ${`a-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École B', ${`b-${suffixe}`}) RETURNING id`;
  [{ id: lefevre }] = await admin`
    INSERT INTO payeur (ecole_id, nom, prenom, email, telephone)
    VALUES (${ecole}, 'Lefèvre', 'Hélène', 'helene.lefevre@exemple.test', '06 12 34 56 78') RETURNING id`;
  await admin`
    INSERT INTO danseur (ecole_id, payeur_id, nom, prenom, date_naissance)
    VALUES (${ecole}, ${lefevre}, 'Lefèvre', 'Zoé', '2015-03-10'), (${ecole}, ${lefevre}, 'Lefèvre', 'Noé', NULL)`;
  await admin`INSERT INTO payeur (ecole_id, nom, prenom) VALUES (${ecole}, 'Martin', 'Paul')`;
  [{ id: etrangere }] = await admin`
    INSERT INTO payeur (ecole_id, nom, prenom, telephone)
    VALUES (${autreEcole}, 'Lefèvre', 'Inconnue', '0612345678') RETURNING id`;
});

afterAll(async () => {
  await admin`DELETE FROM danseur WHERE ecole_id IN (${ecole}, ${autreEcole})`;
  await admin`DELETE FROM payeur WHERE ecole_id IN (${ecole}, ${autreEcole})`;
  await admin`DELETE FROM ecole WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

const chercher = (q: string) => avecEcole(ecole, (tx) => rechercherFamilles(tx, q));

describe("rechercherFamilles", () => {
  it("trouve par nom, sans accents ni majuscules", async () => {
    const resultats = await chercher("lefevre");
    expect(resultats.map((r) => r.id)).toEqual([lefevre]);
    expect(resultats[0]).toMatchObject({
      nom: "Lefèvre",
      prenom: "Hélène",
      danseurs: ["Noé", "Zoé"],
    });
  });

  it("trouve par prénom d’un danseur", async () => {
    expect((await chercher("zoe")).map((r) => r.id)).toEqual([lefevre]);
  });

  it("trouve par téléphone, avec ou sans espaces", async () => {
    expect((await chercher("0612 34")).map((r) => r.id)).toEqual([lefevre]);
    expect((await chercher("06 12 34 56 78")).map((r) => r.id)).toEqual([lefevre]);
  });

  it("trouve par e-mail", async () => {
    expect((await chercher("helene.lef")).map((r) => r.id)).toEqual([lefevre]);
  });

  it("ne renvoie rien pour une recherche trop courte", async () => {
    expect(await chercher(" l ")).toEqual([]);
  });

  it("ne trouve jamais une famille d’une autre école", async () => {
    const ids = (await chercher("lefevre")).map((r) => r.id);
    expect(ids).not.toContain(etrangere);
  });
});

describe("lireFamille", () => {
  it("renvoie le payeur et ses danseurs", async () => {
    const famille = await avecEcole(ecole, (tx) => lireFamille(tx, lefevre));
    expect(famille).toMatchObject({
      id: lefevre,
      nom: "Lefèvre",
      telephone: "06 12 34 56 78",
      danseurs: [
        { prenom: "Noé", dateNaissance: null },
        { prenom: "Zoé", dateNaissance: "2015-03-10" },
      ],
    });
  });

  it("ne lit pas la fiche d’une autre école, même par son identifiant", async () => {
    expect(await avecEcole(ecole, (tx) => lireFamille(tx, etrangere))).toBeNull();
  });

  it("renvoie null pour un identifiant mal formé", async () => {
    expect(await avecEcole(ecole, (tx) => lireFamille(tx, "pas-un-uuid"))).toBeNull();
  });
});

describe("listerFamilles", () => {
  it("liste toutes les familles de l’école par nom, sans celles d’une autre école", async () => {
    const familles = await avecEcole(ecole, (tx) => listerFamilles(tx));
    expect(familles.map((f) => f.nom)).toEqual(["Lefèvre", "Martin"]);
  });
});
