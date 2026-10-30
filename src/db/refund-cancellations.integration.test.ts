import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { defaultEntityFor } from "./billing-entity.integration-helpers";
import { overlapping } from "./overlap.integration-helpers";
import { balanceOf, cancelRefundPayment, collect, correctPayment, paymentsOf, refundPayer } from "./payments";
import { createDeposit, paymentLog, paymentsToDeposit } from "./deposits";
import { once, storedPayments } from "./submissions";
import { totals } from "../domain/payments/deposits";
import { exportRowOf } from "../domain/payments/payment-log";
import { formatEuros } from "../lib/money";

/**
 * Cancelling a refund entered by mistake (#346) as the application runs it (app_user,
 * RLS): a family paid 280,00 € in cash and a works council transfer of 100,00 € on top;
 * the school recorded a refund of 100,00 € by cheque that never happened. Fictitious data
 * deleted at the end; payments and the audit log being immutable, the cleanup disables
 * their triggers inside an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const frontDesk = `annul-accueil-${suffix}`;
const director = `annul-direction-${suffix}`;
const TODAY = "2026-11-02";
let school: string;
let twoEntities: string;
let entity: string;
let danse: string;
let studio: string;
let family: string;
let twice: string;
let race: string;
let split: string;
let refundId: string;

const received = (amountCents: number, method: "cash" | "transfer") => ({
  method,
  amountCents,
  date: TODAY,
  reference: method === "transfer" ? "V0001" : null,
  issuer: null,
  plannedPayment: null,
});
const refund = (amountCents: number, method: "cheque" | "cash" | "transfer" = "cheque") => ({
  method,
  amountCents,
  date: "2026-10-30",
  reference: method === "cheque" ? "R0001" : null,
});

async function enroll(schoolId: string, entityId: string, payer: string, cents: number) {
  const [s] = await admin`
    INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${schoolId}, ${`2026-2027 ${Math.random()}`}, '2026-09-01', '2027-06-30') RETURNING id`;
  await admin`
    INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents)
    VALUES (${schoolId}, ${entityId}, ${s.id}, ${payer}, 'child', 'year', ${cents})`;
}

/** A payer overpaid by 100,00 €, collected, then refunded 100,00 € by mistake; returns the refund's id. */
async function overpaidThenRefunded(payer: string, method: "cheque" | "cash" | "transfer" = "cheque") {
  const paid = await withSchool(school, (tx) =>
    collect(tx, frontDesk, payer, [received(28000, "cash"), received(10000, "transfer")]),
  );
  if (!paid.ok) throw new Error(paid.message);
  const r = await withSchool(school, (tx) => refundPayer(tx, director, payer, refund(10000, method), TODAY));
  if (!r.ok) throw new Error(r.message);
  return r.ids[0];
}

const person = async (schoolId: string, lastName: string) =>
  (
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${schoolId}, ${lastName}, 'Zoé') RETURNING id`
  )[0].id as string;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zz', ${`ar-${suffix}`}) RETURNING id`;
  [{ id: twoEntities }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École Zy', ${`as-${suffix}`}) RETURNING id`;
  entity = await defaultEntityFor(admin, school);
  danse = await defaultEntityFor(admin, twoEntities, "Zy Danse");
  [{ id: studio }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime)
    VALUES (${twoEntities}, 'Zy Studio', 'Zy Studio EI', 'not_applicable') RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${frontDesk}, 'Accueil Zz', ${`${frontDesk}@exemple.test`})`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Direction Zz', ${`${director}@exemple.test`})`;
  for (const s of [school, twoEntities]) {
    await admin`INSERT INTO member (school_id, user_id, role) VALUES (${s}, ${frontDesk}, 'front_desk')`;
    await admin`INSERT INTO member (school_id, user_id, role) VALUES (${s}, ${director}, 'director')`;
  }
  family = await person(school, "Zzfamille");
  twice = await person(school, "Zzdeuxfois");
  race = await person(school, "Zzcourse");
  split = await person(twoEntities, "Zydeux");
  for (const p of [family, twice, race]) await enroll(school, entity, p, 28000);
  await enroll(twoEntities, danse, split, 20000);
  await enroll(twoEntities, studio, split, 30000);
  refundId = await overpaidThenRefunded(family);
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`DELETE FROM bank_deposit WHERE school_id IN (${school}, ${twoEntities})`;
    await t`ALTER TABLE payment DISABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${twoEntities})`;
    await t`DELETE FROM payment WHERE school_id IN (${school}, ${twoEntities}) AND corrects_id IS NOT NULL`;
    await t`DELETE FROM payment WHERE school_id IN (${school}, ${twoEntities})`;
    await t`ALTER TABLE payment ENABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of ["submission", "enrollment", "season", "person", "member"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, twoEntities]);
  await admin`DELETE FROM "user" WHERE id IN (${frontDesk}, ${director})`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${twoEntities})`;
  await admin.end();
});

