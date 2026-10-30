import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { purgeOldSubmissions, SUBMISSION_RETENTION_DAYS } from "./submissions";

/**
 * Purge of old idempotency keys (#262), run as the application runs it
 * (app_user, RLS, one school at a time). Fictitious schools deleted at the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const ids = {} as Record<string, string>;
const HASH = "0".repeat(64);

/** Inserts a key created `daysAgo` days (plus `extraHours`) before now, as the owner. */
async function keyFrom(schoolId: string, daysAgo: number, extraHours = 0) {
  const key = randomUUID();
  await admin`INSERT INTO submission (school_id, key, kind, request_hash, created_at)
    VALUES (${schoolId}, ${key}, 'payment', ${HASH},
            now() - make_interval(days => ${daysAgo}, hours => ${extraHours}))`;
  return key;
}

const keysOf = async (schoolId: string) =>
  (await admin`SELECT key FROM submission WHERE school_id = ${schoolId}`).map((r) => r.key as string).sort();

beforeAll(async () => {
  [{ id: ids.school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École A', ${`purge-a-${suffix}`}) RETURNING id`;
  [{ id: ids.otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École B', ${`purge-b-${suffix}`}) RETURNING id`;
});

afterAll(async () => {
  const schools = [ids.school, ids.otherSchool];
  await admin`DELETE FROM submission WHERE school_id IN ${admin(schools)}`;
  await admin`DELETE FROM school WHERE id IN ${admin(schools)}`;
  await admin.end();
});

describe("purgeOldSubmissions", () => {
  // Tripwire: changing the retention is a decision (#262), not a side effect.
  it("keeps a week of keys", () => {
    expect(SUBMISSION_RETENTION_DAYS).toBe(7);
  });

  it("deletes the school's keys older than the retention and keeps the recent ones", async () => {
    const fresh = await keyFrom(ids.school, 0);
    const sixDays = await keyFrom(ids.school, 6);
    const justInside = await keyFrom(ids.school, SUBMISSION_RETENTION_DAYS - 1, 23);
    const justOutside = await keyFrom(ids.school, SUBMISSION_RETENTION_DAYS, 1);
    const old = await keyFrom(ids.school, 30);
    const otherOld = await keyFrom(ids.otherSchool, 30);

    const deleted = await withSchool(ids.school, (tx) => purgeOldSubmissions(tx));

    expect(deleted).toBe(2);
    expect(await keysOf(ids.school)).toEqual([fresh, sixDays, justInside].sort());
    expect(await keysOf(ids.school)).not.toContain(justOutside);
    expect(await keysOf(ids.school)).not.toContain(old);
    // Another school's keys are out of reach: RLS restricts the purge to the current school.
    expect(await keysOf(ids.otherSchool)).toEqual([otherOld]);

    expect(await withSchool(ids.otherSchool, (tx) => purgeOldSubmissions(tx))).toBe(1);
    expect(await keysOf(ids.otherSchool)).toEqual([]);
  });

  it("deletes nothing without a school in the session", async () => {
    const old = await keyFrom(ids.school, 30);
    // An empty school id: the RLS policy sees no row, so nothing can be deleted.
    const deleted = await withSchool("", (tx) => purgeOldSubmissions(tx));
    expect(deleted).toBe(0);
    expect(await keysOf(ids.school)).toContain(old);
  });

  it("has an index on (school_id, created_at) for the purge", async () => {
    const [index] = await admin`SELECT indexdef FROM pg_indexes
      WHERE tablename = 'submission' AND indexdef LIKE '%(school_id, created_at)%'`;
    expect(index).toBeDefined();
  });
});
