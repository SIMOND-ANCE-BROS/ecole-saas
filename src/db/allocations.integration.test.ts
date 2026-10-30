import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Tx, withSchool } from "./index";
import { defaultEntityFor } from "./billing-entity.integration-helpers";
import { overlapping } from "./overlap.integration-helpers";
import { balanceOf, cancelRefundPayment, collect, correctPayment, refundPayer } from "./payments";
import { cancelDeposit, createDeposit } from "./deposits";
import { allocatePayer } from "./allocations";

/**
 * Allocating payments to installments (#305) with the locks of #254, as the application runs
 * it (app_user, RLS): a payment settles the oldest open installments of its payer's issued
 * invoices with the same business, once its money is collected. Installments are written
 * directly, as a school's plan (#176) will write them. Fictitious data deleted at the end;
 * payments, the audit log and issued invoices being immutable, the cleanup disables their
 * triggers inside an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const director = `aff-direction-${suffix}`;
const TODAY = "2026-11-02";
let school: string;
let entity: string;
let other: string;
let season: string;
let invoiceCount = 0;
/** The member writing the allocations, as the audit log records the actor. */
let directorMember: string;

const cash = (amountCents: number) => ({
  method: "cash" as const,
  amountCents,
  date: TODAY,
  reference: null,
  issuer: null,
  plannedPayment: null,
});
const cheque = (amountCents: number, reference: string) => ({
  ...cash(amountCents),
  method: "cheque" as const,
  reference,
});

async function person(lastName: string): Promise<string> {
  const [{ id }] = await admin`
    INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, ${lastName}, 'Zoé') RETURNING id`;
  return id;
}

async function enroll(payer: string, cents: number, entityId = entity): Promise<string> {
  const [{ id }] = await admin`
    INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents)
    VALUES (${school}, ${entityId}, ${season}, ${payer}, 'child', 'year', ${cents}) RETURNING id`;
  return id;
}

/**
 * An issued invoice billing `enrollmentId` for the sum of `installments`, one installment per
 * [due date, amount], written before issuing as the triggers require. Returns the installment ids in order.
 */
async function issue(
  payer: string,
  enrollmentId: string,
  installments: [string, number][],
  entityId = entity,
): Promise<string[]> {
  const total = installments.reduce((s, [, c]) => s + c, 0);
  const [{ id: treatment }] =
    await admin`SELECT default_vat_treatment_id AS id FROM billing_entity WHERE id = ${entityId}`;
  const [{ id: inv }] = await admin`
    INSERT INTO invoice (school_id, billing_entity_id, payer_id, season_id, total_incl_tax_cents, total_excl_tax_cents)
    VALUES (${school}, ${entityId}, ${payer}, ${season}, ${total}, ${total}) RETURNING id`;
  await admin`
    INSERT INTO invoice_line (school_id, billing_entity_id, invoice_id, label, unit_price_cents, incl_tax_cents,
      excl_tax_cents, vat_cents, vat_treatment_id, vat_category, vat_mention, enrollment_id)
    VALUES (${school}, ${entityId}, ${inv}, 'Zz forfait', ${total}, ${total}, ${total}, 0, ${treatment}, 'exempt',
      'Zz mention', ${enrollmentId})`;
  const ids: string[] = [];
  for (const [i, [dueDate, cents]] of installments.entries()) {
    const [{ id }] = await admin`
      INSERT INTO installment (school_id, billing_entity_id, invoice_id, rank, due_date, amount_cents)
      VALUES (${school}, ${entityId}, ${inv}, ${i + 1}, ${dueDate}, ${cents}) RETURNING id`;
    ids.push(id);
  }
  invoiceCount += 1;
  await admin`UPDATE invoice SET status = 'issued', number = ${`Zz-${suffix}-${invoiceCount}`}, issued_on = ${TODAY},
    tool = 'pennylane', tool_ref = 'zz' WHERE id = ${inv}`;
  return ids;
}

/** Each installment's status and what is allocated to it, in the order given. */
async function installments(ids: string[]) {
  const rows = await admin`
    SELECT i.id, i.status, coalesce(sum(a.amount_cents), 0)::int AS allocated
    FROM installment i LEFT JOIN payment_allocation a ON a.installment_id = i.id
    WHERE i.id IN ${admin(ids)} GROUP BY i.id`;
  return ids.map((id) => {
    const r = rows.find((x) => x.id === id);
    return { status: r?.status as string, allocated: r?.allocated as number };
  });
}

