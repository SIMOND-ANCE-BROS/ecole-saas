import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { correctPayment, collect, PAYMENT_METHODS } from "./payments";
import { toCsv, totals } from "../domain/payments/deposits";
import { formatEuros } from "../lib/money";
import { cancelDeposit, createDeposit, paymentLog, readDeposit, listDeposits, paymentsToDeposit } from "./deposits";
import { overlapping } from "./overlap.integration-helpers";
import { once, storedPayments } from "./submissions";
import { randomUUID } from "node:crypto";

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
  for (const t of ["submission", "person", "member"])
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

describe("deposits saved at the same time as another change (#247)", () => {
  const NOT_DEPOSITABLE =
    "Un des paiements choisis n’est plus à remettre (déjà remis, corrigé, pas encore à encaisser ou d’un autre moyen).";

  async function newCheque(reference: string): Promise<string> {
    const [p] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzconcurrent', 'Test') RETURNING id`;
    const r = await withSchool(school, (tx) =>
      collect(tx, director, p.id, [
        { method: "cheque", amountCents: 7000, date: TODAY, reference, issuer: null, plannedPayment: null },
      ]),
    );
    if (!r.ok) throw new Error(r.message);
    return r.ids[0];
  }
  const deposit = (paymentId: string) =>
    withSchool(school, (tx) =>
      createDeposit(tx, director, { date: TODAY, method: "cheque", paymentIds: [paymentId] }, TODAY),
    );

  it("a deposit waits for a full correction of its cheque, then refuses it", async () => {
    const cheque = await newCheque("0247a");
    const [corrected, deposited] = await overlapping(
      admin,
      (hold) =>
        withSchool(school, async (tx) => {
          const r = await correctPayment(tx, director, cheque, 7000, TODAY);
          await hold();
          return r;
        }),
      () => deposit(cheque),
    );
    expect(corrected.ok).toBe(true);
    expect(deposited).toEqual({ ok: false, message: NOT_DEPOSITABLE });
  });

  it("two deposits of the same cheque: the second is refused with a message, not an error", async () => {
    const cheque = await newCheque("0247b");
    const [first, second] = await overlapping(
      admin,
      (hold) =>
        withSchool(school, async (tx) => {
          const r = await createDeposit(tx, director, { date: TODAY, method: "cheque", paymentIds: [cheque] }, TODAY);
          await hold();
          return r;
        }),
      () => deposit(cheque),
    );
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, message: NOT_DEPOSITABLE });
  });

  it("a deposit cancelled while a rejection of its cheque is saved: the cancellation is refused (#253)", async () => {
    const cheque = await newCheque("0253c");
    const d = await deposit(cheque);
    if (!d.ok) throw new Error(d.message);
    const [rejected, cancelled] = await overlapping(
      admin,
      (hold) =>
        withSchool(school, async (tx) => {
          const r = await correctPayment(tx, director, cheque, 7000, TODAY, TODAY);
          await hold();
          return r;
        }),
      () => withSchool(school, (tx) => cancelDeposit(tx, director, d.id)),
    );
    expect(rejected.ok).toBe(true);
    expect(cancelled).toEqual({ ok: false, message: REVERSED });
    expect(await withSchool(school, (tx) => readDeposit(tx, d.id))).toMatchObject({ count: 1, totalCents: 7000 });
  });

  it("a rejection whose transaction started before the deposit still keeps the deposit from being cancelled", async () => {
    const cheque = await newCheque("0253h");
    let depositId = "";
    // T1 starts (its submission row is written, so its timestamps are older than the
    // deposit's), T2 deposits the cheque and commits, then T1 records the rejection.
    const [rejected, deposited] = await overlapping(
      admin,
      (hold) =>
        withSchool(school, (tx) =>
          once(tx, "payment", randomUUID(), { cheque }, storedPayments, async () => {
            await hold();
            return correctPayment(tx, director, cheque, 7000, TODAY, TODAY);
          }),
        ),
      async () => {
        const d = await deposit(cheque);
        if (d.ok) depositId = d.id;
        return d;
      },
    );
    expect(deposited.ok).toBe(true);
    expect(rejected.ok).toBe(true);
    expect(await withSchool(school, (tx) => cancelDeposit(tx, director, depositId))).toEqual({
      ok: false,
      message: REVERSED,
    });
  });

  it("a rejection saved while its deposit is cancelled finds no deposit and is refused", async () => {
    const cheque = await newCheque("0253i");
    const d = await deposit(cheque);
    if (!d.ok) throw new Error(d.message);
    const [cancelled, rejected] = await overlapping(
      admin,
      (hold) =>
        withSchool(school, async (tx) => {
          const r = await cancelDeposit(tx, director, d.id);
          await hold();
          return r;
        }),
      () => withSchool(school, (tx) => correctPayment(tx, director, cheque, 7000, TODAY, TODAY)),
    );
    expect(cancelled.ok).toBe(true);
    expect(rejected).toEqual({
      ok: false,
      message: "Ce paiement n’est plus dans une remise en banque : rechargez la fiche.",
    });
  });
});

const REVERSED = "Un paiement de cette remise a été rejeté : la remise ne peut plus être annulée.";

