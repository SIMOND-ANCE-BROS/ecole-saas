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
    await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${diana}, 'direction') RETURNING id`;
  // An account already a member of another school.
  teacher = await createAccount({ email: teacherEmail, name: "Prof Ailleurs", password: PASSWORD });
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${otherSchool}, ${teacher}, 'direction')`;
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

const saisie = (
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

  it("invite : le lien s'ouvre, une seule invitation par e-mail, jeton jamais stocké en clair", async () => {
    const r1 = await withSchool(school, (tx) =>
      invite(tx, diana, { email: newMemberEmail, name: "Accueil", role: "accueil" }, new Date()),
    );
    const r2 = await withSchool(school, (tx) =>
      invite(tx, diana, { email: newMemberEmail.toUpperCase(), name: "Accueil", role: "accueil" }, new Date()),
    );
    if (!r1.ok || !r2.ok) throw new Error("invitation refusée");
    token = r2.token;
    expect(await openLink(school, r1.token)).toBeNull(); // replaced by the second one
    expect(await openLink(school, token)).toMatchObject({
      type: "invitation",
      email: newMemberEmail,
      role: "accueil",
      school: "École A",
      existingAccount: false,
    });
    expect(await openLink(otherSchool, token)).toBeNull();
    // The invited name is kept (it was silently dropped once by a stale payload key).
    expect(await withSchool(school, (tx) => pendingInvitations(tx, new Date()))).toMatchObject([
      { email: newMemberEmail, name: "Accueil" },
    ]);
    const [{ token_hash: jeton_hash }] = await admin`SELECT token_hash FROM invitation WHERE id = ${r2.id}`;
    expect(jeton_hash).not.toContain(token);
    expect(await withSchool(school, (tx) => pendingInvitations(tx, new Date()))).toHaveLength(1);
  });

  it("refuse un mot de passe trop court, puis crée le compte ; le lien ne sert qu'une fois", async () => {
    expect(await acceptLink(school, token, saisie("court"))).toMatchObject({ ok: false });
    expect(await acceptLink(school, token, saisie(PASSWORD))).toEqual({
      ok: true,
      type: "invitation",
      email: newMemberEmail,
    });
    expect(await acceptLink(school, token, saisie(PASSWORD))).toMatchObject({ ok: false });
    await expect(connect(newMemberEmail, PASSWORD)).resolves.toBeTruthy();
    expect(await member(newMemberEmail)).toMatchObject({ role: "accueil", active: true, name: "Accueil Nouvelle" });
  });

  it("un compte existant confirme son mot de passe actuel pour rejoindre l'école", async () => {
    const r = await withSchool(school, (tx) =>
      invite(tx, diana, { email: teacherEmail, name: "Prof", role: "direction" }, new Date()),
    );
    if (!r.ok) throw new Error(r.message);
    expect(await openLink(school, r.token)).toMatchObject({ existingAccount: true });
    expect(await acceptLink(school, r.token, saisie("", { currentPassword: "pas le bon" }))).toEqual({
      ok: false,
      message: "Mot de passe actuel incorrect.",
    });
    expect((await acceptLink(school, r.token, saisie("", { currentPassword: PASSWORD }))).ok).toBe(true);
    expect(await member(teacherEmail)).toMatchObject({ role: "direction", active: true });
  });

  it("refuse d'inviter une personne déjà dans l'équipe ; une invitation révoquée ou expirée ne s'ouvre plus", async () => {
    expect(
      await withSchool(school, (tx) =>
        invite(tx, diana, { email: emailDiana, name: "Diana", role: "accueil" }, new Date()),
      ),
    ).toEqual({
      ok: false,
      message: "Cette personne fait déjà partie de l’équipe.",
    });
    const r = await withSchool(school, (tx) =>
      invite(tx, diana, { email: `x-${suffix}@exemple.test`, name: "X", role: "accueil" }, new Date()),
    );
    if (!r.ok) throw new Error(r.message);
    expect((await withSchool(school, (tx) => revokeInvitation(tx, r.id))).ok).toBe(true);
    expect(await openLink(school, r.token)).toBeNull();
    const old = await withSchool(school, (tx) =>
      invite(tx, diana, { email: `y-${suffix}@exemple.test`, name: "Y", role: "accueil" }, new Date("2020-01-01")),
    );
    if (!old.ok) throw new Error(old.message);
    expect(await openLink(school, old.token)).toBeNull();
  });
});

