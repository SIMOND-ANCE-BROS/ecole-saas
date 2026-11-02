import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { purgeExpiredEmailProofs } from "./team";

/**
 * Global cleanup of the e-mail proofs of invitations (#404): rows
 * `email-proof:<hash>:<school>` of Better Auth's `verification` table, past
 * their 24 hours, whatever the address and even if it is never e-mailed again.
 * Run as the application runs it (app_user). Fictitious rows deleted at the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const ids: string[] = [];

/** A row keyed `identifier`, expiring `hoursFromNow` hours from now (negative: already expired). */
async function row(identifier: string, hoursFromNow: number) {
  const id = randomUUID();
  ids.push(id);
  await admin`INSERT INTO verification (id, identifier, value, expires_at)
    VALUES (${id}, ${identifier}, ${"0".repeat(64)}, now() + make_interval(hours => ${hoursFromNow}))`;
  return id;
}

const remaining = async () =>
  (await admin`SELECT id FROM verification WHERE id IN ${admin(ids)}`).map((r) => r.id as string).sort();

afterAll(async () => {
  await admin`DELETE FROM verification WHERE id IN ${admin(ids)}`;
  await admin.end();
});

describe("purgeExpiredEmailProofs", () => {
  it("deletes every expired e-mail proof, of any address and school, and keeps the rest", async () => {
    const school = randomUUID();
    const expired = await row(`email-proof:${suffix}a:${school}`, -1);
    const otherAddressExpired = await row(`email-proof:${suffix}b:${randomUUID()}`, -30 * 24);
    const valid = await row(`email-proof:${suffix}a:${school}`, 23);
    // Not an e-mail proof: Better Auth's own rows are its business, even expired.
    const foreign = await row(`autre-${suffix}`, -1);

    const deleted = await purgeExpiredEmailProofs();

    expect(deleted).toBeGreaterThanOrEqual(2);
    const left = await remaining();
    expect(left).not.toContain(expired);
    expect(left).not.toContain(otherAddressExpired);
    expect(left).toEqual([valid, foreign].sort());
    // Idempotent: nothing left to delete among these rows.
    await purgeExpiredEmailProofs();
    expect(await remaining()).toEqual([valid, foreign].sort());
  });
});
