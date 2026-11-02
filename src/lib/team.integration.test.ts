import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "../db";
import {
  consumeLink,
  readRelationship,
  invite,
  pendingInvitations,
  listMembers,
  updateMember,
  revokeInvitation,
} from "../db/team";
import { auth } from "./auth";
import { createAccount } from "./accounts";
import type { EmailMessage, EmailSender } from "../connectors/email/sender";
import { EMAIL_PROOF_ADDRESS_DAILY_MAX } from "../domain/team/email-proof";
import { acceptEmailProof, acceptLink, createResetLink, openEmailProof, openLink, sendEmailProof } from "./invitations";

/**
 * A school's team (#104): invitations, roles, reset, against the real
 * database and Better Auth. Fictitious data deleted at the end (the audit
 * log, immutable, is cleaned by disabling its trigger for the duration of
 * an administration transaction).
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const PASSWORD = "une phrase de passe de test";
const emailDiana = `diana-${suffix}@exemple.test`;
const newMemberEmail = `accueil-${suffix}@exemple.test`;
const teacherEmail = `prof-${suffix}@exemple.test`;
const ownerEmail = `zz-proprietaire-${suffix}@exemple.test`;
const verifiedEmail = `zz-verifiee-${suffix}@exemple.test`;
const freshEmail = `zz-nouvelle-${suffix}@exemple.test`;
const floodEmail = `zz-inondee-${suffix}@exemple.test`;
const crowdEmail = `zz-sollicitee-${suffix}@exemple.test`;
/** Prefix of an address's e-mail proofs in `verification` (hash only, as `src/db/team.ts`). */
const proofKey = (email: string) => `email-proof:${createHash("sha256").update(email).digest("hex")}`;
let school: string;
let otherSchool: string;
let diana: string;
let teacher: string;
let dianaMember: string;