const balance = async (payer: string) => (await withSchool(school, (tx) => balanceOf(tx, payer, TODAY)))?.total;
const cancel = (user: string, id: string, cents: number) =>
  withSchool(school, (tx) => cancelRefundPayment(tx, user, id, cents, TODAY));

describe("cancelling a refund entered by mistake (#346)", () => {
  it("starts from a settled balance once refunded", async () => {
    expect(await balance(family)).toMatchObject({ due: 28000, paid: 28000, remaining: 0 });
  });

  it("is refused to the front desk (management only, #346 question 1)", async () => {
    expect(await cancel(frontDesk, refundId, 10000)).toEqual({
      ok: false,
      message: "Seule la direction peut annuler un remboursement.",
    });
  });

  it("refuses more than the refund", async () => {
    expect(await cancel(director, refundId, 10001)).toEqual({
      ok: false,
      message: `L’annulation dépasse le montant du remboursement encore non annulé (${formatEuros(10000)}).`,
    });
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM payment WHERE corrects_id = ${refundId}`;
    expect(n).toBe(0);
  });

  it("cancels part of it with a positive reverse entry, same business, method and reference, dated today", async () => {
    const r = await cancel(director, refundId, 4000);
    if (!r.ok) throw new Error(r.message);
    const rows = await withSchool(school, (tx) => paymentsOf(tx, family));
    expect(rows.find((p) => p.id === r.ids[0])).toMatchObject({
      date: TODAY,
      amountCents: 4000,
      method: "cheque",
      reference: "R0001",
      reversalKind: "refund_cancellation",
      correctedId: refundId,
      depositedOn: null,
      enteredBy: "Direction Zz",
    });
    const [{ e }] = await admin`SELECT billing_entity_id AS e FROM payment WHERE id = ${r.ids[0]}`;
    expect(e).toBe(entity);
    // The refund itself is unchanged, its cancelled part read from the reverse entry.
    expect(rows.find((p) => p.id === refundId)).toMatchObject({ amountCents: -10000, correctedCents: 4000 });
    expect(await balance(family)).toMatchObject({ paid: 32000, remaining: -4000 });
  });

  it("then cancels all the rest; a further cancellation is refused", async () => {
    expect(await cancel(director, refundId, 6001)).toEqual({
      ok: false,
      message: `L’annulation dépasse le montant du remboursement encore non annulé (${formatEuros(6000)}).`,
    });
    const r = await cancel(director, refundId, 6000);
    if (!r.ok) throw new Error(r.message);
    expect(await balance(family)).toMatchObject({ paid: 38000, remaining: -10000 });
    expect(await cancel(director, refundId, 1)).toEqual({ ok: false, message: "Ce remboursement est déjà annulé." });
  });

  it("gives the overpayment back: it may be refunded again, collected", async () => {
    expect((await withSchool(school, (tx) => balanceOf(tx, family, TODAY)))?.refunds).toEqual([
      expect.objectContaining({ id: entity, overpaid: 10000, uncollected: 0, refundable: 10000 }),
    ]);
  });

  it("cancels only a refund: not an ordinary payment, nor a cancellation", async () => {
    const [p] = await admin`SELECT id FROM payment WHERE payer_id = ${family} AND reversal_kind IS NULL LIMIT 1`;
    const [c] = await admin`SELECT id FROM payment WHERE corrects_id = ${refundId} LIMIT 1`;
    for (const id of [p.id, c.id])
      expect(await cancel(director, id, 100)).toEqual({
        ok: false,
        message: "Ce paiement n’est pas un remboursement.",
      });
    expect(await cancel(director, "not-a-uuid", 100)).toEqual({
      ok: false,
      message: "Ce remboursement n’existe plus.",
    });
    // A refund or its cancellation is never corrected as a payment either.
    for (const id of [refundId, c.id])
      expect(await withSchool(school, (tx) => correctPayment(tx, director, id, 100, TODAY))).toEqual({
        ok: false,
        message: "Ce paiement ne peut pas être corrigé.",
      });
  });

  it("never reaches a refund of another school", async () => {
    expect(await withSchool(twoEntities, (tx) => cancelRefundPayment(tx, director, refundId, 100, TODAY))).toEqual({
      ok: false,
      message: "Ce remboursement n’existe plus.",
    });
  });

  it("leaves a trace with technical ids only", async () => {
    const rows = await admin`
      SELECT a.after FROM audit_log a JOIN payment p ON p.id = a.row_id
      WHERE p.corrects_id = ${refundId} ORDER BY p.amount_cents`;
    const trace = (cents: number) => ({
      montant_centimes: cents,
      method: "cheque",
      date: TODAY,
      corrige_id: refundId,
      reversal_kind: "refund_cancellation",
      billing_entity_id: entity,
    });
    expect(rows.map((r) => r.after)).toEqual([trace(4000), trace(6000)]);
  });

  it("is never offered for a bank deposit, nor accepted on one", async () => {
    const groups = await withSchool(school, (tx) => paymentsToDeposit(tx, TODAY));
    const mine = groups.flatMap((g) => g.payments.filter((p) => p.payerId === family));
    // The cash received is to deposit; neither the refund cheque nor its cancellations.
    expect(mine.map((p) => [p.method, p.amountCents])).toEqual([["cash", 28000]]);
    const ids = (await admin`SELECT id FROM payment WHERE corrects_id = ${refundId}`).map((p) => p.id as string);
    expect(
      await withSchool(school, (tx) =>
        createDeposit(tx, director, { date: TODAY, method: "cheque", paymentIds: ids }, TODAY),
      ),
    ).toEqual({
      ok: false,
      message:
        "Un des paiements choisis n’est plus à remettre (déjà remis, corrigé, pas encore à encaisser ou d’un autre moyen).",
    });
  });

  it("nets out with the refunds in the payment log, never in a method's total", async () => {
    const log = await withSchool(school, (tx) => paymentLog(tx, "2026-10-01", TODAY, null));
    const mine = log.filter((l) => l.payerId === family);
    expect(totals(mine)).toEqual({ total: 38000, byMethod: { cash: 28000, transfer: 10000 }, refunded: 0 });
    expect(
      mine
        .filter((l) => l.reversalKind === "refund_cancellation")
        .map((l) => exportRowOf({ ...l, methodLabel: l.method }).reference),
    ).toEqual(["Annulation de remboursement, R0001", "Annulation de remboursement, R0001"]);
  });

  it("in a period without its refund, totals as refunds cancelled", async () => {
    const log = await withSchool(school, (tx) => paymentLog(tx, TODAY, TODAY, null));
    const mine = log.filter((l) => l.payerId === family);
    // The refund is dated 30/10, its cancellations today: only these are in the period.
    expect(totals(mine)).toEqual({ total: 48000, byMethod: { cash: 28000, transfer: 10000 }, refunded: 10000 });
  });

  it("is refused by the database without the refund it cancels, or negative", async () => {
    await expect(admin`
      INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, reversal_kind)
      VALUES (${school}, ${entity}, ${family}, 100, 'cheque', 'refund_cancellation')`).rejects.toThrow(
      /payment_reversal_kind/,
    );
    await expect(admin`
      INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, corrects_id, reversal_kind)
      VALUES (${school}, ${entity}, ${family}, -100, 'cheque', ${refundId}, 'refund_cancellation')`).rejects.toThrow(
      /payment_sign/,
    );
    // A positive correction stays refused: only a refund's cancellation is a positive reverse entry.
    await expect(admin`
      INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, corrects_id, reversal_kind)
      VALUES (${school}, ${entity}, ${family}, 100, 'cheque', ${refundId}, 'correction')`).rejects.toThrow(
      /payment_sign/,
    );
  });
});

describe("a cancellation sent twice (#260)", () => {
  it("records it once, and replays the first result", async () => {
    const id = await overpaidThenRefunded(twice, "transfer");
    const key = crypto.randomUUID();
    const send = () =>
      withSchool(school, (tx) =>
        once(tx, "payment", key, { cancelRefund: { refundId: id, amountCents: 10000 } }, storedPayments, () =>
          cancelRefundPayment(tx, director, id, 10000, TODAY),
        ),
      );
    const r = await send();
    if (!r.ok) throw new Error(r.message);
    expect(await send()).toEqual(r);
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM payment WHERE corrects_id = ${id}`;
    expect(n).toBe(1);
  });
});

