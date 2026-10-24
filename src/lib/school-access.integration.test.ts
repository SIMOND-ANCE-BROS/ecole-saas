import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chooseSchool, contextFromSession } from "./school-access";
import { auth } from "./auth";
import { createAccount } from "./accounts";

/**
 * Sign-in and school choice, against the real database. Fictitious data,
 * deleted at the end (Better Auth's writes cannot be rolled back in a test
 * transaction).
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const email = `accueil-${suffix}@exemple.test`;
const password = "mot-de-passe-de-test-assez-long";
let userId: string;
let schoolA: string; // active member
let schoolB: string; // no link
let schoolC: string; // deactivated member

async function createSchool(name: string) {
  const [e] = await admin`INSERT INTO school (name, slug) VALUES (${name}, ${`${name}-${suffix}`}) RETURNING id`;
  return e.id as string;
}

async function signIn() {
  const result = await auth.api.signInEmail({ body: { email, password: password } });
  const [s] = await admin`SELECT id, selected_school_id FROM session WHERE token = ${result.token}`;
  return s as { id: string; selected_school_id: string | null };
}

beforeAll(async () => {
  schoolA = await createSchool("ecole-a");
  schoolB = await createSchool("ecole-b");
  schoolC = await createSchool("ecole-c");
  userId = await createAccount({ email, name: "Accueil Test", password });
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${schoolA}, ${userId}, 'front_desk')`;
  await admin`INSERT INTO member (school_id, user_id, role, active) VALUES (${schoolC}, ${userId}, 'director', false)`;
});

afterAll(async () => {
  await admin`DELETE FROM member WHERE user_id = ${userId}`;
  await admin`DELETE FROM "user" WHERE id = ${userId}`; // sessions and accounts cascade
  await admin`DELETE FROM school WHERE id IN (${schoolA}, ${schoolB}, ${schoolC})`;
  await admin.end();
});

describe("Sign-in", () => {
  it("signs in an account created by the school", async () => {
    const session = await signIn();
    expect(session.id).toBeTruthy();
    expect(session.selected_school_id).toBeNull();
  });

  it("rejects a wrong password", async () => {
    await expect(auth.api.signInEmail({ body: { email, password: "pas-le-bon-mot-de-passe" } })).rejects.toThrow();
  });

  it("rejects open sign-up", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: `libre-${suffix}@exemple.test`, password: password, name: "Libre" },
      }),
    ).rejects.toThrow();
  });
});

describe("School choice", () => {
  it("stores on the session a school the user is an active member of", async () => {
    const session = await signIn();
    expect(await chooseSchool(session.id, userId, schoolA)).toBe(true);
    const [after] = await admin`SELECT selected_school_id FROM session WHERE id = ${session.id}`;
    expect(after.selected_school_id).toBe(schoolA);
    expect(await contextFromSession(userId, schoolA)).toEqual({ userId, schoolId: schoolA, role: "front_desk" });
  });

  it("rejects a school the user is not a member of", async () => {
    const session = await signIn();
    expect(await chooseSchool(session.id, userId, schoolB)).toBe(false);
    const [after] = await admin`SELECT selected_school_id FROM session WHERE id = ${session.id}`;
    expect(after.selected_school_id).toBeNull();
    expect(await contextFromSession(userId, schoolB)).toBeNull();
  });

  it("rejects a school where access was deactivated", async () => {
    const session = await signIn();
    expect(await chooseSchool(session.id, userId, schoolC)).toBe(false);
    expect(await contextFromSession(userId, schoolC)).toBeNull();
  });

  it("rejects another account's session and a malformed id", async () => {
    const session = await signIn();
    expect(await chooseSchool(session.id, "autre-compte", schoolA)).toBe(false);
    expect(await chooseSchool(session.id, userId, "pas-un-uuid")).toBe(false);
    expect(await contextFromSession(userId, null)).toBeNull();
  });
});