const connect = (email: string, password: string) => auth.api.signInEmail({ body: { email, password: password } });
const member = async (email: string) =>
  (await withSchool(school, (tx) => listMembers(tx))).find((m) => m.email === email)!;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ea-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`eb-${suffix}`}) RETURNING id`;
  diana = await createAccount({ email: emailDiana, name: "Diana Test", password: PASSWORD });
  [{ id: dianaMember }] =
    await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${diana}, 'director') RETURNING id`;
  // An account already a member of another school.
  teacher = await createAccount({ email: teacherEmail, name: "Prof Ailleurs", password: PASSWORD });
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${otherSchool}, ${teacher}, 'director')`;
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  await admin`DELETE FROM invitation WHERE school_id IN (${school}, ${otherSchool})`;
  await admin`DELETE FROM member WHERE school_id IN (${school}, ${otherSchool})`;
  await admin`DELETE FROM verification WHERE identifier LIKE ${`${proofKey(ownerEmail)}:%`} OR identifier LIKE ${`${proofKey(floodEmail)}:%`} OR identifier LIKE ${`${proofKey(crowdEmail)}:%`}`;
  // Sessions and accounts cascade.
  await admin`DELETE FROM "user" WHERE email IN (${emailDiana}, ${teacherEmail}, ${newMemberEmail}, ${ownerEmail}, ${verifiedEmail}, ${floodEmail}, ${crowdEmail})`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const entry = (
  password: string,
  extra: Partial<{ name: string; confirmation: string; currentPassword: string }> = {},
) => ({
  name: "Accueil Nouvelle",
  password: password,
  confirmation: password,
  currentPassword: "",
  ...extra,
});

describe("invitation", () => {
  let token: string;

  it("invite: the link opens, one invitation per e-mail, token never stored in clear", async () => {
    const r1 = await withSchool(school, (tx) =>
      invite(tx, diana, { email: newMemberEmail, name: "Accueil", role: "front_desk" }, new Date()),
    );
    const r2 = await withSchool(school, (tx) =>
      invite(tx, diana, { email: newMemberEmail.toUpperCase(), name: "Accueil", role: "front_desk" }, new Date()),
    );
    if (!r1.ok || !r2.ok) throw new Error("invitation refusée");
    token = r2.token;
    expect(await openLink(school, r1.token)).toBeNull(); // replaced by the second one
    expect(await openLink(school, token)).toMatchObject({
      type: "invitation",
      email: newMemberEmail,
      role: "front_desk",
      school: "École A",
      existingAccount: false,
    });
    expect(await openLink(otherSchool, token)).toBeNull();
    // The invited name is kept (it was silently dropped once by a stale payload key).
    expect(await withSchool(school, (tx) => pendingInvitations(tx, new Date()))).toMatchObject([
      { email: newMemberEmail, name: "Accueil" },
    ]);
    const [{ token_hash: tokenHash }] = await admin`SELECT token_hash FROM invitation WHERE id = ${r2.id}`;
    expect(tokenHash).not.toContain(token);
    expect(await withSchool(school, (tx) => pendingInvitations(tx, new Date()))).toHaveLength(1);
  });

  it("rejects a too-short password, then creates the account; the link works only once", async () => {
    expect(await acceptLink(school, token, entry("court"))).toMatchObject({ ok: false });
    expect(await acceptLink(school, token, entry(PASSWORD))).toEqual({
      ok: true,
      type: "invitation",
      email: newMemberEmail,
    });
    expect(await acceptLink(school, token, entry(PASSWORD))).toMatchObject({ ok: false });
    await expect(connect(newMemberEmail, PASSWORD)).resolves.toBeTruthy();
    expect(await member(newMemberEmail)).toMatchObject({ role: "front_desk", active: true, name: "Accueil Nouvelle" });
  });

  it("an existing account confirms its current password to join the school", async () => {
    const r = await withSchool(school, (tx) =>
      invite(tx, diana, { email: teacherEmail, name: "Prof", role: "director" }, new Date()),
    );
    if (!r.ok) throw new Error(r.message);
    expect(await openLink(school, r.token)).toMatchObject({ existingAccount: true });
    expect(await acceptLink(school, r.token, entry("", { currentPassword: "pas le bon" }))).toEqual({
      ok: false,
      message: "Mot de passe actuel incorrect.",
    });
    expect((await acceptLink(school, r.token, entry("", { currentPassword: PASSWORD }))).ok).toBe(true);
    expect(await member(teacherEmail)).toMatchObject({ role: "director", active: true });
  });

  it("refuses to invite someone already on the team; a revoked or expired invitation no longer opens", async () => {
    expect(
      await withSchool(school, (tx) =>
        invite(tx, diana, { email: emailDiana, name: "Diana", role: "front_desk" }, new Date()),
      ),
    ).toEqual({
      ok: false,
      message: "Cette personne fait déjà partie de l’équipe.",
    });
    const r = await withSchool(school, (tx) =>
      invite(tx, diana, { email: `x-${suffix}@exemple.test`, name: "X", role: "front_desk" }, new Date()),
    );
    if (!r.ok) throw new Error(r.message);
    expect((await withSchool(school, (tx) => revokeInvitation(tx, diana, r.id))).ok).toBe(true);
    expect(await openLink(school, r.token)).toBeNull();
    const old = await withSchool(school, (tx) =>
      invite(tx, diana, { email: `y-${suffix}@exemple.test`, name: "Y", role: "front_desk" }, new Date("2020-01-01")),
    );
    if (!old.ok) throw new Error(old.message);
    expect(await openLink(school, old.token)).toBeNull();
  });
});

describe("audit log of links (#178)", () => {
  const entries = (id: string) =>
    admin`SELECT action, actor, before, after FROM audit_log WHERE target_table = 'invitation' AND row_id = ${id} ORDER BY id`;

  it("records the creation, the replacement and the revocation of an invitation, without token or hash", async () => {
    const email = `journal-${suffix}@exemple.test`;
    const first = await withSchool(school, (tx) =>
      invite(tx, diana, { email, name: "Journal", role: "front_desk" }, new Date("2026-10-01T10:00:00Z")),
    );
    const second = await withSchool(school, (tx) =>
      invite(tx, diana, { email, name: "Journal", role: "director" }, new Date("2026-10-01T10:00:00Z")),
    );
    if (!first.ok || !second.ok) throw new Error("invitation refusée");
    expect(await entries(first.id)).toEqual([
      {
        action: "insert",
        actor: dianaMember,
        before: null,
        after: {
          type: "invitation",
          email,
          role: "front_desk",
          userId: null,
          createdBy: dianaMember,
          expiresAt: "2026-10-08T10:00:00.000Z",
        },
      },
      { action: "delete", actor: dianaMember, before: expect.objectContaining({ role: "front_desk" }), after: null },
    ]);
    expect((await withSchool(school, (tx) => revokeInvitation(tx, diana, second.id))).ok).toBe(true);
    expect((await entries(second.id)).map((e) => e.action)).toEqual(["insert", "delete"]);
    const [{ tokenHash }] =
      await admin`SELECT encode(sha256(convert_to(${second.token}, 'UTF8')), 'hex') AS "tokenHash"`;
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM audit_log
      WHERE school_id = ${school} AND (strpos(concat(before, after), ${second.token}) > 0 OR strpos(concat(before, after), ${tokenHash}) > 0)`;
    expect(n).toBe(0);
  });

  it("refuses a revocation by someone outside management, without deleting anything", async () => {
    const r = await withSchool(school, (tx) =>
      invite(tx, diana, { email: `garde-${suffix}@exemple.test`, name: "Garde", role: "front_desk" }, new Date()),
    );
    if (!r.ok) throw new Error(r.message);
    const frontDesk = await member(newMemberEmail);
    expect(await withSchool(school, (tx) => revokeInvitation(tx, frontDesk.userId, r.id))).toEqual({
      ok: false,
      message: "Accès refusé.",
    });
    expect(await openLink(school, r.token)).not.toBeNull();
    expect((await withSchool(school, (tx) => revokeInvitation(tx, diana, r.id))).ok).toBe(true);
  });
});

