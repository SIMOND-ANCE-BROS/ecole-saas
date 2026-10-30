import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { defaultEntityFor } from "./billing-entity.integration-helpers";
import { balanceOf, collect, correctPayment, refundPayer } from "./payments";
import { createDeposit } from "./deposits";
import { relationship } from "./schema";

/**
 * The lock order of payment writes (#360, `src/db/payment-locks.ts`): a refund and a
 * correction of one of the payer's payments, at the same moment, never deadlock. Run as the
 * application runs them (app_user, RLS). Fictitious data deleted at the end; payments and the
 * audit log being immutable, the cleanup disables their triggers inside an administration
 * transaction.
 *
 * To catch the correction between two of its steps, an administration connection holds
 * `bank_deposit` in ACCESS EXCLUSIVE mode: the correction reads that table (is the payment
 * deposited?) after taking its first locks, and waits there; the refund, which reads it only
 * after all its locks, is then started. Locks taken out of order (payment, then payer) used
 * to end in `40P01 deadlock detected` once the table was released.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 2, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const director = `verrou-direction-${suffix}`;
const TODAY = "2026-11-02";
let school: string;
let payer: string;
let partner: string;

const cash = (amountCents: number) => ({
  method: "cash" as const,
  amountCents,
  date: TODAY,
  reference: null,
  issuer: null,
  plannedPayment: null,
});

/**
 * Waits until a backend waits for a lock held by backend `pid`, and returns its pid
 * (`pg_blocking_pids`): a wait elsewhere on the server is ignored, and integration files run
 * one after another (`fileParallelism: false`), so the one found here is this test's.
 */
async function blockedBy(pid: number, timeoutMs = 5000): Promise<number> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const [w] = await admin`SELECT pid FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid)) LIMIT 1`;
    if (w) return w.pid as number;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no backend waits for ${pid} after ${timeoutMs} ms`);
}

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zz', ${`vo-${suffix}`}) RETURNING id`;
  const entity = await defaultEntityFor(admin, school);
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Direction Zz', ${`${director}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${director}, 'director')`;
  [{ id: payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzverrou', 'Zoé') RETURNING id`;
  [{ id: partner }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzverrou', 'Zack') RETURNING id`;
  const [s] = await admin`
    INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, ${`2026-2027 ${suffix}`}, '2026-09-01', '2027-06-30') RETURNING id`;
  await admin`
    INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents)
    VALUES (${school}, ${entity}, ${s.id}, ${payer}, 'child', 'year', 28000)`;
});

afterAll(async () => {
  await admin`DELETE FROM bank_deposit WHERE school_id = ${school}`;
  await admin.begin(async (t) => {
    await t`ALTER TABLE payment DISABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id = ${school}`;
    await t`DELETE FROM payment WHERE school_id = ${school} AND corrects_id IS NOT NULL`;
    await t`DELETE FROM payment WHERE school_id = ${school}`;
    await t`ALTER TABLE payment ENABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of ["relationship", "enrollment", "season", "person", "member"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  await admin`DELETE FROM "user" WHERE id = ${director}`;
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

describe("lock order of payment writes (#360)", () => {
  it("a refund and a correction of the same payer at the same moment both finish, never in a deadlock", async () => {
    // 280,00 € owed, 330,00 € received in cash: 50,00 € overpaid.
    const paid = await withSchool(school, (tx) => collect(tx, director, payer, [cash(28000), cash(5000)]));
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    const corrected = paid.ids[1];

    const gate = await admin.reserve();
    try {
      const [{ pid: gatePid }] = await gate`SELECT pg_backend_pid() AS pid`;
      await gate`BEGIN`;
      await gate`LOCK TABLE bank_deposit IN ACCESS EXCLUSIVE MODE`;
      // Cancels 10,00 € of the second payment: waits on bank_deposit, its first locks taken.
      const correction = withSchool(school, (tx) => correctPayment(tx, director, corrected, 1000, TODAY));
      correction.catch(() => undefined);
      const correctionPid = await blockedBy(gatePid as number);
      // Pays back 20,00 €: waits for a lock the correction holds.
      const refund = withSchool(school, (tx) =>
        refundPayer(tx, director, payer, { method: "cash", amountCents: 2000, date: TODAY, reference: null }, TODAY),
      );
      refund.catch(() => undefined);
      await blockedBy(correctionPid);
      await gate`COMMIT`;
      const outcomes = await Promise.allSettled([correction, refund]);
      // Drizzle wraps the driver's error: its Postgres code (40P01 for a deadlock) is on the cause.
      const errors = outcomes.flatMap((o) =>
        o.status === "rejected" ? [(o.reason as { cause?: { code?: string } }).cause?.code ?? String(o.reason)] : [],
      );
      expect(errors).toEqual([]);
      expect(outcomes.map((o) => o.status === "fulfilled" && o.value.ok)).toEqual([true, true]);
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
    }
    // 330 − 10 − 20 = 300,00 € kept for 280,00 € owed: 20,00 € still overpaid.
    expect((await withSchool(school, (tx) => balanceOf(tx, payer, TODAY)))?.total.remaining).toBe(-2000);
  });

  it("a deposit never waits for an insert keyed to its payers (a relationship being saved between two of them)", async () => {
    const cheque = (reference: string) => ({ ...cash(3000), method: "cheque" as const, reference });
    const a = await withSchool(school, (tx) => collect(tx, director, payer, [cheque("V0001")]));
    const b = await withSchool(school, (tx) => collect(tx, director, partner, [cheque("V0002")]));
    if (!a.ok || !b.ok) throw new Error("cheques not recorded");

    // Holds KEY SHARE on both payers, as attendance, a couple enrolled or a relationship does.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const link = withSchool(school, async (tx) => {
      await tx
        .insert(relationship)
        .values({ schoolId: school, personId: partner, relatedPersonId: payer, type: "partner" });
      held();
      await released;
    });
    link.catch(() => undefined);
    await holding;
    try {
      const deposit = withSchool(school, (tx) =>
        createDeposit(tx, director, { date: TODAY, method: "cheque", paymentIds: [...a.ids, ...b.ids] }, TODAY),
      );
      const timeout = new Promise<"waited">((resolve) => setTimeout(() => resolve("waited"), 3000));
      const outcome = await Promise.race([deposit, timeout]);
      expect(outcome).toMatchObject({ ok: true });
    } finally {
      release();
      await link;
    }
  });
});