describe("a deposited payment rejected (#253)", () => {
  async function newCheque(reference: string): Promise<string> {
    const [p] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzrejet', 'Test') RETURNING id`;
    const r = await withSchool(school, (tx) =>
      collect(tx, director, p.id, [
        { method: "cheque", amountCents: 7000, date: TODAY, reference, issuer: null, plannedPayment: null },
      ]),
    );
    if (!r.ok) throw new Error(r.message);
    return r.ids[0];
  }
  const deposit = async (paymentId: string) => {
    const d = await withSchool(school, (tx) =>
      createDeposit(tx, director, { date: TODAY, method: "cheque", paymentIds: [paymentId] }, TODAY),
    );
    if (!d.ok) throw new Error(d.message);
    return d.id;
  };

  it("partly corrected before the deposit, then rejected for the rest; the deposit can no longer be cancelled", async () => {
    const cheque = await newCheque("0253d");
    expect((await withSchool(school, (tx) => correctPayment(tx, director, cheque, 2000, TODAY))).ok).toBe(true);
    // A correction made before the deposit does not hold the deposit.
    const first = await deposit(cheque);
    expect(await withSchool(school, (tx) => readDeposit(tx, first))).toMatchObject({ totalCents: 7000 });
    expect((await withSchool(school, (tx) => cancelDeposit(tx, director, first))).ok).toBe(true);
    const second = await deposit(cheque);

    // A bank rejects the whole cheque: only what is left (50,00 €) is accepted.
    expect(await withSchool(school, (tx) => correctPayment(tx, director, cheque, 4000, TODAY, TODAY))).toEqual({
      ok: false,
      message: `Un rejet porte sur tout le montant restant (${formatEuros(5000)}) : rechargez la fiche.`,
    });
    const r = await withSchool(school, (tx) => correctPayment(tx, director, cheque, 5000, TODAY, TODAY));
    expect(r.ok).toBe(true);

    expect(await withSchool(school, (tx) => cancelDeposit(tx, director, second))).toEqual({
      ok: false,
      message: REVERSED,
    });
    expect(await withSchool(school, (tx) => readDeposit(tx, second))).toMatchObject({ count: 1, totalCents: 7000 });
  });

  it("the payment log shows the rejection on its own day, nets the totals and exports it", async () => {
    const older = await newCheque("0253f");
    const [{ id: payerId }] = await admin`SELECT payer_id AS id FROM payment WHERE id = ${older}`;
    // Received and deposited on 20/10, rejected on 21/10.
    const earlier = await withSchool(school, (tx) =>
      collect(tx, director, payerId, [
        {
          method: "cheque",
          amountCents: 6000,
          date: "2026-10-20",
          reference: "0253g",
          issuer: null,
          plannedPayment: null,
        },
      ]),
    );
    if (!earlier.ok) throw new Error(earlier.message);
    const [received] = earlier.ids;
    const d = await withSchool(school, (tx) =>
      createDeposit(tx, director, { date: "2026-10-20", method: "cheque", paymentIds: [received] }, TODAY),
    );
    if (!d.ok) throw new Error(d.message);
    const rejected = await withSchool(school, (tx) => correctPayment(tx, director, received, 6000, TODAY, TODAY));
    if (!rejected.ok) throw new Error(rejected.message);

    const ofPayer = <T extends { payerId: string }>(rows: T[]) => rows.filter((l) => l.payerId === payerId);
    const day20 = ofPayer(await withSchool(school, (tx) => paymentLog(tx, "2026-10-20", "2026-10-20", null)));
    expect(day20.map((l) => l.amountCents)).toEqual([6000]);
    const day21 = ofPayer(await withSchool(school, (tx) => paymentLog(tx, TODAY, TODAY, null)));
    expect(day21.map((l) => [l.amountCents, l.reference])).toContainEqual([-6000, "Paiement rejeté"]);
    const both = ofPayer(await withSchool(school, (tx) => paymentLog(tx, "2026-10-20", TODAY, null)));
    // The received cheque 0253f (70,00 €) stays; the rejected one nets to zero.
    expect(totals(both).total).toBe(7000);

    const csv = toCsv(
      both.map((l) => ({
        date: l.date,
        payer: l.payer,
        method: PAYMENT_METHODS[l.method],
        amountCents: l.amountCents,
        reference: l.reference,
        issuer: l.issuer,
        plannedPayment: l.plannedPayment,
        deposit: l.dateDeposit,
      })),
    );
    expect(csv).toContain("21/10/2026;Test Zzrejet;Chèque;-60,00;Paiement rejeté;;;");
    expect(csv).toContain("20/10/2026;Test Zzrejet;Chèque;60,00;0253g;;;20/10/2026");
  });

  it("a « Corriger » form opened before the deposit is refused once the payment is deposited", async () => {
    const cheque = await newCheque("0253j");
    await deposit(cheque);
    expect(await withSchool(school, (tx) => correctPayment(tx, director, cheque, 7000, TODAY))).toEqual({
      ok: false,
      message: "Ce paiement a été remis en banque : rechargez la fiche.",
    });
  });

  it("a deposit dated after today cannot be rejected yet", async () => {
    const cheque = await newCheque("0253k");
    const d = await withSchool(school, (tx) =>
      createDeposit(tx, director, { date: "2026-10-25", method: "cheque", paymentIds: [cheque] }, TODAY),
    );
    if (!d.ok) throw new Error(d.message);
    expect(await withSchool(school, (tx) => correctPayment(tx, director, cheque, 7000, TODAY, TODAY))).toEqual({
      ok: false,
      message: "La remise est datée du 25/10/2026 : un rejet ne peut être enregistré qu’à partir de cette date.",
    });
  });
});