describe("roles and access", () => {
  it("changes another member's access, refuses to touch one's own access, records it in the audit log", async () => {
    const frontDesk = await member(newMemberEmail);
    expect(
      (await withSchool(school, (tx) => updateMember(tx, diana, frontDesk.id, { role: "front_desk", active: false })))
        .ok,
    ).toBe(true);
    expect(
      (await withSchool(school, (tx) => updateMember(tx, diana, dianaMember, { role: "front_desk", active: true }))).ok,
    ).toBe(false);
    const [t] =
      await admin`SELECT before->>'active' AS before, after->>'active' AS after FROM audit_log WHERE row_id = ${frontDesk.id}`;
    expect(t).toEqual({ before: "true", after: "false" });
  });

  it("only directors manage the team, even bypassing the page", async () => {
    const p = await member(teacherEmail);
    // Diana moves the teacher to the front desk: she stays in management, that is allowed.
    expect(
      (await withSchool(school, (tx) => updateMember(tx, diana, p.id, { role: "front_desk", active: true }))).ok,
    ).toBe(true);
    // At the front desk, they can no longer touch the team nor invite.
    expect(
      await withSchool(school, (tx) => updateMember(tx, teacher, dianaMember, { role: "front_desk", active: true })),
    ).toEqual({ ok: false, message: "Accès refusé." });
    expect(
      await withSchool(school, (tx) =>
        invite(tx, teacher, { email: `z-${suffix}@exemple.test`, name: "Z", role: "director" }, new Date()),
      ),
    ).toEqual({
      ok: false,
      message: "Accès refusé.",
    });
    expect(
      (await withSchool(school, (tx) => updateMember(tx, diana, p.id, { role: "director", active: true }))).ok,
    ).toBe(true);
  });
});

