import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { correctPayment, collect } from "./payments";
import { cancelDeposit, createDeposit, paymentLog, readDeposit, listDeposits, paymentsToDeposit } from "./deposits";

/**
 * Bank deposits and payments log (#98), as the application runs it
 * (app_user, RLS). Fictitious data deleted at the end; payments and the
 * audit log being immutable, the cleanup disables their triggers for the
 * duration of an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const director = `rem-direction-${suffix}`;
const TODAY = "2026-10-21";
let school: string;
let otherSchool: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ra-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`rb-${suffix}`}) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Direction Test', ${`${director}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${director}, 'director'), (${otherSchool}, ${director}, 'director')`;
  const [p] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Martin', 'Sophie') RETURNING id`;
  const r = await withSchool(school, (tx) =>
    collect(tx, director, p.id, [
      {
        method: "cheque",
        amountCents: 10000,
        date: TODAY,
        reference: "0001",
        issuer: "Banque A",
        plannedPayment: null,
      },
      {
        method: "cheque",
        amountCents: 10000,
        date: TODAY,
        reference: "0002",
        issuer: "Banque A",
        plannedPayment: "2027-01-05",
      },
      {
        method: "cash",
        amountCents: 2000,
        date: TODAY,
        reference: null,
        issuer: null,
        plannedPayment: null,
      },
      {
        method: "card",
        amountCents: 8000,
        date: TODAY,
        reference: null,
        issuer: null,
        plannedPayment: null,
      },
      {
        method: "cheque",
        amountCents: 5000,
        date: TODAY,
        reference: "0003",
        issuer: null,
        plannedPayment: null,
      },
    ]),
  );
  if (!r.ok) throw new Error(r.message);
  [ids.cheque, ids.deferred, ids.cash, ids.card, ids.cancelled] = r.ids;
  await withSchool(school, (tx) => correctPayment(tx, director, ids.cancelled, 5000, TODAY));
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`DELETE FROM bank_deposit WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE payment DISABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`DELETE FROM payment WHERE school_id IN (${school}, ${otherSchool}) AND corrects_id IS NOT NULL`;
    await t`DELETE FROM payment WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE payment ENABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of ["person", "member"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM "user" WHERE id = ${director}`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const toDeposit = () => withSchool(school, (tx) => paymentsToDeposit(tx, TODAY));

describe("bank deposits", () => {
  let chequesDeposit: string;

  it("to deposit: due cheque and cash; no card, no post-dated cheque, no fully reversed cheque", async () => {
    const r = await toDeposit();
    expect(r.cheque.map((p) => p.id)).toEqual([ids.cheque]);
    expect(r.cash.map((p) => p.id)).toEqual([ids.cash]);
    expect(r.holiday_voucher).toEqual([]);
  });

  it("creates a cheque deposit; rejects an already deposited cheque, another payment method, a cheque not yet due", async () => {
    const r = await withSchool(school, (tx) =>
      createDeposit(tx, director, { date: TODAY, method: "cheque", paymentIds: [ids.cheque] }, TODAY),
    );
    if (!r.ok) throw new Error(r.message);
    chequesDeposit = r.id;
    const refusal = {
      ok: false,
      message:
        "Un des paiements choisis n’est plus à remettre (déjà remis, corrigé, pas encore à encaisser ou d’un autre moyen).",
    };
    expect(
      await withSchool(school, (tx) =>
        createDeposit(tx, director, { date: TODAY, method: "cheque", paymentIds: [ids.cheque] }, TODAY),
      ),
    ).toEqual(refusal);
    expect(
      await withSchool(school, (tx) =>
        createDeposit(tx, director, { date: TODAY, method: "cheque", paymentIds: [ids.cash] }, TODAY),
      ),
    ).toEqual(refusal);
    expect(
      await withSchool(school, (tx) =>
        createDeposit(tx, director, { date: TODAY, method: "cheque", paymentIds: [ids.deferred] }, TODAY),
      ),
    ).toEqual(refusal);
    // A deposit dated on the planned cashing day accepts the post-dated cheque.
    expect(
      (
        await withSchool(school, (tx) =>
          createDeposit(tx, director, { date: "2027-01-05", method: "cheque", paymentIds: [ids.deferred] }, TODAY),
        )
      ).ok,
    ).toBe(true);
    expect((await toDeposit()).cheque).toEqual([]);
  });

  it("a payment can belong to only one deposit (database constraint)", async () => {
    const [{ id: other }] =
      await admin`INSERT INTO bank_deposit (school_id, date, method) VALUES (${school}, ${TODAY}, 'cheque') RETURNING id`;
    await expect(
      admin`INSERT INTO bank_deposit_payment (school_id, bank_deposit_id, payment_id) VALUES (${school}, ${other}, ${ids.cheque})`,
    ).rejects.toThrow();
    await admin`DELETE FROM bank_deposit WHERE id = ${other}`;
  });

  it("deposit slip, list and payment log", async () => {
    const b = await withSchool(school, (tx) => readDeposit(tx, chequesDeposit));
    expect(b).toMatchObject({
      method: "cheque",
      count: 1,
      totalCents: 10000,
      payments: [{ reference: "0001", issuer: "Banque A", payer: "Sophie Martin" }],
    });
    expect(
      (await withSchool(school, (tx) => listDeposits(tx))).map(
        (x) => `${x.date} ${x.method} ${x.count} ${x.totalCents}`,
      ),
    ).toEqual(["2027-01-05 cheque 1 10000", "2026-10-21 cheque 1 10000"]);
    const j = await withSchool(school, (tx) => paymentLog(tx, TODAY, TODAY, null));
    expect(j).toHaveLength(6); // five payments and one correction
    expect(j.find((x) => x.id === ids.cheque)?.dateDeposit).toBe(TODAY);
    expect(await withSchool(school, (tx) => paymentLog(tx, TODAY, TODAY, "cash"))).toHaveLength(1);
  });

  it("cancelling a deposit makes its cheques depositable again and leaves a trace", async () => {
    expect((await withSchool(school, (tx) => cancelDeposit(tx, director, chequesDeposit))).ok).toBe(true);
    expect((await toDeposit()).cheque.map((p) => p.id)).toEqual([ids.cheque]);
    const [t] = await admin`SELECT action FROM audit_log WHERE row_id = ${chequesDeposit} AND action = 'delete'`;
    expect(t?.action).toBe("delete");
  });

  it("another school sees nothing and cannot deposit these payments", async () => {
    expect(await withSchool(otherSchool, (tx) => listDeposits(tx))).toEqual([]);
    expect((await withSchool(otherSchool, (tx) => paymentsToDeposit(tx, TODAY))).cheque).toEqual([]);
    expect(
      (
        await withSchool(otherSchool, (tx) =>
          createDeposit(tx, director, { date: TODAY, method: "cheque", paymentIds: [ids.cheque] }, TODAY),
        )
      ).ok,
    ).toBe(false);
  });
});
