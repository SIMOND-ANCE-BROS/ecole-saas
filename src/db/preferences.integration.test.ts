import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avecEcole } from "./index";
import { enregistrerPreference, lirePreference } from "./preferences";

/** Disposition des colonnes par membre (#89), comme l'application (app_user, RLS). Données fictives supprimées à la fin. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
const accueil = `pref-accueil-${suffixe}`;
const direction = `pref-direction-${suffixe}`;
let ecole: string;
let autreEcole: string;

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`pa-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`pb-${suffixe}`}) RETURNING id`;
  for (const id of [accueil, direction])
    await admin`INSERT INTO "user" (id, name, email) VALUES (${id}, 'Test', ${`${id}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${ecole}, ${accueil}, 'accueil'), (${ecole}, ${direction}, 'direction'), (${autreEcole}, ${accueil}, 'direction')`;
});

afterAll(async () => {
  await admin`DELETE FROM list_preference WHERE school_id IN (${ecole}, ${autreEcole})`;
  await admin`DELETE FROM member WHERE school_id IN (${ecole}, ${autreEcole})`;
  await admin`DELETE FROM "user" WHERE id IN (${accueil}, ${direction})`;
  await admin`DELETE FROM school WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

describe("préférences de colonnes", () => {
  it("sans préférence : null", async () => {
    expect(await avecEcole(ecole, (tx) => lirePreference(tx, accueil, "eleves"))).toBeNull();
  });

  it("enregistre puis remplace, sans toucher aux autres membres, listes ou écoles", async () => {
    await avecEcole(ecole, (tx) => enregistrerPreference(tx, accueil, "eleves", ["age", "-nom"]));
    await avecEcole(ecole, (tx) => enregistrerPreference(tx, accueil, "eleves", ["nom", "age"]));
    await avecEcole(ecole, (tx) => enregistrerPreference(tx, direction, "eleves", ["telephone"]));
    await avecEcole(autreEcole, (tx) => enregistrerPreference(tx, accueil, "eleves", ["facture"]));
    expect(await avecEcole(ecole, (tx) => lirePreference(tx, accueil, "eleves"))).toEqual(["nom", "age"]);
    expect(await avecEcole(ecole, (tx) => lirePreference(tx, direction, "eleves"))).toEqual(["telephone"]);
    expect(await avecEcole(ecole, (tx) => lirePreference(tx, accueil, "contacts"))).toBeNull();
    expect(await avecEcole(autreEcole, (tx) => lirePreference(tx, accueil, "eleves"))).toEqual(["facture"]);
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM list_preference WHERE school_id = ${ecole}`;
    expect(n).toBe(2);
  });

  it("refuse un compte qui n'est pas membre de l'école courante", async () => {
    expect(await avecEcole(autreEcole, (tx) => enregistrerPreference(tx, direction, "eleves", ["nom"]))).toBe(false);
  });
});
