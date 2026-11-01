import postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { defaultEntityFor } from "./billing-entity.integration-helpers";
import { overlapping } from "./overlap.integration-helpers";
import { refundPayer } from "./payments";

/**
 * What a reverse entry may target, guarded by the database (#356, trigger
 * `payment_reverse_target` of migration 0059), whatever the code does: a correction or a
 * rejection cancels an ordinary payment, a refund cancellation cancels a refund, under the
 * target's payer, business and school, and never more than the target's amount. The code
 * checks all of this first (`correctPayment`, `cancelRefundPayment`); these inserts bypass
 * it. Fictitious data deleted at the end; payments and the audit log being immutable, the
 * cleanup disables their triggers inside an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const director = `cible-direction-${suffix}`;
const TODAY = "2026-11-02";
let school: string;
let other: string;
let entity: string;
let danse: string;
let studio: string;
let payer: string;
let sibling: string;
let elsewhere: string;
let twoBusinesses: string;

type Kind = "correction" | "rejection" | "refund" | "refund_cancellation" | null;

const person = async (schoolId: string, lastName: string) =>
  (
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${schoolId}, ${lastName}, 'Zoé') RETURNING id`
  )[0].id as string;

/** Inserts a payment row as the administration role, past the code's checks; returns its id. */
async function insert(row: {
  schoolId?: string;
  entityId?: string;
  payerId?: string;
  cents: number;
  kind?: Kind;
  corrects?: string | null;
  method?: "cheque" | "cash";
}): Promise<string> {
  const [{ id }] = await admin`
    INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, corrects_id, reversal_kind)
    VALUES (${row.schoolId ?? school}, ${row.entityId ?? entity}, ${row.payerId ?? payer}, ${row.cents}, ${row.method ?? "cheque"},
            ${row.corrects ?? null}, ${row.kind ?? null})
    RETURNING id`;
  return id as string;
}

/** The constraint named by the database when it refuses an insert, or "inserted". */
async function refusal(row: Parameters<typeof insert>[0]): Promise<string> {
  try {
    // Rolled back either way: a row accepted here would change what later tests see.
    await admin.begin(async (t) => {
      await t`
        INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, corrects_id, reversal_kind)
        VALUES (${row.schoolId ?? school}, ${row.entityId ?? entity}, ${row.payerId ?? payer}, ${row.cents}, 'cheque',
                ${row.corrects ?? null}, ${row.kind ?? null})`;
      throw new Error("inserted");
    });
  } catch (e) {
    return (e as { constraint_name?: string }).constraint_name ?? (e as Error).message;
  }
  return "inserted";
}

