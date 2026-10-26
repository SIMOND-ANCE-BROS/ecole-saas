import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "../db";
import { invite, pendingInvitations, listMembers, updateMember, revokeInvitation } from "../db/team";
import { auth } from "./auth";
import { createAccount } from "./accounts";
import { acceptLink, createResetLink, openLink } from "./invitations";

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
  await admin`DELETE FROM "user" WHERE email IN (${emailDiana}, ${teacherEmail}, ${newMemberEmail})`; // sessions and accounts cascade
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
    expect((await withSchool(school, (tx) => revokeInvitation(tx, r.id))).ok).toBe(true);
    expect(await openLink(school, r.token)).toBeNull();
    const old = await withSchool(school, (tx) =>
      invite(tx, diana, { email: `y-${suffix}@exemple.test`, name: "Y", role: "front_desk" }, new Date("2020-01-01")),
    );
    if (!old.ok) throw new Error(old.message);
    expect(await openLink(school, old.token)).toBeNull();
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
      if (i) await revokeInvitation(tx, i.id);
    });
  });
});

describe("password reset", () => {
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