describe("links of a director who leaves management", () => {
  const token = (r: { ok: boolean; token?: string }) => (r.ok && r.token ? r.token : "");

  it("deactivating a director removes their unused links, which no longer open", async () => {
    const p = await member(teacherEmail);
    const link = token(
      await withSchool(school, (tx) =>
        invite(
          tx,
          teacher,
          { email: `porte-${suffix}@exemple.test`, name: "Porte Arrière", role: "director" },
          new Date(),
        ),
      ),
    );
    expect(await openLink(school, link)).not.toBeNull();
    expect(
      (await withSchool(school, (tx) => updateMember(tx, diana, p.id, { role: "director", active: false }))).ok,
    ).toBe(true);
    expect(await openLink(school, link)).toBeNull();
    // The dropped link is logged, by the director who made the change, with its author.
    const [dropped] = await admin`SELECT actor, before FROM audit_log
      WHERE target_table = 'invitation' AND action = 'delete' AND before->>'email' = ${`porte-${suffix}@exemple.test`}`;
    expect(dropped).toMatchObject({ actor: dianaMember, before: { createdBy: p.id } });
    // No reset link for a deactivated member.
    expect(await createResetLink(school, diana, p.id)).toMatchObject({ ok: false });
    expect((await withSchool(school, (tx) => pendingInvitations(tx, new Date()))).map((i) => i.name)).not.toContain(
      "Porte Arrière",
    );
    expect(
      (await withSchool(school, (tx) => updateMember(tx, diana, p.id, { role: "director", active: true }))).ok,
    ).toBe(true);
  });

  it("a link stops working as soon as its author is no longer an active director, even outside updateMember", async () => {
    const p = await member(teacherEmail);
    const link = token(
      await withSchool(school, (tx) =>
        invite(
          tx,
          teacher,
          { email: `porte2-${suffix}@exemple.test`, name: "Porte Deux", role: "front_desk" },
          new Date(),
        ),
      ),
    );
    await admin`UPDATE member SET role = 'front_desk' WHERE id = ${p.id}`;
    expect(await openLink(school, link)).toBeNull();
    expect(await acceptLink(school, link, entry(PASSWORD))).toMatchObject({ ok: false });
    await admin`UPDATE member SET role = 'director' WHERE id = ${p.id}`;
    // Back in management: the link opens again (it was never deleted, only refused).
    expect(await openLink(school, link)).not.toBeNull();
    await withSchool(school, async (tx) => {
      const i = (await pendingInvitations(tx, new Date())).find((x) => x.name === "Porte Deux");
      if (i) await revokeInvitation(tx, diana, i.id);
    });
  });
});

describe("password reset", () => {
  // A reset link is only for an active member: the front desk deactivated above comes back first.
  beforeAll(async () => {
    const n = await member(newMemberEmail);
    const r = await withSchool(school, (tx) => updateMember(tx, diana, n.id, { role: "front_desk", active: true }));
    if (!r.ok) throw new Error(r.message);
  });

  it("refused for an account also used in another school", async () => {
    const p = await member(teacherEmail);
    expect(await createResetLink(school, diana, p.id)).toEqual({
      ok: false,
      message: "Ce compte sert aussi dans une autre école : la personne doit changer elle-même son mot de passe.",
    });
  });

  it("the link replaces the password and closes open sessions", async () => {
    const n = await member(newMemberEmail);
    await connect(newMemberEmail, PASSWORD);
    const [{ n: before }] = await admin`SELECT count(*)::int AS n FROM session WHERE user_id = ${n.userId}`;
    expect(before).toBeGreaterThan(0);
    const r = await createResetLink(school, diana, n.id);
    if (!r.ok) throw new Error(r.message);
    expect(await openLink(school, r.token)).toMatchObject({ type: "reset", email: newMemberEmail });
    const [logged] =
      await admin`SELECT actor, after FROM audit_log WHERE target_table = 'invitation' AND row_id = ${r.id} AND action = 'insert'`;
    expect(logged).toMatchObject({
      actor: dianaMember,
      after: { type: "reset", userId: n.userId },
    });
    expect(logged.after).not.toHaveProperty("email");
    const next = "un tout nouveau mot de passe";
    expect(await acceptLink(school, r.token, entry(next))).toEqual({
      ok: true,
      type: "reset",
      email: newMemberEmail,
    });
    const [{ n: after }] = await admin`SELECT count(*)::int AS n FROM session WHERE user_id = ${n.userId}`;
    expect(after).toBe(0);
    await expect(connect(newMemberEmail, PASSWORD)).rejects.toThrow();
    await expect(connect(newMemberEmail, next)).resolves.toBeTruthy();
    // Account created through a link passed on by hand: e-mail not verified (#105).
    const [{ email_verified }] = await admin`SELECT email_verified FROM "user" WHERE id = ${n.userId}`;
    expect(email_verified).toBe(false);
  });

  it("a link that became unsafe after creation (account added to another school, even deactivated) is refused on use", async () => {
    const n = await member(newMemberEmail);
    const r = await createResetLink(school, diana, n.id);
    if (!r.ok) throw new Error(r.message);
    await admin`INSERT INTO member (school_id, user_id, role, active) VALUES (${otherSchool}, ${n.userId}, 'front_desk', false)`;
    expect(await acceptLink(school, r.token, entry("encore un autre mot de passe"))).toEqual({
      ok: false,
      message: "Ce compte sert aussi dans une autre école : la personne doit changer elle-même son mot de passe.",
    });
    expect(await createResetLink(school, diana, n.id)).toMatchObject({ ok: false });
  });

  it("another school sees neither the members nor the invitations of this one", async () => {
    expect((await withSchool(otherSchool, (tx) => listMembers(tx))).some((m) => m.email === emailDiana)).toBe(false);
    expect(await withSchool(otherSchool, (tx) => pendingInvitations(tx, new Date()))).toEqual([]);
  });
});

