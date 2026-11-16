import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, withSchool } from "./index";
import { defaultEntityFor } from "./billing-entity.integration-helpers";
import { collect } from "./payments";
import { WAIT_LIMITS } from "./wait-limits";
import { BUSY, orBusy } from "../lib/action-result";

/**
 * Bounded waits of `withSchool` transactions (#364): a write waiting for a row lock held
 * elsewhere gives up after `WAIT_LIMITS.lockTimeout` (55P03), and a server action turns that
 * into « Réessayez dans un instant. » instead of hanging. Run as the application runs it
 * (app_user, RLS); an administration connection holds the payer's row. Fictitious data,
 * deleted at the end.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 2, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const director = `attente-direction-${suffix}`;
const TODAY = "2026-11-02";
let school: string;
let payer: string;

const cash = {
  method: "cash" as const,
  amountCents: 1000,
  date: TODAY,
  reference: null,
  issuer: null,
  plannedPayment: null,
};

/** Past the lock timeout (5 s) with room to spare, under Vitest's test timeout below. */
const NO_HANG_MS = 12_000;

/** `call`, or "hung" once `ms` have passed: a missing timeout fails the test instead of hanging it. */
const within = <T>(ms: number, call: Promise<T>) =>
  Promise.race([call, new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), ms))]);

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zz', ${`wl-${suffix}`}) RETURNING id`;
  const entity = await defaultEntityFor(admin, school);
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Direction Zz', ${`${director}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${director}, 'director')`;
  [{ id: payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzattente', 'Zoé') RETURNING id`;
  const [s] = await admin`
    INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, ${`2026-2027 ${suffix}`}, '2026-09-01', '2027-06-30') RETURNING id`;
  await admin`
    INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents)
    VALUES (${school}, ${entity}, ${s.id}, ${payer}, 'child', 'year', 28000)`;
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE payment DISABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id = ${school}`;
    await t`DELETE FROM payment WHERE school_id = ${school}`;
    await t`ALTER TABLE payment ENABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of ["enrollment", "season", "person", "member"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  await admin`DELETE FROM "user" WHERE id = ${director}`;
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

/** Runs `write` while an administration transaction holds the payer's row, released afterwards. */
async function whilePayerHeld<T>(write: () => Promise<T>): Promise<T> {
  const holder = await admin.reserve();
  try {
    await holder`BEGIN`;
    await holder`SELECT id FROM person WHERE id = ${payer} FOR UPDATE`;
    return await write();
  } finally {
    await holder`ROLLBACK`.catch(() => undefined);
    holder.release();
  }
}

describe("bounded waits in withSchool (#364)", () => {
  it("a payment waiting for a payer held elsewhere gives up with 55P03 after the lock timeout, nothing recorded", async () => {
    const started = Date.now();
    const outcome = await whilePayerHeld(() =>
      within(
        NO_HANG_MS,
        withSchool(school, (tx) => collect(tx, director, payer, [cash])).then(
          () => "saved",
          (e: unknown) => (e as { cause?: { code?: string } }).cause?.code ?? String(e),
        ),
      ),
    );
    expect(outcome).toBe("55P03");
    expect(Date.now() - started).toBeGreaterThanOrEqual(4_500);
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM payment WHERE school_id = ${school}`;
    expect(n).toBe(0);
  }, 20_000);

  it("the server action's refusal is « Réessayez dans un instant. », never an error", async () => {
    const outcome = await whilePayerHeld(() =>
      within(
        NO_HANG_MS,
        orBusy(() => withSchool(school, (tx) => collect(tx, director, payer, [cash]))),
      ),
    );
    expect(outcome).toEqual({ ok: false, message: BUSY });
    expect(BUSY).toBe("Réessayez dans un instant.");
  }, 20_000);

  it("sets both limits inside the transaction only, from WAIT_LIMITS", async () => {
    // The connection's own default (0 on a plain server), read outside any withSchool.
    const [before] = await db.execute<{ lock: string }>(sql`select current_setting('lock_timeout') as lock`);
    const inside = await withSchool(school, async (tx) => {
      const [row] = await tx.execute<{ lock: string; statement: string }>(
        sql`select current_setting('lock_timeout') as lock, current_setting('statement_timeout') as statement`,
      );
      return row;
    });
    expect(inside).toEqual({ lock: WAIT_LIMITS.lockTimeout, statement: WAIT_LIMITS.statementTimeout });
    // SET LOCAL: the pooled connection is back to the server defaults once the transaction ends.
    for (let i = 0; i < 12; i++) {
      const [row] = await db.execute<{ lock: string }>(sql`select current_setting('lock_timeout') as lock`);
      expect(row?.lock).toBe(before?.lock);
    }
  });

  it("a statement cancelled by the statement timeout (57014) gets the same refusal", async () => {
    const outcome = await orBusy(() =>
      withSchool(school, async (tx) => {
        // Lowered for this transaction only, so the test does not wait 30 s.
        await tx.execute(sql`select set_config('statement_timeout', '200ms', true)`);
        await tx.execute(sql`select pg_sleep(2)`);
        return { ok: true as const };
      }),
    );
    expect(outcome).toEqual({ ok: false, message: BUSY });
  });
});