describe("rôles et accès", () => {
  it("change l'accès d'un autre membre, refuse de toucher à son propre accès, trace dans le journal", async () => {
    const accueil = await member(newMemberEmail);
    expect(
      (await withSchool(school, (tx) => updateMember(tx, diana, accueil.id, { role: "accueil", active: false }))).ok,
    ).toBe(true);
    expect(
      (await withSchool(school, (tx) => updateMember(tx, diana, dianaMember, { role: "accueil", active: true }))).ok,
    ).toBe(false);
    const [t] =
      await admin`SELECT before->>'active' AS before, after->>'active' AS after FROM audit_log WHERE row_id = ${accueil.id}`;
    expect(t).toEqual({ before: "true", after: "false" });
  });

  it("seule la direction gère l'équipe, même sans passer par la page", async () => {
    const p = await member(teacherEmail);
    // Diana moves the teacher to the front desk: she stays in management, that is allowed.
    expect(
      (await withSchool(school, (tx) => updateMember(tx, diana, p.id, { role: "accueil", active: true }))).ok,
    ).toBe(true);
    // At the front desk, they can no longer touch the team nor invite.
    expect(
      await withSchool(school, (tx) => updateMember(tx, teacher, dianaMember, { role: "accueil", active: true })),
    ).toEqual({ ok: false, message: "Accès refusé." });
    expect(
      await withSchool(school, (tx) =>
        invite(tx, teacher, { email: `z-${suffix}@exemple.test`, name: "Z", role: "direction" }, new Date()),
      ),
    ).toEqual({
      ok: false,
      message: "Accès refusé.",
    });
    expect(
      (await withSchool(school, (tx) => updateMember(tx, diana, p.id, { role: "direction", active: true }))).ok,
    ).toBe(true);
  });
});

describe("réinitialisation du mot de passe", () => {
  it("refusée pour un compte qui sert aussi dans une autre école", async () => {
    const p = await member(teacherEmail);
    expect(await createResetLink(school, diana, p.id)).toEqual({
      ok: false,
      message: "Ce compte sert aussi dans une autre école : la personne doit changer elle-même son mot de passe.",
    });
  });

  it("le lien remplace le mot de passe et ferme les sessions ouvertes", async () => {
    const n = await member(newMemberEmail);
    await connect(newMemberEmail, PASSWORD);
    const [{ n: before }] = await admin`SELECT count(*)::int AS n FROM session WHERE user_id = ${n.userId}`;
    expect(before).toBeGreaterThan(0);
    const r = await createResetLink(school, diana, n.id);
    if (!r.ok) throw new Error(r.message);
    expect(await openLink(school, r.token)).toMatchObject({ type: "reinitialisation", email: newMemberEmail });
    const next = "un tout nouveau mot de passe";
    expect(await acceptLink(school, r.token, saisie(next))).toEqual({
      ok: true,
      type: "reinitialisation",
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

  it("un lien créé puis devenu dangereux (compte ajouté, même désactivé, à une autre école) est refusé à l'usage", async () => {
    const n = await member(newMemberEmail);
    const r = await createResetLink(school, diana, n.id);
    if (!r.ok) throw new Error(r.message);
    await admin`INSERT INTO member (school_id, user_id, role, active) VALUES (${otherSchool}, ${n.userId}, 'accueil', false)`;
    expect(await acceptLink(school, r.token, saisie("encore un autre mot de passe"))).toEqual({
      ok: false,
      message: "Ce compte sert aussi dans une autre école : la personne doit changer elle-même son mot de passe.",
    });
    expect(await createResetLink(school, diana, n.id)).toMatchObject({ ok: false });
  });

  it("une autre école ne voit ni les membres ni les invitations de celle-ci", async () => {
    expect((await withSchool(otherSchool, (tx) => listMembers(tx))).some((m) => m.email === emailDiana)).toBe(false);
    expect(await withSchool(otherSchool, (tx) => pendingInvitations(tx, new Date()))).toEqual([]);
  });
});
