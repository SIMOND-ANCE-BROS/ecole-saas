import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { choisirEcole, contexteDepuisSession } from "./acces-ecole";
import { auth } from "./auth";
import { creerCompte } from "./comptes";

/**
 * Connexion et choix de l'école, contre la vraie base. Données fictives,
 * supprimées à la fin (les écritures de Better Auth ne sont pas annulables
 * dans une transaction de test).
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
const email = `accueil-${suffixe}@exemple.test`;
const motDePasse = "mot-de-passe-de-test-assez-long";
let userId: string;
let ecoleA: string; // membre actif
let ecoleB: string; // aucun lien
let ecoleC: string; // membre désactivé

async function creerEcole(nom: string) {
  const [e] = await admin`INSERT INTO school (name, slug) VALUES (${nom}, ${`${nom}-${suffixe}`}) RETURNING id`;
  return e.id as string;
}

async function seConnecter() {
  const resultat = await auth.api.signInEmail({ body: { email, password: motDePasse } });
  const [s] = await admin`SELECT id, selected_school_id FROM session WHERE token = ${resultat.token}`;
  return s as { id: string; selected_school_id: string | null };
}

beforeAll(async () => {
  ecoleA = await creerEcole("ecole-a");
  ecoleB = await creerEcole("ecole-b");
  ecoleC = await creerEcole("ecole-c");
  userId = await creerCompte({ email, nom: "Accueil Test", motDePasse });
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${ecoleA}, ${userId}, 'accueil')`;
  await admin`INSERT INTO member (school_id, user_id, role, active) VALUES (${ecoleC}, ${userId}, 'direction', false)`;
});

afterAll(async () => {
  await admin`DELETE FROM member WHERE user_id = ${userId}`;
  await admin`DELETE FROM "user" WHERE id = ${userId}`; // sessions et comptes en cascade
  await admin`DELETE FROM school WHERE id IN (${ecoleA}, ${ecoleB}, ${ecoleC})`;
  await admin.end();
});

describe("Connexion", () => {
  it("connecte un compte créé par l’école", async () => {
    const session = await seConnecter();
    expect(session.id).toBeTruthy();
    expect(session.selected_school_id).toBeNull();
  });

  it("refuse un mauvais mot de passe", async () => {
    await expect(auth.api.signInEmail({ body: { email, password: "pas-le-bon-mot-de-passe" } })).rejects.toThrow();
  });

  it("refuse l’inscription libre", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: `libre-${suffixe}@exemple.test`, password: motDePasse, name: "Libre" },
      }),
    ).rejects.toThrow();
  });
});

describe("Choix de l’école", () => {
  it("enregistre sur la session une école dont on est membre actif", async () => {
    const session = await seConnecter();
    expect(await choisirEcole(session.id, userId, ecoleA)).toBe(true);
    const [apres] = await admin`SELECT selected_school_id FROM session WHERE id = ${session.id}`;
    expect(apres.selected_school_id).toBe(ecoleA);
    expect(await contexteDepuisSession(userId, ecoleA)).toEqual({ userId, ecoleId: ecoleA, role: "accueil" });
  });

  it("refuse une école dont on n’est pas membre", async () => {
    const session = await seConnecter();
    expect(await choisirEcole(session.id, userId, ecoleB)).toBe(false);
    const [apres] = await admin`SELECT selected_school_id FROM session WHERE id = ${session.id}`;
    expect(apres.selected_school_id).toBeNull();
    expect(await contexteDepuisSession(userId, ecoleB)).toBeNull();
  });

  it("refuse une école où l’accès a été désactivé", async () => {
    const session = await seConnecter();
    expect(await choisirEcole(session.id, userId, ecoleC)).toBe(false);
    expect(await contexteDepuisSession(userId, ecoleC)).toBeNull();
  });

  it("refuse la session d’un autre compte et un identifiant mal formé", async () => {
    const session = await seConnecter();
    expect(await choisirEcole(session.id, "autre-compte", ecoleA)).toBe(false);
    expect(await choisirEcole(session.id, userId, "pas-un-uuid")).toBe(false);
    expect(await contexteDepuisSession(userId, null)).toBeNull();
  });
});
