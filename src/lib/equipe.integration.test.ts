import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { avecEcole } from "../db";
import { inviter, invitationsEnCours, listerMembres, modifierMembre, revoquerInvitation } from "../db/equipe";
import { auth } from "./auth";
import { creerCompte } from "./comptes";
import { accepterLien, creerLienReinitialisation, ouvrirLien } from "./invitations";

/**
 * Équipe d'une école (#104) : invitations, rôles, réinitialisation, contre la
 * vraie base et Better Auth. Données fictives supprimées à la fin (le journal,
 * inaltérable, est nettoyé en désactivant son trigger le temps d'une
 * transaction d'administration).
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffixe = Math.random().toString(36).slice(2, 8);
const MDP = "une phrase de passe de test";
const emailDiana = `diana-${suffixe}@exemple.test`;
const emailNouvelle = `accueil-${suffixe}@exemple.test`;
const emailProf = `prof-${suffixe}@exemple.test`;
let ecole: string;
let autreEcole: string;
let diana: string;
let prof: string;
let dianaMembre: string;

const connecter = (email: string, motDePasse: string) => auth.api.signInEmail({ body: { email, password: motDePasse } });
const membre = async (email: string) => (await avecEcole(ecole, (tx) => listerMembres(tx))).find((m) => m.email === email)!;

beforeAll(async () => {
  [{ id: ecole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École A', ${`ea-${suffixe}`}) RETURNING id`;
  [{ id: autreEcole }] = await admin`INSERT INTO ecole (nom, slug) VALUES ('École B', ${`eb-${suffixe}`}) RETURNING id`;
  diana = await creerCompte({ email: emailDiana, nom: "Diana Test", motDePasse: MDP });
  [{ id: dianaMembre }] = await admin`INSERT INTO membre (ecole_id, user_id, role) VALUES (${ecole}, ${diana}, 'direction') RETURNING id`;
  // Un compte déjà membre d'une autre école.
  prof = await creerCompte({ email: emailProf, nom: "Prof Ailleurs", motDePasse: MDP });
  await admin`INSERT INTO membre (ecole_id, user_id, role) VALUES (${autreEcole}, ${prof}, 'direction')`;
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE journal DISABLE TRIGGER journal_ajout_seul`;
    await t`DELETE FROM journal WHERE ecole_id IN (${ecole}, ${autreEcole})`;
    await t`ALTER TABLE journal ENABLE TRIGGER journal_ajout_seul`;
  });
  await admin`DELETE FROM invitation WHERE ecole_id IN (${ecole}, ${autreEcole})`;
  await admin`DELETE FROM membre WHERE ecole_id IN (${ecole}, ${autreEcole})`;
  await admin`DELETE FROM "user" WHERE email IN (${emailDiana}, ${emailProf}, ${emailNouvelle})`; // sessions et comptes en cascade
  await admin`DELETE FROM ecole WHERE id IN (${ecole}, ${autreEcole})`;
  await admin.end();
});

const saisie = (motDePasse: string, extra: Partial<{ nom: string; confirmation: string; motDePasseActuel: string }> = {}) => ({
  nom: "Accueil Nouvelle",
  motDePasse,
  confirmation: motDePasse,
  motDePasseActuel: "",
  ...extra,
});

describe("invitation", () => {
  let jeton: string;

  it("invite : le lien s'ouvre, une seule invitation par e-mail, jeton jamais stocké en clair", async () => {
    const r1 = await avecEcole(ecole, (tx) => inviter(tx, diana, { email: emailNouvelle, nom: "Accueil", role: "accueil" }, new Date()));
    const r2 = await avecEcole(ecole, (tx) => inviter(tx, diana, { email: emailNouvelle.toUpperCase(), nom: "Accueil", role: "accueil" }, new Date()));
    if (!r1.ok || !r2.ok) throw new Error("invitation refusée");
    jeton = r2.jeton;
    expect(await ouvrirLien(ecole, r1.jeton)).toBeNull(); // remplacée par la seconde
    expect(await ouvrirLien(ecole, jeton)).toMatchObject({ type: "invitation", email: emailNouvelle, role: "accueil", ecole: "École A", compteExistant: false });
    expect(await ouvrirLien(autreEcole, jeton)).toBeNull();
    const [{ jeton_hash }] = await admin`SELECT jeton_hash FROM invitation WHERE id = ${r2.id}`;
    expect(jeton_hash).not.toContain(jeton);
    expect(await avecEcole(ecole, (tx) => invitationsEnCours(tx, new Date()))).toHaveLength(1);
  });

  it("refuse un mot de passe trop court, puis crée le compte ; le lien ne sert qu'une fois", async () => {
    expect(await accepterLien(ecole, jeton, saisie("court"))).toMatchObject({ ok: false });
    expect(await accepterLien(ecole, jeton, saisie(MDP))).toEqual({ ok: true, type: "invitation", email: emailNouvelle });
    expect(await accepterLien(ecole, jeton, saisie(MDP))).toMatchObject({ ok: false });
    await expect(connecter(emailNouvelle, MDP)).resolves.toBeTruthy();
    expect(await membre(emailNouvelle)).toMatchObject({ role: "accueil", actif: true, nom: "Accueil Nouvelle" });
  });

  it("un compte existant confirme son mot de passe actuel pour rejoindre l'école", async () => {
    const r = await avecEcole(ecole, (tx) => inviter(tx, diana, { email: emailProf, nom: "Prof", role: "direction" }, new Date()));
    if (!r.ok) throw new Error(r.message);
    expect(await ouvrirLien(ecole, r.jeton)).toMatchObject({ compteExistant: true });
    expect(await accepterLien(ecole, r.jeton, saisie("", { motDePasseActuel: "pas le bon" }))).toEqual({ ok: false, message: "Mot de passe actuel incorrect." });
    expect((await accepterLien(ecole, r.jeton, saisie("", { motDePasseActuel: MDP }))).ok).toBe(true);
    expect(await membre(emailProf)).toMatchObject({ role: "direction", actif: true });
  });

  it("refuse d'inviter une personne déjà dans l'équipe ; une invitation révoquée ou expirée ne s'ouvre plus", async () => {
    expect(await avecEcole(ecole, (tx) => inviter(tx, diana, { email: emailDiana, nom: "Diana", role: "accueil" }, new Date()))).toEqual({
      ok: false,
      message: "Cette personne fait déjà partie de l’équipe.",
    });
    const r = await avecEcole(ecole, (tx) => inviter(tx, diana, { email: `x-${suffixe}@exemple.test`, nom: "X", role: "accueil" }, new Date()));
    if (!r.ok) throw new Error(r.message);
    expect((await avecEcole(ecole, (tx) => revoquerInvitation(tx, r.id))).ok).toBe(true);
    expect(await ouvrirLien(ecole, r.jeton)).toBeNull();
    const vieux = await avecEcole(ecole, (tx) => inviter(tx, diana, { email: `y-${suffixe}@exemple.test`, nom: "Y", role: "accueil" }, new Date("2020-01-01")));
    if (!vieux.ok) throw new Error(vieux.message);
    expect(await ouvrirLien(ecole, vieux.jeton)).toBeNull();
  });
});

describe("rôles et accès", () => {
  it("change l'accès d'un autre membre, refuse de toucher à son propre accès, trace dans le journal", async () => {
    const accueil = await membre(emailNouvelle);
    expect((await avecEcole(ecole, (tx) => modifierMembre(tx, diana, accueil.id, { role: "accueil", actif: false }))).ok).toBe(true);
    expect((await avecEcole(ecole, (tx) => modifierMembre(tx, diana, dianaMembre, { role: "accueil", actif: true }))).ok).toBe(false);
    const [t] = await admin`SELECT avant->>'actif' AS avant, apres->>'actif' AS apres FROM journal WHERE ligne_id = ${accueil.id}`;
    expect(t).toEqual({ avant: "true", apres: "false" });
  });

  it("seule la direction gère l'équipe, même sans passer par la page", async () => {
    const p = await membre(emailProf);
    // Diana passe le prof à l'accueil : elle reste à la direction, c'est permis.
    expect((await avecEcole(ecole, (tx) => modifierMembre(tx, diana, p.id, { role: "accueil", actif: true }))).ok).toBe(true);
    // À l'accueil, il ne peut plus toucher à l'équipe ni inviter.
    expect(await avecEcole(ecole, (tx) => modifierMembre(tx, prof, dianaMembre, { role: "accueil", actif: true }))).toEqual({ ok: false, message: "Accès refusé." });
    expect(await avecEcole(ecole, (tx) => inviter(tx, prof, { email: `z-${suffixe}@exemple.test`, nom: "Z", role: "direction" }, new Date()))).toEqual({
      ok: false,
      message: "Accès refusé.",
    });
    expect((await avecEcole(ecole, (tx) => modifierMembre(tx, diana, p.id, { role: "direction", actif: true }))).ok).toBe(true);
  });
});

describe("réinitialisation du mot de passe", () => {
  it("refusée pour un compte qui sert aussi dans une autre école", async () => {
    const p = await membre(emailProf);
    expect(await creerLienReinitialisation(ecole, diana, p.id)).toEqual({
      ok: false,
      message: "Ce compte sert aussi dans une autre école : la personne doit changer elle-même son mot de passe.",
    });
  });

  it("le lien remplace le mot de passe et ferme les sessions ouvertes", async () => {
    const n = await membre(emailNouvelle);
    await connecter(emailNouvelle, MDP);
    const [{ n: avant }] = await admin`SELECT count(*)::int AS n FROM session WHERE user_id = ${n.userId}`;
    expect(avant).toBeGreaterThan(0);
    const r = await creerLienReinitialisation(ecole, diana, n.id);
    if (!r.ok) throw new Error(r.message);
    expect(await ouvrirLien(ecole, r.jeton)).toMatchObject({ type: "reinitialisation", email: emailNouvelle });
    const nouveau = "un tout nouveau mot de passe";
    expect(await accepterLien(ecole, r.jeton, saisie(nouveau))).toEqual({ ok: true, type: "reinitialisation", email: emailNouvelle });
    const [{ n: apres }] = await admin`SELECT count(*)::int AS n FROM session WHERE user_id = ${n.userId}`;
    expect(apres).toBe(0);
    await expect(connecter(emailNouvelle, MDP)).rejects.toThrow();
    await expect(connecter(emailNouvelle, nouveau)).resolves.toBeTruthy();
    // Compte créé par un lien transmis à la main : e-mail non vérifié (#105).
    const [{ email_verified }] = await admin`SELECT email_verified FROM "user" WHERE id = ${n.userId}`;
    expect(email_verified).toBe(false);
  });

  it("un lien créé puis devenu dangereux (compte ajouté, même désactivé, à une autre école) est refusé à l'usage", async () => {
    const n = await membre(emailNouvelle);
    const r = await creerLienReinitialisation(ecole, diana, n.id);
    if (!r.ok) throw new Error(r.message);
    await admin`INSERT INTO membre (ecole_id, user_id, role, actif) VALUES (${autreEcole}, ${n.userId}, 'accueil', false)`;
    expect(await accepterLien(ecole, r.jeton, saisie("encore un autre mot de passe"))).toEqual({
      ok: false,
      message: "Ce compte sert aussi dans une autre école : la personne doit changer elle-même son mot de passe.",
    });
    expect(await creerLienReinitialisation(ecole, diana, n.id)).toMatchObject({ ok: false });
  });

  it("une autre école ne voit ni les membres ni les invitations de celle-ci", async () => {
    expect((await avecEcole(autreEcole, (tx) => listerMembres(tx))).some((m) => m.email === emailDiana)).toBe(false);
    expect(await avecEcole(autreEcole, (tx) => invitationsEnCours(tx, new Date()))).toEqual([]);
  });
});
