import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerFamille, lireFamille, modifierFamille, type SaisieFamille } from "./familles";
import { avecEcole } from "./index";

/** Création et modification des familles, comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
let ecole: string;
let autreEcole: string;

const martin: SaisieFamille = {
  type: "particulier",
  nom: "Martin",
  prenom: "Paul",
  raisonSociale: null,
  siren: null,
  email: "paul.martin@exemple.test",
  telephone: "06 98 76 54 32",
  adresse: null,
};

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École A', ${`fa-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École B', ${`fb-${suffixe}`}) RETURNING id`;
  await admin`INSERT INTO payeur (ecole_id, nom, telephone) VALUES (${autreEcole}, 'Martin', '0698765432')`;
});

afterAll(async () => {
  await admin`DELETE FROM danseur WHERE ecole_id IN (${ecole}, ${autreEcole})`;
  await admin`DELETE FROM payeur WHERE ecole_id IN (${ecole}, ${autreEcole})`;
  await admin`DELETE FROM ecole WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

describe("creerFamille", () => {
  it("crée la famille et son premier danseur", async () => {
    const r = await avecEcole(ecole, (tx) => creerFamille(tx, martin, { prenom: "Léa", dateNaissance: "2014-06-21" }, false));
    expect(r.statut).toBe("ok");
    const id = r.statut === "ok" ? r.id : "";
    expect(await avecEcole(ecole, (tx) => lireFamille(tx, id))).toMatchObject({
      nom: "Martin",
      prenom: "Paul",
      telephone: "06 98 76 54 32",
      danseurs: [{ prenom: "Léa", nom: "Martin", dateNaissance: "2014-06-21" }],
    });
  });

  it("signale un doublon probable (même téléphone, espaces ignorés) de la même école seulement", async () => {
    const julie = { ...martin, prenom: "Julie", email: null, telephone: "0698765432" };
    const r = await avecEcole(ecole, (tx) => creerFamille(tx, julie, null, false));
    expect(r).toMatchObject({ statut: "doublons", doublons: [{ nom: "Martin", prenom: "Paul" }] });
    const confirme = await avecEcole(ecole, (tx) => creerFamille(tx, julie, null, true));
    expect(confirme.statut).toBe("ok");
  });

  it("crée un payeur professionnel sous sa raison sociale", async () => {
    const cse: SaisieFamille = {
      ...martin,
      type: "professionnel",
      nom: "",
      prenom: null,
      raisonSociale: "CSE Exemple",
      siren: "123456789",
      email: "cse@exemple.test",
      telephone: null,
    };
    const r = await avecEcole(ecole, (tx) => creerFamille(tx, cse, null, false));
    const id = r.statut === "ok" ? r.id : "";
    expect(await avecEcole(ecole, (tx) => lireFamille(tx, id))).toMatchObject({
      type: "professionnel",
      nom: "CSE Exemple",
      raisonSociale: "CSE Exemple",
    });
  });
});

describe("modifierFamille", () => {
  it("modifie les coordonnées", async () => {
    const r = await avecEcole(ecole, (tx) => creerFamille(tx, { ...martin, nom: "Petit", email: null, telephone: null }, null, false));
    const id = r.statut === "ok" ? r.id : "";
    expect(await avecEcole(ecole, (tx) => modifierFamille(tx, id, { ...martin, nom: "Petit", adresse: "3 rue des Lilas" }))).toEqual({
      ok: true,
      id,
    });
    expect(await avecEcole(ecole, (tx) => lireFamille(tx, id))).toMatchObject({ adresse: "3 rue des Lilas" });
  });

  it("ne modifie pas une famille d’une autre école", async () => {
    const [{ id }] = await admin`SELECT id FROM payeur WHERE ecole_id = ${autreEcole}`;
    expect(await avecEcole(ecole, (tx) => modifierFamille(tx, id, martin))).toEqual({ ok: false, message: "Cette famille n’existe plus." });
  });
});
