import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { savePreference, readPreference } from "./preferences";

/** Column layout per member (#89), as the application runs it (app_user, RLS). Fictitious data deleted at the end. */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const frontDesk = `pref-accueil-${suffix}`;
const director = `pref-direction-${suffix}`;
let school: string;
let otherSchool: string;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`pa-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`pb-${suffix}`}) RETURNING id`;
  for (const id of [frontDesk, director])
    await admin`INSERT INTO "user" (id, name, email) VALUES (${id}, 'Test', ${`${id}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${frontDesk}, 'front_desk'), (${school}, ${director}, 'director'), (${otherSchool}, ${frontDesk}, 'director')`;
});

afterAll(async () => {
  await admin`DELETE FROM list_preference WHERE school_id IN (${school}, ${otherSchool})`;
  await admin`DELETE FROM member WHERE school_id IN (${school}, ${otherSchool})`;
  await admin`DELETE FROM "user" WHERE id IN (${frontDesk}, ${director})`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("column preferences", () => {
  it("without a preference: null", async () => {
    expect(await withSchool(school, (tx) => readPreference(tx, frontDesk, "eleves"))).toBeNull();
  });

  it("saves then replaces, without touching other members, lists or schools", async () => {
    await withSchool(school, (tx) => savePreference(tx, frontDesk, "eleves", ["age", "-nom"]));
    await withSchool(school, (tx) => savePreference(tx, frontDesk, "eleves", ["nom", "age"]));
    await withSchool(school, (tx) => savePreference(tx, director, "eleves", ["telephone"]));
    await withSchool(otherSchool, (tx) => savePreference(tx, frontDesk, "eleves", ["facture"]));
    expect(await withSchool(school, (tx) => readPreference(tx, frontDesk, "eleves"))).toEqual(["nom", "age"]);
    expect(await withSchool(school, (tx) => readPreference(tx, director, "eleves"))).toEqual(["telephone"]);
    expect(await withSchool(school, (tx) => readPreference(tx, frontDesk, "contacts"))).toBeNull();
    expect(await withSchool(otherSchool, (tx) => readPreference(tx, frontDesk, "eleves"))).toEqual(["facture"]);
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM list_preference WHERE school_id = ${school}`;
    expect(n).toBe(2);
  });

  it("rejects an account that is not a member of the current school", async () => {
    expect(await withSchool(otherSchool, (tx) => savePreference(tx, director, "eleves", ["nom"]))).toBe(false);
  });
});