let paid: string; // an ordinary payment of 100,00 €
let correction: string; // -20,00 € on it
let refund: string; // a refund of 30,00 €
let cancellation: string; // +5,00 € on it

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zz', ${`rt-${suffix}`}) RETURNING id`;
  [{ id: other }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zx', ${`ru-${suffix}`}) RETURNING id`;
  [{ id: twoBusinesses }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École Zy', ${`rv-${suffix}`}) RETURNING id`;
  entity = await defaultEntityFor(admin, school);
  const otherEntity = await defaultEntityFor(admin, other);
  danse = await defaultEntityFor(admin, twoBusinesses, "Zy Danse");
  [{ id: studio }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime)
    VALUES (${twoBusinesses}, 'Zy Studio', 'Zy Studio EI', 'not_applicable') RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Direction Zz', ${`${director}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${director}, 'director')`;
  payer = await person(school, "Zzcible");
  sibling = await person(school, "Zzautre");
  elsewhere = await person(other, "Zxailleurs");
  paid = await insert({ cents: 10000 });
  correction = await insert({ cents: -2000, kind: "correction", corrects: paid });
  refund = await insert({ cents: -3000, kind: "refund" });
  cancellation = await insert({ cents: 500, kind: "refund_cancellation", corrects: refund });
  // A payment of the other school, under its own entity.
  await insert({ schoolId: other, entityId: otherEntity, payerId: elsewhere, cents: 10000 });
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`ALTER TABLE payment DISABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${other}, ${twoBusinesses})`;
    await t`DELETE FROM payment WHERE school_id IN (${school}, ${other}, ${twoBusinesses}) AND corrects_id IS NOT NULL`;
    await t`DELETE FROM payment WHERE school_id IN (${school}, ${other}, ${twoBusinesses})`;
    await t`ALTER TABLE payment ENABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of ["person", "member"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2, $3)`, [school, other, twoBusinesses]);
  await admin`DELETE FROM "user" WHERE id = ${director}`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${other}, ${twoBusinesses})`;
  await admin.end();
});

describe("what a reverse entry may target (#356)", () => {
  it("accepts a correction or a rejection of an ordinary payment, a cancellation of a refund", async () => {
    expect(await refusal({ cents: -100, kind: "correction", corrects: paid })).toBe("inserted");
    expect(await refusal({ cents: -100, kind: "rejection", corrects: paid })).toBe("inserted");
    expect(await refusal({ cents: 100, kind: "refund_cancellation", corrects: refund })).toBe("inserted");
  });

  it("refuses a correction or a rejection of a reverse entry", async () => {
    const rejection = await insert({ cents: -1000, kind: "rejection", corrects: await insert({ cents: 1000 }) });
    for (const kind of ["correction", "rejection"] as const)
      for (const target of [correction, rejection, cancellation])
        expect(await refusal({ cents: -100, kind, corrects: target })).toBe("payment_reverse_target");
  });

  it("refuses a correction or a rejection of a refund", async () => {
    for (const kind of ["correction", "rejection"] as const)
      expect(await refusal({ cents: -100, kind, corrects: refund })).toBe("payment_reverse_target");
  });

  it("refuses a refund cancellation of anything but a refund", async () => {
    for (const target of [paid, correction, cancellation])
      expect(await refusal({ cents: 100, kind: "refund_cancellation", corrects: target })).toBe(
        "payment_reverse_target",
      );
  });

  it("refuses a reverse entry under another payer than its target's", async () => {
    expect(await refusal({ payerId: sibling, cents: -100, kind: "correction", corrects: paid })).toBe(
      "payment_reverse_target",
    );
    expect(await refusal({ payerId: sibling, cents: 100, kind: "refund_cancellation", corrects: refund })).toBe(
      "payment_reverse_target",
    );
  });

  it("refuses to cancel beyond what remains, and accepts exactly what remains", async () => {
    // 100,00 € paid, 20,00 € corrected: 80,00 € remain.
    expect(await refusal({ cents: -8001, kind: "correction", corrects: paid })).toBe("payment_reverse_cap");
    expect(await refusal({ cents: -8001, kind: "rejection", corrects: paid })).toBe("payment_reverse_cap");
    expect(await refusal({ cents: -8000, kind: "rejection", corrects: paid })).toBe("inserted");
    // A refund of 30,00 €, 5,00 € cancelled: 25,00 € remain.
    expect(await refusal({ cents: 2501, kind: "refund_cancellation", corrects: refund })).toBe("payment_reverse_cap");
    expect(await refusal({ cents: 2500, kind: "refund_cancellation", corrects: refund })).toBe("inserted");
  });

  it("counts every reverse entry already there: a second one past the rest is refused", async () => {
    const p = await insert({ cents: 3000 });
    await insert({ cents: -2000, kind: "correction", corrects: p });
    expect(await refusal({ cents: -1001, kind: "correction", corrects: p })).toBe("payment_reverse_cap");
    await insert({ cents: -1000, kind: "rejection", corrects: p });
    expect(await refusal({ cents: -1, kind: "correction", corrects: p })).toBe("payment_reverse_cap");
  });

  it("refuses a target of another school", async () => {
    const [{ id: theirs }] = await admin`SELECT id FROM payment WHERE school_id = ${other} LIMIT 1`;
    expect(await refusal({ cents: -100, kind: "correction", corrects: theirs })).toMatch(
      /payment_corrects_same_entity_fk/,
    );
  });

  it("refuses a target of another business of the school", async () => {
    const p = await insert({
      schoolId: twoBusinesses,
      entityId: danse,
      payerId: await person(twoBusinesses, "Zy"),
      cents: 1000,
    });
    const [{ payer_id: theirPayer }] = await admin`SELECT payer_id FROM payment WHERE id = ${p}`;
    expect(
      await refusal({
        schoolId: twoBusinesses,
        entityId: studio,
        payerId: theirPayer,
        cents: -100,
        kind: "correction",
        corrects: p,
      }),
    ).toMatch(/payment_corrects_same_entity_fk/);
  });

  it("applies to the application role too (app_user, RLS)", async () => {
    const insertAsApp = (cents: number, kind: Kind, corrects: string) =>
      withSchool(school, (tx) =>
        tx.execute(sql`
          INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, corrects_id, reversal_kind)
          VALUES (${school}, ${entity}, ${payer}, ${cents}, 'cheque', ${corrects}, ${kind})`),
      );
    const cause = async (p: Promise<unknown>) => {
      try {
        await p;
        return "inserted";
      } catch (e) {
        const c = (e as { cause?: { constraint_name?: string } }).cause;
        return c?.constraint_name ?? String(e);
      }
    };
    expect(await cause(insertAsApp(100, "refund_cancellation", paid))).toBe("payment_reverse_target");
    expect(await cause(insertAsApp(-100, "correction", refund))).toBe("payment_reverse_target");
    expect(await cause(insertAsApp(-1_000_000, "correction", paid))).toBe("payment_reverse_cap");
    // The other school's payment is out of sight: the composite key refuses it.
    const [{ id: theirs }] = await admin`SELECT id FROM payment WHERE school_id = ${other} LIMIT 1`;
    expect(await cause(insertAsApp(-100, "correction", theirs))).toMatch(/payment_corrects_same_entity_fk|foreign key/);
  });
});

describe("two reverse entries of one payment at the same moment (#356)", () => {
  it("wait for each other: together they never cancel more than the payment", async () => {
    const p = await insert({ cents: 5000 });
    const correct = (cents: number) => sql`
      INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, corrects_id, reversal_kind)
      VALUES (${school}, ${entity}, ${payer}, ${-cents}, 'cheque', ${p}, 'correction')`;
    const [first, second] = await overlapping(
      admin,
      (hold) =>
        withSchool(school, async (tx) => {
          await tx.execute(correct(3000));
          await hold();
          return "inserted";
        }),
      () =>
        withSchool(school, (tx) => tx.execute(correct(3000))).then(
          () => "inserted",
          (e: { cause?: { constraint_name?: string } }) => e.cause?.constraint_name ?? String(e),
        ),
    );
    expect([first, second]).toEqual(["inserted", "payment_reverse_cap"]);
    const [{ total }] = await admin`SELECT sum(amount_cents)::int AS total FROM payment WHERE corrects_id = ${p}`;
    expect(total).toBe(-3000);
  });

  it("a reverse entry written outside the code and a refund for the same payer both go through, without deadlock", async () => {
    // The payer has 100,00 € in cash left over (nothing due): refundable once corrected to 60,00 €.
    const lonely = await person(school, "Zzseul");
    const p = await insert({ payerId: lonely, cents: 10000, method: "cash" });
    const [first, second] = await overlapping(
      admin,
      (hold) =>
        withSchool(school, async (tx) => {
          // The trigger locks the payer, then the payment, as `src/db/payment-locks.ts` orders
          // them: the refund, which locks the payer first, waits, then sees the correction.
          await tx.execute(sql`
            INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, corrects_id, reversal_kind)
            VALUES (${school}, ${entity}, ${lonely}, -4000, 'cash', ${p}, 'correction')`);
          await hold();
          return "inserted";
        }),
      () =>
        withSchool(school, (tx) =>
          refundPayer(tx, director, lonely, { method: "cash", amountCents: 6000, date: TODAY, reference: null }, TODAY),
        ),
    );
    expect(first).toBe("inserted");
    expect(second).toMatchObject({ ok: true });
  });
});
