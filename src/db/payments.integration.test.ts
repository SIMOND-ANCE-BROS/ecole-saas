import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { overlapping } from "./overlap.integration-helpers";
import { correctPayment, collect, paymentsOf, balanceOf } from "./payments";
import { createDeposit, paymentsToDeposit, readDeposit } from "./deposits";

/**
 * Payments (#97), as the application runs them (app_user, RLS). Fictitious data
 * deleted at the end; payments and the audit log being immutable, the cleanup
 * disables their triggers for the duration of an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const frontDesk = `pai-accueil-${suffix}`;
const director = `pai-direction-${suffix}`;
const TODAY = "2026-10-21";
let school: string;
let otherSchool: string;
let payer: string;
let foreign: string;
let bounced: string;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`pa-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`pb-${suffix}`}) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${frontDesk}, 'Accueil Test', ${`${frontDesk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${frontDesk}, 'front_desk')`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Direction Test', ${`${director}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${director}, 'director')`;
  [{ id: bounced }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzrejet', 'Zoé') RETURNING id`;
  [{ id: payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Martin', 'Sophie') RETURNING id`;
  [{ id: foreign }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${otherSchool}, 'Ailleurs', 'Paul') RETURNING id`;
  const [s] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  await admin`INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents) VALUES (${school}, ${s.id}, ${payer}, 'child', 'year', 30000)`;
  await admin`INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents, status) VALUES (${school}, ${s.id}, ${payer}, 'child', 'quarter', 9000, 'dropped')`;
  await admin`INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents) VALUES (${school}, ${s.id}, ${bounced}, 'child', 'year', 12000)`;
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
  for (const t of ["enrollment", "season", "person", "member"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM "user" WHERE id IN (${frontDesk}, ${director})`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const cheque = (amountCents: number, plannedPayment: string | null, reference: string) => ({
  method: "cheque" as const,
  amountCents: amountCents,
  date: TODAY,
  reference,
  issuer: null,
  plannedPayment: plannedPayment,
});

describe("collect", () => {
  let ids: string[] = [];

  it("three dated cheques: balance up to date, cheques to cash, audit log kept", async () => {
    const r = await withSchool(school, (tx) =>
      collect(tx, frontDesk, payer, [
        cheque(10000, null, "0001"),
        cheque(10000, "2027-01-05", "0002"),
        cheque(10000, "2027-04-05", "0003"),
      ]),
    );
    if (!r.ok) throw new Error(r.message);
    ids = r.ids;
    expect(await withSchool(school, (tx) => balanceOf(tx, payer, TODAY))).toEqual({
      due: 30000,
      paid: 30000,
      remaining: 0,
      toCollect: 20000,
      outsideCalculation: { dropped: 9000 },
    });
    const traces =
      await admin`SELECT action, after->>'montant_centimes' AS amount, actor IS NOT NULL AS signed FROM audit_log WHERE school_id = ${school} AND target_table = 'payment'`;
    expect(traces).toHaveLength(3);
    expect(traces.every((t) => t.action === "insert" && t.amount === "10000" && t.signed)).toBe(true);
  });

  it("rejects cash « à encaisser plus tard », a payer from another school, a non-member account", async () => {
    expect(
      await withSchool(school, (tx) =>
        collect(tx, frontDesk, payer, [{ ...cheque(5000, "2027-01-05", ""), method: "cash" }]),
      ),
    ).toEqual({
      ok: false,
      message: "Seul un chèque s’encaisse plus tard",
    });
    expect(await withSchool(school, (tx) => collect(tx, frontDesk, foreign, [cheque(5000, null, "x")]))).toEqual({
      ok: false,
      message: "Payeur introuvable.",
    });
    expect(await withSchool(school, (tx) => collect(tx, "inconnu", payer, [cheque(5000, null, "x")]))).toEqual({
      ok: false,
      message: "Accès refusé.",
    });
  });

  it("a payment can be neither updated nor deleted (trigger); it is fixed with a negative payment", async () => {
    await expect(admin`UPDATE payment SET amount_cents = 1 WHERE id = ${ids[0]}`).rejects.toThrow(/cannot be modified/);
    await expect(admin`DELETE FROM payment WHERE id = ${ids[0]}`).rejects.toThrow(/cannot be deleted/);
    // Only exception: the invoicing tool sync flag.
    await expect(admin`UPDATE payment SET tool_synced = true WHERE id = ${ids[0]}`).resolves.toBeDefined();
    await expect(admin`UPDATE payment SET tool_synced = false, amount_cents = 1 WHERE id = ${ids[0]}`).rejects.toThrow(
      /cannot be modified/,
    );
    expect((await withSchool(school, (tx) => correctPayment(tx, frontDesk, ids[0], 4000, TODAY))).ok).toBe(true);
    expect(await withSchool(school, (tx) => correctPayment(tx, frontDesk, ids[0], 7000, TODAY))).toEqual({
      ok: false,
      message: "La correction dépasse le montant encore non corrigé.",
    });
    const rows = await withSchool(school, (tx) => paymentsOf(tx, payer));
    const correction = rows.find((l) => l.correctedId === ids[0]);
    expect(correction).toMatchObject({
      amountCents: -4000,
      method: "cheque",
      reference: "Correction",
      enteredBy: "Accueil Test",
    });
    expect(rows.find((l) => l.id === ids[0])?.correctedCents).toBe(4000);
    expect(await withSchool(school, (tx) => correctPayment(tx, frontDesk, correction!.id, 100, TODAY))).toEqual({
      ok: false,
      message: "Ce paiement ne peut pas être corrigé.",
    });
    expect((await withSchool(school, (tx) => balanceOf(tx, payer, TODAY)))?.remaining).toBe(4000);
  });

  it("another school sees neither the payments nor the balance", async () => {
    expect(await withSchool(otherSchool, (tx) => paymentsOf(tx, payer))).toEqual([]);
    expect(await withSchool(otherSchool, (tx) => balanceOf(tx, payer, TODAY))).toBeNull();
    expect(await withSchool(otherSchool, (tx) => correctPayment(tx, frontDesk, ids[1], 100, TODAY))).toEqual({
      ok: false,
      message: "Ce paiement ne peut pas être corrigé.",
    });
  });
});

describe("correctPayment under concurrency (#247)", () => {
  it("two corrections saved at the same time never correct more than the payment", async () => {
    const r = await withSchool(school, (tx) => collect(tx, frontDesk, payer, [cheque(10000, null, "0247")]));
    if (!r.ok) throw new Error(r.message);
    const [id] = r.ids;

    // A corrects 60,00 € and stays open; B corrects 60,00 € meanwhile. Without the lock,
    // B reads the total before A commits and goes through at once.
    const [first, second] = await overlapping(
      admin,
      (hold) =>
        withSchool(school, async (tx) => {
          const result = await correctPayment(tx, frontDesk, id, 6000, TODAY);
          await hold();
          return result;
        }),
      () => withSchool(school, (tx) => correctPayment(tx, frontDesk, id, 6000, TODAY)),
    );

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, message: "La correction dépasse le montant encore non corrigé." });
    const rows = await withSchool(school, (tx) => paymentsOf(tx, payer));
    expect(rows.find((l) => l.id === id)?.correctedCents).toBe(6000);
  });
});

describe("a payment rejected after its bank deposit (#253)", () => {
  const RECEIVED = "2026-10-10";
  let id: string;
  let depositId: string;
  const reject = (who: string, rejectedOn: string | null, amountCents = 12000) =>
    withSchool(school, (tx) => correctPayment(tx, who, id, amountCents, TODAY, rejectedOn));

  beforeAll(async () => {
    const r = await withSchool(school, (tx) =>
      collect(tx, director, bounced, [{ ...cheque(12000, null, "0253"), date: RECEIVED }]),
    );
    if (!r.ok) throw new Error(r.message);
    [id] = r.ids;
    const d = await withSchool(school, (tx) =>
      createDeposit(tx, director, { date: "2026-10-12", method: "cheque", paymentIds: [id] }, TODAY),
    );
    if (!d.ok) throw new Error(d.message);
    depositId = d.id;
  });

  it("the payment shows as deposited and the payer owes nothing", async () => {
    expect((await withSchool(school, (tx) => paymentsOf(tx, bounced)))[0]).toMatchObject({ depositedOn: "2026-10-12" });
    expect((await withSchool(school, (tx) => balanceOf(tx, bounced, TODAY)))?.remaining).toBe(0);
  });

  it("front desk is refused, with or without a date", async () => {
    const refused = {
      ok: false,
      message: "Seule la direction peut enregistrer un paiement rejeté après sa remise en banque.",
    };
    expect(await reject(frontDesk, "2026-10-20")).toEqual(refused);
    expect(await reject(frontDesk, null)).toEqual(refused);
  });

  it("refuses a rejection dated before the payment or after today", async () => {
    expect(await reject(director, "2026-10-09")).toEqual({
      ok: false,
      message: "Le rejet ne peut pas précéder la réception du paiement.",
    });
    expect(await reject(director, "2026-10-22")).toEqual({
      ok: false,
      message: "Le rejet ne peut pas être daté après aujourd’hui.",
    });
  });

  it("management records it on its own date; the deposit slip stays as printed; the amount is due again", async () => {
    const r = await reject(director, "2026-10-20");
    if (!r.ok) throw new Error(r.message);
    const rows = await withSchool(school, (tx) => paymentsOf(tx, bounced));
    expect(rows.find((p) => p.id === r.ids[0])).toMatchObject({
      date: "2026-10-20",
      amountCents: -12000,
      method: "cheque",
      reference: "Paiement rejeté",
      correctedId: id,
      depositedOn: null,
      enteredBy: "Direction Test",
    });
    expect(rows.find((p) => p.id === id)).toMatchObject({ correctedCents: 12000, depositedOn: "2026-10-12" });

    const slip = await withSchool(school, (tx) => readDeposit(tx, depositId));
    expect(slip).toMatchObject({ date: "2026-10-12", count: 1, totalCents: 12000 });
    expect(slip?.payments.map((p) => p.id)).toEqual([id]);
    // Nothing new to deposit: the rejection is a negative entry, never on a slip.
    const pending = await withSchool(school, (tx) => paymentsToDeposit(tx, TODAY));
    expect(
      Object.values(pending)
        .flat()
        .map((p) => p.id),
    ).not.toContain(r.ids[0]);

    expect(await withSchool(school, (tx) => balanceOf(tx, bounced, TODAY))).toMatchObject({
      due: 12000,
      paid: 0,
      remaining: 12000,
    });
    const [trace] =
      await admin`SELECT after->>'rejected' AS rejected, after->>'bank_deposit_id' AS deposit, after->>'date' AS date FROM audit_log WHERE row_id = ${r.ids[0]}`;
    expect(trace).toEqual({ rejected: "true", deposit: depositId, date: "2026-10-20" });
  });

  it("nothing is left to reject once the whole amount is", async () => {
    expect(await reject(director, TODAY, 1)).toEqual({
      ok: false,
      message: "La correction dépasse le montant encore non corrigé.",
    });
  });

  it("a payment that is not deposited takes no rejection date and is corrected today", async () => {
    const r = await withSchool(school, (tx) => collect(tx, director, bounced, [cheque(3000, null, "0254")]));
    if (!r.ok) throw new Error(r.message);
    expect(await withSchool(school, (tx) => correctPayment(tx, director, r.ids[0], 3000, TODAY, "2026-10-21"))).toEqual(
      { ok: false, message: "Ce paiement n’est plus dans une remise en banque : rechargez la fiche." },
    );
    const c = await withSchool(school, (tx) => correctPayment(tx, frontDesk, r.ids[0], 3000, TODAY));
    if (!c.ok) throw new Error(c.message);
    expect((await withSchool(school, (tx) => paymentsOf(tx, bounced))).find((p) => p.id === c.ids[0])).toMatchObject({
      date: TODAY,
      reference: "Correction",
    });
  });
});