describe("cancellations under concurrency", () => {
  it("two cancellations saved at the same time never cancel more than the refund", async () => {
    const id = await overpaidThenRefunded(race, "cash");
    const [first, second] = await overlapping(
      admin,
      (hold) =>
        withSchool(school, async (tx) => {
          const result = await cancelRefundPayment(tx, director, id, 10000, TODAY);
          await hold();
          return result;
        }),
      () => withSchool(school, (tx) => cancelRefundPayment(tx, director, id, 10000, TODAY)),
    );
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, message: "Ce remboursement est déjà annulé." });
    expect((await balance(race))?.remaining).toBe(-10000);
  });

  it("a cancellation and a new refund at the same time: the refund waits and sees the overpayment again", async () => {
    // `race` is overpaid by 100 € again; its refund of 100 € cancelled, then refunded once more.
    const r = await withSchool(school, (tx) => refundPayer(tx, director, race, refund(10000, "cash"), TODAY));
    if (!r.ok) throw new Error(r.message);
    const [first, second] = await overlapping(
      admin,
      (hold) =>
        withSchool(school, async (tx) => {
          const result = await cancelRefundPayment(tx, director, r.ids[0], 10000, TODAY);
          await hold();
          return result;
        }),
      () => withSchool(school, (tx) => refundPayer(tx, director, race, refund(10000, "cash"), TODAY)),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect((await balance(race))?.remaining).toBe(0);
  });
});