const paymentIdsOf = async (payer: string) =>
  (await admin`SELECT id FROM payment WHERE payer_id = ${payer} AND amount_cents > 0 ORDER BY created_at`).map(
    (p) => p.id as string,
  );

const QUARTERS: [string, number][] = [
  ["2026-10-01", 10_000],
  ["2027-01-05", 10_000],
  ["2027-04-05", 10_000],
];

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zz', ${`af-${suffix}`}) RETURNING id`;
  entity = await defaultEntityFor(admin, school);
  [{ id: other }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, default_vat_treatment_id, active)
    SELECT school_id, 'Zz Studio', 'Zz Studio EI', 'not_applicable', default_vat_treatment_id, false
    FROM billing_entity WHERE id = ${entity} RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Direction Zz', ${`${director}@exemple.test`})`;
  [{ id: directorMember }] =
    await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${director}, 'director') RETURNING id`;
  [{ id: season }] = await admin`
    INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
});

afterAll(async () => {
  const triggers = [
    ["invoice", "invoice_issued_immutable"],
    ["invoice_line", "invoice_line_immutable"],
    ["installment", "installment_immutable"],
    ["audit_log", "audit_log_append_only"],
    ["payment", "payment_immutable"],
  ];
  await admin.begin(async (t) => {
    for (const [table, trigger] of triggers) await t.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    await t`DELETE FROM bank_deposit WHERE school_id = ${school}`;
    for (const table of ["payment_allocation", "invoice_line", "installment", "invoice", "audit_log"])
      await t.unsafe(`DELETE FROM ${table} WHERE school_id = $1`, [school]);
    await t`DELETE FROM payment WHERE school_id = ${school} AND corrects_id IS NOT NULL`;
    await t`DELETE FROM payment WHERE school_id = ${school}`;
    for (const [table, trigger] of triggers) await t.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
  });
  for (const t of ["enrollment", "season", "person", "member"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id = $1`, [school]);
  await admin`DELETE FROM "user" WHERE id = ${director}`;
  await admin`DELETE FROM school WHERE id = ${school}`;
  await admin.end();
});

const run = <T>(f: (tx: Tx) => Promise<T>) => withSchool(school, f);

describe("allocating a payment FIFO (#305)", () => {
  it("cash settles the oldest installment, then part of the next; the balance reads the invoice", async () => {
    const payer = await person("Zzfifo");
    const e = await enroll(payer, 30_000);
    const q = await issue(payer, e, QUARTERS);
    // Enrolled after the invoice was issued: still counted from its price.
    await enroll(payer, 5_000);
    expect(await run((tx) => collect(tx, director, payer, [cash(15_000)], undefined, TODAY))).toMatchObject({
      ok: true,
    });
    expect(await installments(q)).toEqual([
      { status: "paid", allocated: 10_000 },
      { status: "partial", allocated: 5_000 },
      { status: "upcoming", allocated: 0 },
    ]);
    expect((await run((tx) => balanceOf(tx, payer, TODAY)))?.total).toMatchObject({
      due: 35_000,
      paid: 15_000,
      remaining: 20_000,
    });
  });

  it("an overpayment settles every installment; the rest stays unallocated", async () => {
    const payer = await person("Zztrop");
    const q = await issue(payer, await enroll(payer, 30_000), QUARTERS);
    await run((tx) => collect(tx, director, payer, [cash(35_000)], undefined, TODAY));
    expect((await installments(q)).map((i) => i.status)).toEqual(["paid", "paid", "paid"]);
    const [{ n }] = await admin`
      SELECT sum(a.amount_cents)::int AS n FROM payment_allocation a JOIN payment p ON p.id = a.payment_id
      WHERE p.payer_id = ${payer}`;
    expect(n).toBe(30_000);
  });

  it("a cheque settles nothing until it is deposited; a cancelled deposit gives it back", async () => {
    const payer = await person("Zzcheque");
    const q = await issue(payer, await enroll(payer, 30_000), QUARTERS);
    await run((tx) => collect(tx, director, payer, [cheque(12_000, "0001")], undefined, TODAY));
    expect(await installments(q)).toEqual([
      { status: "upcoming", allocated: 0 },
      { status: "upcoming", allocated: 0 },
      { status: "upcoming", allocated: 0 },
    ]);
    const [p] = await paymentIdsOf(payer);
    const deposit = await run((tx) =>
      createDeposit(tx, director, { date: TODAY, method: "cheque", paymentIds: [p] }, TODAY),
    );
    if (!deposit.ok) throw new Error(deposit.message);
    expect(await installments(q)).toEqual([
      { status: "paid", allocated: 10_000 },
      { status: "partial", allocated: 2_000 },
      { status: "upcoming", allocated: 0 },
    ]);
    expect(await run((tx) => cancelDeposit(tx, director, deposit.id, TODAY))).toMatchObject({ ok: true });
    expect(await installments(q)).toEqual([
      { status: "overdue", allocated: 0 },
      { status: "upcoming", allocated: 0 },
      { status: "upcoming", allocated: 0 },
    ]);
  });

  it("a cheque the bank returns gives back everything it settled", async () => {
    const payer = await person("Zzrejet");
    const q = await issue(payer, await enroll(payer, 30_000), QUARTERS);
    await run((tx) => collect(tx, director, payer, [cheque(15_000, "0002")], undefined, TODAY));
    const [p] = await paymentIdsOf(payer);
    const deposit = await run((tx) =>
      createDeposit(tx, director, { date: TODAY, method: "cheque", paymentIds: [p] }, TODAY),
    );
    if (!deposit.ok) throw new Error(deposit.message);
    expect((await installments(q)).map((i) => i.allocated)).toEqual([10_000, 5_000, 0]);
    expect(await run((tx) => correctPayment(tx, director, p, 15_000, TODAY, TODAY))).toMatchObject({ ok: true });
    expect(await installments(q)).toEqual([
      { status: "overdue", allocated: 0 },
      { status: "upcoming", allocated: 0 },
      { status: "upcoming", allocated: 0 },
    ]);
  });

  it("a correction takes back from the latest due installment first", async () => {
    const payer = await person("Zzcorrige");
    const q = await issue(payer, await enroll(payer, 30_000), QUARTERS);
    await run((tx) => collect(tx, director, payer, [cash(25_000)], undefined, TODAY));
    const [p] = await paymentIdsOf(payer);
    expect(await run((tx) => correctPayment(tx, director, p, 8_000, TODAY))).toMatchObject({ ok: true });
    expect(await installments(q)).toEqual([
      { status: "paid", allocated: 10_000 },
      { status: "partial", allocated: 7_000 },
      { status: "upcoming", allocated: 0 },
    ]);
    // The audit log tells the same story: 25 000 allocated, 8 000 taken back.
    const logged = await admin`
      SELECT action, (before->>'amount_cents')::int AS b, (after->>'amount_cents')::int AS a
      FROM audit_log WHERE target_table = 'payment_allocation' AND row_id = ${p}`;
    const net = logged.reduce((s, r) => s + (r.a ?? 0) - (r.b ?? 0), 0);
    expect(net).toBe(17_000);
  });

  it("only the payment's own business: another entity's installments stay open", async () => {
    const payer = await person("Zzdeux");
    const mine = await issue(payer, await enroll(payer, 10_000), [["2026-10-01", 10_000]]);
    const theirs = await issue(payer, await enroll(payer, 10_000, other), [["2026-09-01", 10_000]], other);
    await run((tx) => collect(tx, director, payer, [cash(10_000)], entity, TODAY));
    expect(await installments([...mine, ...theirs])).toEqual([
      { status: "paid", allocated: 10_000 },
      { status: "upcoming", allocated: 0 },
    ]);
  });

  it("the database refuses an allocation to another entity's installment", async () => {
    const payer = await person("Zzcroise");
    const [q] = await issue(payer, await enroll(payer, 10_000, other), [["2026-10-01", 10_000]], other);
    await run((tx) => collect(tx, director, payer, [cheque(10_000, "0009")], entity, TODAY));
    const [p] = await paymentIdsOf(payer);
    await expect(
      admin`INSERT INTO payment_allocation (school_id, billing_entity_id, payment_id, installment_id, amount_cents)
        VALUES (${school}, ${entity}, ${p}, ${q}, 1000)`,
    ).rejects.toThrow(/foreign key/);
  });

  it("an invoice issued after the payment: the payer's money is allocated then (#304 calls it)", async () => {
    const payer = await person("Zzavance");
    const e = await enroll(payer, 30_000);
    await run((tx) => collect(tx, director, payer, [cash(30_000)], undefined, TODAY));
    const q = await issue(payer, e, QUARTERS);
    expect(await run((tx) => allocatePayer(tx, directorMember, payer, entity, TODAY))).toMatchObject({ ok: true });
    expect((await installments(q)).map((i) => i.allocated)).toEqual([10_000, 10_000, 10_000]);
    // Again: nothing left to allocate, nothing written twice.
    expect(await run((tx) => allocatePayer(tx, directorMember, payer, entity, TODAY))).toEqual({
      ok: true,
      allocations: [],
    });
  });
});

describe("refunds and their cancellations (#294, #346)", () => {
  it("money refunded is not allocated; a refund cancelled by mistake gives it back", async () => {
    const payer = await person("Zzrembourse");
    const e = await enroll(payer, 28_000);
    await run((tx) => collect(tx, director, payer, [cash(38_000)], undefined, TODAY));
    const refunded = await run((tx) =>
      refundPayer(
        tx,
        director,
        payer,
        { method: "cash", amountCents: 10_000, date: TODAY, reference: null },
        TODAY,
        entity,
      ),
    );
    if (!refunded.ok) throw new Error(refunded.message);
    expect(await run((tx) => cancelRefundPayment(tx, director, refunded.ids[0], 4_000, TODAY))).toMatchObject({
      ok: true,
    });
    // 38 000 paid, 10 000 refunded, 4 000 of it cancelled: 32 000 to allocate, not 38 000 nor 28 000.
    const q = await issue(payer, e, [
      ["2026-10-01", 20_000],
      ["2027-01-05", 20_000],
    ]);
    expect(await run((tx) => allocatePayer(tx, directorMember, payer, entity, TODAY))).toMatchObject({ ok: true });
    expect((await installments(q)).map((i) => i.allocated)).toEqual([20_000, 12_000]);
  });
});

describe("what the payer's money no longer covers", () => {
  it("a correction after a refund takes back what the refund and the correction leave uncovered", async () => {
    const payer = await person("Zzapresremb");
    const [q] = await issue(payer, await enroll(payer, 6_000), [["2026-10-01", 6_000]]);
    await run((tx) => collect(tx, director, payer, [cash(10_000)], undefined, TODAY));
    const refunded = await run((tx) =>
      refundPayer(
        tx,
        director,
        payer,
        { method: "cash", amountCents: 4_000, date: TODAY, reference: null },
        TODAY,
        entity,
      ),
    );
    if (!refunded.ok) throw new Error(refunded.message);
    const [p] = await paymentIdsOf(payer);
    expect(await run((tx) => correctPayment(tx, director, p, 4_000, TODAY))).toMatchObject({ ok: true });
    // 100,00 € in, 40,00 € refunded, 40,00 € corrected: 20,00 € left to settle the 60,00 €.
    expect(await installments([q])).toEqual([{ status: "partial", allocated: 2_000 }]);
    expect((await run((tx) => balanceOf(tx, payer, TODAY)))?.total).toMatchObject({ due: 6_000, remaining: 4_000 });
  });

  it("a cheque on a deposit dated ahead of its cashing day is allocated once deposited", async () => {
    const payer = await person("Zzavant");
    const q = await issue(payer, await enroll(payer, 10_000), [["2026-10-01", 10_000]]);
    const ahead = { ...cheque(10_000, "0005"), plannedPayment: "2026-11-05" };
    await run((tx) => collect(tx, director, payer, [ahead], undefined, TODAY));
    const [p] = await paymentIdsOf(payer);
    const deposit = await run((tx) =>
      createDeposit(tx, director, { date: "2026-11-05", method: "cheque", paymentIds: [p] }, TODAY),
    );
    if (!deposit.ok) throw new Error(deposit.message);
    expect(await installments(q)).toEqual([{ status: "paid", allocated: 10_000 }]);
  });
});

describe("money left unallocated", () => {
  it("the payer's next payment also spends what earlier payments left unallocated", async () => {
    const payer = await person("Zzrattrape");
    const e = await enroll(payer, 10_000);
    // Paid before the invoice was issued, and nothing allocated it then.
    await run((tx) => collect(tx, director, payer, [cash(5_000)], undefined, TODAY));
    const q = await issue(payer, e, [["2026-10-01", 10_000]]);
    await run((tx) => collect(tx, director, payer, [cash(1_000)], undefined, TODAY));
    expect(await installments(q)).toEqual([{ status: "partial", allocated: 6_000 }]);
  });
});

describe("balances without an invoice (#305)", () => {
  it("a payer without any invoice keeps the balance computed from prices", async () => {
    const payer = await person("Zzsans");
    await enroll(payer, 28_000);
    await run((tx) => collect(tx, director, payer, [cash(8_000)], undefined, TODAY));
    expect((await run((tx) => balanceOf(tx, payer, TODAY)))?.total).toEqual({
      due: 28_000,
      paid: 8_000,
      remaining: 20_000,
      toCollect: 0,
      outsideCalculation: {},
    });
    const [{ n }] = await admin`
      SELECT count(*)::int AS n FROM payment_allocation a JOIN payment p ON p.id = a.payment_id WHERE p.payer_id = ${payer}`;
    expect(n).toBe(0);
  });
});

describe("allocations at the same moment (#254)", () => {
  it("two payments allocated at once never settle an installment twice", async () => {
    const payer = await person("Zzdouble");
    const q = await issue(payer, await enroll(payer, 30_000), QUARTERS);
    const [first, second] = await overlapping(
      admin,
      (hold) =>
        run(async (tx) => {
          const r = await collect(tx, director, payer, [cash(20_000)], undefined, TODAY);
          await hold();
          return r;
        }),
      () => run((tx) => collect(tx, director, payer, [cash(20_000)], undefined, TODAY)),
    );
    expect(first.ok && second.ok).toBe(true);
    expect(await installments(q)).toEqual([
      { status: "paid", allocated: 10_000 },
      { status: "paid", allocated: 10_000 },
      { status: "paid", allocated: 10_000 },
    ]);
  });

  it("an allocation waiting for a correction of the payment sees it: nothing beyond what is left", async () => {
    const payer = await person("Zzattend");
    const e = await enroll(payer, 30_000);
    await run((tx) => collect(tx, director, payer, [cash(20_000)], undefined, TODAY));
    const [p] = await paymentIdsOf(payer);
    const q = await issue(payer, e, QUARTERS);
    const [corrected, allocated] = await overlapping(
      admin,
      (hold) =>
        run(async (tx) => {
          const r = await correctPayment(tx, director, p, 15_000, TODAY);
          await hold();
          return r;
        }),
      () => run((tx) => allocatePayer(tx, directorMember, payer, entity, TODAY)),
    );
    expect(corrected.ok).toBe(true);
    expect(allocated).toMatchObject({ ok: true });
    expect((await installments(q)).map((i) => i.allocated)).toEqual([5_000, 0, 0]);
  });

  it("a correction waiting for an allocation takes back what the allocation wrote", async () => {
    const payer = await person("Zzapres");
    const e = await enroll(payer, 30_000);
    await run((tx) => collect(tx, director, payer, [cash(20_000)], undefined, TODAY));
    const [p] = await paymentIdsOf(payer);
    const q = await issue(payer, e, QUARTERS);
    const [allocated, corrected] = await overlapping(
      admin,
      (hold) =>
        run(async (tx) => {
          const r = await allocatePayer(tx, directorMember, payer, entity, TODAY);
          await hold();
          return r;
        }),
      () => run((tx) => correctPayment(tx, director, p, 15_000, TODAY)),
    );
    expect(allocated).toMatchObject({ ok: true });
    expect(corrected.ok).toBe(true);
    expect(await installments(q)).toEqual([
      { status: "partial", allocated: 5_000 },
      { status: "upcoming", allocated: 0 },
      { status: "upcoming", allocated: 0 },
    ]);
  });
});