describe("proof of e-mail ownership for an invitation (#179)", () => {
  const outbox: EmailMessage[] = [];
  const sender: EmailSender = {
    async send(m) {
      outbox.push(m);
      return { ok: true };
    },
  };
  const OLD = "le mot de passe choisi par un autre";
  const NEW = "le mot de passe de la propriétaire";
  let owner: string;
  let token: string;

  const invitationOf = async (email: string) => {
    const r = await withSchool(school, (tx) =>
      invite(tx, diana, { email, name: "Zz Propriétaire", role: "front_desk" }, new Date()),
    );
    if (!r.ok) throw new Error(r.message);
    return r;
  };
  const codeOf = (m: EmailMessage) => {
    const code = /\/verification\/([A-Za-z0-9_-]{43})$/m.exec(m.text)?.[1];
    if (!code) throw new Error("pas de lien dans l’e-mail");
    return code;
  };

  beforeAll(async () => {
    // Created through an invitation of another school: whoever held that link chose the password.
    owner = await createAccount({ email: ownerEmail, name: "Zz Créé Ailleurs", password: OLD, emailVerified: false });
    await admin`INSERT INTO member (school_id, user_id, role) VALUES (${otherSchool}, ${owner}, 'front_desk')`;
    await createAccount({ email: verifiedEmail, name: "Zz Vérifiée", password: PASSWORD });
    ({ token } = await invitationOf(ownerEmail));
  });

  it("an unverified account proves its e-mail once e-mail can be sent; its password is no longer enough", async () => {
    expect(await openLink(school, token, sender)).toMatchObject({ existingAccount: true, proof: "email" });
    expect(await acceptLink(school, token, entry("", { currentPassword: OLD }), sender)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Confirmez d’abord votre adresse e-mail/),
    });
    expect(await member(ownerEmail)).toBeUndefined();
  });

  it("without an e-mail service, nothing changes: the password is asked (#105)", async () => {
    expect(await openLink(school, token, null)).toMatchObject({ proof: "password" });
    expect(await sendEmailProof(school, token, null)).toMatchObject({ ok: false });
  });

  it("a verified account and a new e-mail keep their proof, and get no e-mail", async () => {
    const verified = await invitationOf(verifiedEmail);
    expect(await openLink(school, verified.token, sender)).toMatchObject({ proof: "password" });
    expect(await sendEmailProof(school, verified.token, sender)).toMatchObject({ ok: false });
    const fresh = await invitationOf(freshEmail);
    expect(await openLink(school, fresh.token, sender)).toMatchObject({ existingAccount: false, proof: "create" });
    expect(await sendEmailProof(school, fresh.token, sender)).toMatchObject({ ok: false });
    expect(outbox).toHaveLength(0);
  });

  it("e-mails the invited address only, spaced out, keeping only the code's hash", async () => {
    expect(await sendEmailProof(school, token, sender)).toEqual({ ok: true });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      to: ownerEmail,
      subject: "Confirmez votre adresse e-mail pour rejoindre École A",
    });
    expect(outbox[0].text).toContain(`/invitation/${school}/${token}/verification/`);
    const code = codeOf(outbox[0]);
    const [row] =
      await admin`SELECT email_code_hash FROM invitation WHERE school_id = ${school} AND email_code_hash IS NOT NULL`;
    expect(row.email_code_hash).not.toContain(code);
    expect(await sendEmailProof(school, token, sender)).toMatchObject({
      ok: false,
      tooSoon: true,
      message: expect.stringMatching(/réessayez dans 2 minutes\.$/),
    });
    expect(outbox).toHaveLength(1);
  });

  it("spaces the e-mails per address: re-inviting does not reset the count, at most five a day", async () => {
    await createAccount({ email: floodEmail, name: "Zz Inondée", password: OLD, emailVerified: false });
    const t0 = Date.now();
    const at = (min: number) => new Date(t0 + min * 60_000);
    const first = await invitationOf(floodEmail);
    expect(await sendEmailProof(school, first.token, sender, at(0))).toEqual({ ok: true });
    // A new invitation of the same address: a fresh row, but the address waits all the same.
    const again = await invitationOf(floodEmail);
    expect(await sendEmailProof(school, again.token, sender, at(1))).toMatchObject({ ok: false, tooSoon: true });
    for (const min of [3, 6, 9, 12])
      expect(await sendEmailProof(school, again.token, sender, at(min))).toEqual({ ok: true });
    expect(await sendEmailProof(school, again.token, sender, at(15))).toMatchObject({
      ok: false,
      message: expect.stringMatching(/réessayez dans 24 heures\.$/),
    });
    // The count keeps only a hash of the address.
    const rows = await admin`SELECT identifier FROM verification WHERE identifier LIKE 'email-proof:%'`;
    expect(rows.some((r) => r.identifier.includes(floodEmail))).toBe(false);
    expect(outbox.filter((m) => m.to === floodEmail)).toHaveLength(5);
    // Another school's invitation of the same address is not held back by this school's e-mails.
    const elsewhere = await withSchool(otherSchool, (tx) =>
      invite(tx, teacher, { email: floodEmail, name: "Zz Inondée", role: "front_desk" }, at(16)),
    );
    if (!elsewhere.ok) throw new Error(elsewhere.message);
    expect(await sendEmailProof(otherSchool, elsewhere.token, sender, at(16))).toEqual({ ok: true });
    outbox.splice(0, outbox.length, ...outbox.filter((m) => m.to !== floodEmail));
  });

  it("a school's first e-mail to an address goes even when other schools filled the shared ceiling", async () => {
    await createAccount({ email: crowdEmail, name: "Zz Sollicitée", password: OLD, emailVerified: false });
    // Twenty e-mails sent to this address within the day by other schools (the shared ceiling).
    for (let i = 0; i < EMAIL_PROOF_ADDRESS_DAILY_MAX; i++) {
      const otherKey = `${proofKey(crowdEmail)}:${randomUUID()}`;
      await admin`INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
        VALUES (${randomUUID()}, ${otherKey}, ${`v${i}`}, now() + interval '23 hours', now() - interval '1 hour', now())`;
    }
    const r = await withSchool(otherSchool, (tx) =>
      invite(tx, teacher, { email: crowdEmail, name: "Zz Sollicitée", role: "front_desk" }, new Date()),
    );
    if (!r.ok) throw new Error(r.message);
    expect(await sendEmailProof(otherSchool, r.token, sender)).toEqual({ ok: true });
    // Its second one, once spaced out, meets the shared ceiling.
    expect(await sendEmailProof(otherSchool, r.token, sender, new Date(Date.now() + 3 * 60_000))).toMatchObject({
      ok: false,
      tooSoon: true,
    });
    outbox.splice(0, outbox.length, ...outbox.filter((m) => m.to !== crowdEmail));
  });

  it("a failed send withdraws its code: another one may go right away", async () => {
    const failing: EmailSender = { send: async () => ({ ok: false, reason: "unavailable" }) };
    const later = new Date(Date.now() + 3 * 60_000);
    expect(await sendEmailProof(school, token, failing, later)).toEqual({
      ok: false,
      message: "L’e-mail n’a pas pu partir. Réessayez dans quelques minutes.",
    });
    // The previous code was replaced, and the failed one is gone.
    expect(await openEmailProof(school, token, codeOf(outbox[0]))).toBeNull();
    expect(await sendEmailProof(school, token, sender, later)).toEqual({ ok: true });
    expect(outbox).toHaveLength(2);
  });

  it("a wrong, foreign or expired code opens nothing", async () => {
    const code = codeOf(outbox[1]);
    expect(await openEmailProof(school, token, "x".repeat(43))).toBeNull();
    expect(await openEmailProof(school, token, "court")).toBeNull();
    expect(await openEmailProof(otherSchool, token, code)).toBeNull();
    // Sent more than an hour ago.
    await admin`UPDATE invitation SET email_code_sent_at = now() - interval '61 minutes' WHERE school_id = ${school} AND email_code_hash IS NOT NULL`;
    expect(await openEmailProof(school, token, code)).toBeNull();
    expect(await acceptEmailProof(school, token, code, { password: NEW, confirmation: NEW })).toMatchObject({
      ok: false,
    });
    // Marking the link checks the code again, in its own transaction: expired or replaced in between, nothing is used.
    const link = await withSchool(school, (tx) => readRelationship(tx, token, new Date()));
    if (!link) throw new Error("lien introuvable");
    await connect(ownerEmail, OLD);
    const credentials = { passwordHash: "pas-un-vrai-hachage", verifiedEmail: true };
    expect(await withSchool(school, (tx) => consumeLink(tx, link, owner, { code, now: new Date() }, credentials))).toBe(
      "expired",
    );
    await admin`UPDATE invitation SET email_code_sent_at = now() WHERE school_id = ${school} AND email_code_hash IS NOT NULL`;
    expect(
      await withSchool(school, (tx) =>
        consumeLink(tx, link, owner, { code: "y".repeat(43), now: new Date() }, credentials),
      ),
    ).toBe("expired");
    // Refused: nothing written, neither the link, the membership, the password, the e-mail nor the sessions.
    const [{ used_at }] = await admin`SELECT used_at FROM invitation WHERE id = ${link.id}`;
    expect(used_at).toBeNull();
    expect(await member(ownerEmail)).toBeUndefined();
    const [{ email_verified }] = await admin`SELECT email_verified FROM "user" WHERE id = ${owner}`;
    expect(email_verified).toBe(false);
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM session WHERE user_id = ${owner}`;
    expect(n).toBeGreaterThan(0);
    await expect(connect(ownerEmail, OLD)).resolves.toBeTruthy();
    await admin`UPDATE invitation SET email_code_sent_at = now() WHERE school_id = ${school} AND email_code_hash IS NOT NULL`;
    expect(await openEmailProof(school, token, code)).toMatchObject({ email: ownerEmail, school: "École A" });
  });

  it("the owner takes the account back: new password, e-mail verified, sessions closed, school joined, code used once", async () => {
    const code = codeOf(outbox[1]);
    await connect(ownerEmail, OLD); // whoever chose the password is signed in
    expect(await acceptEmailProof(school, token, code, { password: "court", confirmation: "court" })).toMatchObject({
      ok: false,
    });
    // The owner sees every school of the account, including the one whoever chose the old password
    // joined, with its role (#404).
    expect(await acceptEmailProof(school, token, code, { password: NEW, confirmation: NEW })).toEqual({
      ok: true,
      email: ownerEmail,
      schools: [
        { name: "École A", role: "front_desk" },
        { name: "École B", role: "front_desk" },
      ],
    });
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM session WHERE user_id = ${owner}`;
    expect(n).toBe(0);
    const [{ email_verified }] = await admin`SELECT email_verified FROM "user" WHERE id = ${owner}`;
    expect(email_verified).toBe(true);
    await expect(connect(ownerEmail, OLD)).rejects.toThrow();
    await expect(connect(ownerEmail, NEW)).resolves.toBeTruthy();
    expect(await member(ownerEmail)).toMatchObject({ role: "front_desk", active: true });
    expect(await openEmailProof(school, token, code)).toBeNull();
    expect(await acceptEmailProof(school, token, code, { password: NEW, confirmation: NEW })).toMatchObject({
      ok: false,
    });
  });
});
