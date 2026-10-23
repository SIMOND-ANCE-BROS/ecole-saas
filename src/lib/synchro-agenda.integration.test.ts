import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avecEcole } from "../db";
import { enregistrerConnexion, etatConnexion, supprimerConnexion } from "../db/connexions-agenda";
import { lireIntervenant, modifierIntervenant } from "../db/intervenants";
import { listerIndisponibilites } from "../db/disponibilites";
import { chiffrer, dechiffrer } from "./chiffrement";
import { synchroniserAgenda } from "./synchro-agenda";

/** Synchronisation d'un agenda connecté, avec un faux fournisseur (aucun appel réseau). */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
let ecole: string;
let camille: string;
const MAINTENANT = new Date("2026-11-01T08:00:00Z");

const reponse = (status: number, json: unknown) =>
  new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });

beforeAll(async () => {
  process.env.CLE_CHIFFREMENT = randomBytes(32).toString("base64");
  process.env.MICROSOFT_CLIENT_ID = "client-test";
  process.env.MICROSOFT_CLIENT_SECRET = "secret-test";
  [{ id: ecole }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`sy-${suffixe}`}) RETURNING id`;
  [{ id: camille }] =
    await admin`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${ecole}, 'Durand', 'Camille', 'salarie', 'non_applicable', 'heure', 3000) RETURNING id`;
  await avecEcole(ecole, (tx) =>
    enregistrerConnexion(tx, camille, {
      fournisseur: "microsoft",
      compte: "camille@exemple.test",
      jetonChiffre: chiffrer("rafraichissement-1"),
    }),
  );
  await admin`INSERT INTO unavailability (school_id, instructor_id, starts_at, ends_at, source, label)
    VALUES (${ecole}, ${camille}, '2099-11-10T09:00:00Z', '2099-11-10T10:00:00Z', 'saisie', 'Rendez-vous')`;
});

afterAll(async () => {
  for (const t of ["unavailability", "calendar_connection", "instructor"]) {
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [ecole]);
  }
  await admin`DELETE FROM school WHERE id = ${ecole}`;
  await admin.end();
});

const plagesDe = () => avecEcole(ecole, (tx) => listerIndisponibilites(tx, camille, MAINTENANT));

describe("synchroniserAgenda", () => {
  it("garde le jeton chiffré en base, jamais en clair", async () => {
    const [{ encrypted_token: jeton_chiffre }] =
      await admin`SELECT encrypted_token FROM calendar_connection WHERE instructor_id = ${camille}`;
    expect(jeton_chiffre).not.toContain("rafraichissement-1");
    expect(dechiffrer(jeton_chiffre)).toBe("rafraichissement-1");
  });

  it("enregistre les plages occupées, garde la saisie, et prend le jeton renouvelé", async () => {
    const appels: string[] = [];
    const fauxFetch: typeof fetch = async (u, init) => {
      appels.push(String(u));
      if (String(u).includes("/token")) {
        expect(String(init?.body)).toContain("refresh_token=rafraichissement-1");
        return reponse(200, { access_token: "acces", refresh_token: "rafraichissement-2" });
      }
      return reponse(200, {
        value: [
          { start: { dateTime: "2026-11-04T15:00:00" }, end: { dateTime: "2026-11-04T17:00:00" }, showAs: "busy" },
        ],
      });
    };
    expect(await synchroniserAgenda(ecole, camille, fauxFetch, MAINTENANT)).toEqual({ ok: true, plages: 1 });
    expect((await plagesDe()).map((i) => `${i.origine} ${i.debut.toISOString()}`)).toEqual([
      "microsoft 2026-11-04T15:00:00.000Z",
      "saisie 2099-11-10T09:00:00.000Z",
    ]);
    const [{ encrypted_token: jeton_chiffre }] =
      await admin`SELECT encrypted_token FROM calendar_connection WHERE instructor_id = ${camille}`;
    expect(dechiffrer(jeton_chiffre)).toBe("rafraichissement-2");
    expect(await avecEcole(ecole, (tx) => etatConnexion(tx, camille))).toMatchObject({
      compte: "camille@exemple.test",
      erreur: null,
    });
    expect(appels).toHaveLength(2);
  });

  it("note un accès retiré sans perdre les plages déjà lues", async () => {
    const r = await synchroniserAgenda(
      ecole,
      camille,
      async () => reponse(400, { error: "invalid_grant" }),
      MAINTENANT,
    );
    expect(r).toEqual({ ok: false, message: "Accès à l’agenda retiré ou expiré : reconnecter l’agenda." });
    expect((await avecEcole(ecole, (tx) => etatConnexion(tx, camille)))?.erreur).toBe(
      "Accès à l’agenda retiré ou expiré : reconnecter l’agenda.",
    );
    expect(await plagesDe()).toHaveLength(2);
  });

  it("ne révèle rien d’une panne du fournisseur", async () => {
    const panne: typeof fetch = async () => {
      throw new Error("ECONNRESET camille@exemple.test");
    };
    expect(await synchroniserAgenda(ecole, camille, panne, MAINTENANT)).toEqual({
      ok: false,
      message: "Synchronisation impossible pour le moment ; elle sera retentée.",
    });
  });

  it("déconnecte l’agenda ; la saisie reste", async () => {
    expect(await avecEcole(ecole, (tx) => supprimerConnexion(tx, camille))).toBe(true);
    expect((await plagesDe()).some((i) => i.origine === "saisie")).toBe(true);
    expect(await synchroniserAgenda(ecole, camille, fetch, MAINTENANT)).toEqual({
      ok: false,
      message: "Aucun agenda connecté.",
    });
  });

  it("n’enregistre ni ne synchronise l’agenda d’un intervenant désactivé, et efface sa connexion", async () => {
    await avecEcole(ecole, (tx) =>
      enregistrerConnexion(tx, camille, { fournisseur: "microsoft", compte: null, jetonChiffre: chiffrer("r") }),
    );
    const fiche = await avecEcole(ecole, (tx) => lireIntervenant(tx, camille));
    if (!fiche) throw new Error("intervenant introuvable");
    const { id, ...saisie } = fiche;
    expect(id).toBe(camille);
    await avecEcole(ecole, (tx) => modifierIntervenant(tx, camille, { ...saisie, actif: false }));
    expect(await avecEcole(ecole, (tx) => etatConnexion(tx, camille))).toBeNull();
    expect(
      await avecEcole(ecole, (tx) =>
        enregistrerConnexion(tx, camille, { fournisseur: "microsoft", compte: null, jetonChiffre: chiffrer("r") }),
      ),
    ).toBe(false);
    // Même une ligne restée en base (restauration) est ignorée.
    await admin`INSERT INTO calendar_connection (school_id, instructor_id, provider, encrypted_token) VALUES (${ecole}, ${camille}, 'microsoft', ${chiffrer("r")})`;
    expect(await synchroniserAgenda(ecole, camille, fetch, MAINTENANT)).toEqual({
      ok: false,
      message: "Aucun agenda connecté.",
    });
  });
});