describe("cancelling a refund with several entities (#300)", () => {
  it("belongs to the refund's business, which the database enforces", async () => {
    // Danse received 150 € too much; it refunded 150 € by mistake.
    const paid = await withSchool(twoEntities, (tx) =>
      collect(tx, director, split, [received(35000, "transfer")], danse),
    );
    if (!paid.ok) throw new Error(paid.message);
    const r = await withSchool(twoEntities, (tx) =>
      refundPayer(tx, director, split, refund(15000, "transfer"), TODAY, danse),
    );
    if (!r.ok) throw new Error(r.message);
    const c = await withSchool(twoEntities, (tx) => cancelRefundPayment(tx, director, r.ids[0], 15000, TODAY));
    if (!c.ok) throw new Error(c.message);
    const [{ e }] = await admin`SELECT billing_entity_id AS e FROM payment WHERE id = ${c.ids[0]}`;
    expect(e).toBe(danse);
    const b = await withSchool(twoEntities, (tx) => balanceOf(tx, split, TODAY));
    expect(b?.byEntity.map((x) => [x.name, x.balance.remaining])).toEqual([
      ["Zy Danse", -15000],
      ["Zy Studio", 30000],
    ]);
    // A cancellation filed under the other business is refused by the composite key.
    await expect(admin`
      INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, corrects_id, reversal_kind)
      VALUES (${twoEntities}, ${studio}, ${split}, 100, 'transfer', ${r.ids[0]}, 'refund_cancellation')`).rejects.toThrow(
      /payment_corrects_same_entity_fk|foreign key/,
    );
  });
});
