import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "../db";
import { consumeLink, invite, readRelationship } from "../db/team";
import { createAccount } from "./accounts";
import { auth } from "./auth";
import { credentialBefore, keepSessionIfPasswordUnchanged } from "./sign-in-guard";

/**
 * A sign-in in flight when an account is taken back (#404, ADR 0008): the
 * password was checked against the old hash, the session is written after the
 * take-back closed the sessions. Played with real transactions: the take-back
 * (`consumeLink` with credentials) held open, a session written meanwhile as
 * Better Auth writes it. Fictitious data deleted at the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 2, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const OLD = "le mot de passe choisi par un autre";
const NEW = "le mot de passe de la propriétaire";
const directorEmail = `zz-direction-${suffix}@exemple.test`;
const ownerEmail = `zz-proprietaire-${suffix}@exemple.test`;
const stableEmail = `zz-stable-${suffix}@exemple.test`;
let school: string;
let otherSchool: string;
let director: string;
let owner: string;

/** Writes a session as Better Auth does after a successful password check; returns its token. */
async function sessionOf(userId: string) {
  const token = randomUUID();
  await admin`INSERT INTO session (id, token, user_id, expires_at)
    VALUES (${randomUUID()}, ${token}, ${userId}, now() + interval '7 days')`;
  return token;
}
const sessionExists = async (token: string) => (await admin`SELECT 1 FROM session WHERE token = ${token}`).length === 1;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('Zz École A', ${`ga-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École B', ${`gb-${suffix}`}) RETURNING id`;
  director = await createAccount({ email: directorEmail, name: "Zz Direction", password: NEW });
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${director}, 'director')`;
  // Created through another school's invitation: whoever held that link chose the password.
  owner = await createAccount({ email: ownerEmail, name: "Zz Créé Ailleurs", password: OLD, emailVerified: false });
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${otherSchool}, ${owner}, 'front_desk')`;
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  await admin`DELETE FROM invitation WHERE school_id IN (${school}, ${otherSchool})`;
  await admin`DELETE FROM member WHERE school_id IN (${school}, ${otherSchool})`;
  // Sessions and accounts cascade.
  await admin`DELETE FROM "user" WHERE email IN (${directorEmail}, ${ownerEmail}, ${stableEmail})`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("keepSessionIfPasswordUnchanged", () => {
  it("keeps the session when the password did not change", async () => {
    const user = await createAccount({ email: stableEmail, name: "Zz Stable", password: OLD });
    const before = await credentialBefore(stableEmail.toUpperCase());
    expect(before?.userId).toBe(user);
    const token = await sessionOf(user);
    expect(await keepSessionIfPasswordUnchanged(token, user, before)).toBe(true);
    expect(await sessionExists(token)).toBe(true);
  });

  it("an unknown address has nothing to compare: the session is not kept", async () => {
    expect(await credentialBefore(`zz-inconnue-${suffix}@exemple.test`)).toBeNull();
    const user = (await credentialBefore(stableEmail))?.userId ?? "";
    const token = await sessionOf(user);
    expect(await keepSessionIfPasswordUnchanged(token, user, null)).toBe(false);
    expect(await sessionExists(token)).toBe(false);
  });

  it("a hash read for another account, or an account without password, keeps nothing", async () => {
    const before = await credentialBefore(stableEmail);
    if (!before) throw new Error("compte introuvable");
    const elsewhere = await sessionOf(director);
    expect(await keepSessionIfPasswordUnchanged(elsewhere, director, before)).toBe(false);
    expect(await sessionExists(elsewhere)).toBe(false);
    const token = await sessionOf(before.userId);
    expect(await keepSessionIfPasswordUnchanged(token, before.userId, { ...before, passwordHash: null })).toBe(false);
    expect(await sessionExists(token)).toBe(false);
  });

  it("a session written with the old password while the account is taken back no longer works", async () => {
    // The sign-in reads the hash, then checks the password: the old one, still valid.
    const before = await credentialBefore(ownerEmail);
    const r = await withSchool(school, (tx) =>
      invite(tx, director, { email: ownerEmail, name: "Zz Propriétaire", role: "front_desk" }, new Date()),
    );
    if (!r.ok) throw new Error(r.message);
    const link = await withSchool(school, (tx) => readRelationship(tx, r.token, new Date()));
    if (!link) throw new Error("lien introuvable");
    const ctx = await auth.$context;
    const passwordHash = await ctx.password.hash(NEW);

    // The take-back: new password, sessions closed, held open until `commit()`.
    let closed!: () => void;
    const sessionsClosed = new Promise<void>((resolve) => (closed = resolve));
    let commit!: () => void;
    const committing = new Promise<void>((resolve) => (commit = resolve));
    const takeBack = withSchool(school, async (tx) => {
      const used = await consumeLink(tx, link, owner, undefined, { passwordHash, verifiedEmail: true });
      closed();
      await committing;
      return used;
    });
    await sessionsClosed;
    // Better Auth writes the session after the take-back closed the sessions: it waits on the
    // account row (foreign key), then lands once the take-back has committed.
    const writing = sessionOf(owner);
    commit();
    expect(await takeBack).toBe("ok");
    const token = await writing;
    expect(await sessionExists(token)).toBe(true); // without the guard, it would stay open

    expect(await keepSessionIfPasswordUnchanged(token, owner, before)).toBe(false);
    expect(await sessionExists(token)).toBe(false);
    // The new password signs in, the old one no longer does.
    await expect(auth.api.signInEmail({ body: { email: ownerEmail, password: OLD } })).rejects.toThrow();
    const signedIn = await auth.api.signInEmail({ body: { email: ownerEmail, password: NEW } });
    expect(await keepSessionIfPasswordUnchanged(signedIn.token, owner, await credentialBefore(ownerEmail))).toBe(true);
  });

  it("waits for a take-back under way before comparing", async () => {
    const before = await credentialBefore(ownerEmail);
    const token = await sessionOf(owner);
    const ctx = await auth.$context;
    const passwordHash = await ctx.password.hash(`${NEW} encore`);
    // A password change holding the account row (as `consumeLink` does), not yet committed.
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    let commit!: () => void;
    const committing = new Promise<void>((resolve) => (commit = resolve));
    const change = admin.begin(async (t) => {
      await t`SELECT id FROM "user" WHERE id = ${owner} FOR UPDATE`;
      await t`UPDATE account SET password = ${passwordHash} WHERE user_id = ${owner} AND provider_id = 'credential'`;
      locked();
      await committing;
    });
    await holding;
    let settled = false;
    const guard = keepSessionIfPasswordUnchanged(token, owner, before).finally(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(settled).toBe(false);
    commit();
    await change;
    expect(await guard).toBe(false);
    expect(await sessionExists(token)).toBe(false);
  });
});
