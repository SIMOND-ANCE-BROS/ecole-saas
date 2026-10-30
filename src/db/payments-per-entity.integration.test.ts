import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { defaultEntityFor } from "./billing-entity.integration-helpers";
import { balanceOf, collect, correctPayment, ENTITY_REQUIRED, paymentsOf } from "./payments";
import { createDeposit, listDeposits, paymentLog, paymentsToDeposit, readDeposit } from "./deposits";
import { toCsv } from "../domain/payments/deposits";
import { exportRowOf } from "../domain/payments/payment-log";
import { PAYMENT_METHODS } from "./payments";

/**
 * Payments, deposits and balances per billing entity (#300), as the application runs
 * them (app_user, RLS), for a school of two businesses: each cashes into its own
 * account, so a payment, a slip and a balance belong to one entity. Fictitious data
 * deleted at the end; payments and the audit log being immutable, the cleanup disables
 * their triggers for the duration of an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const frontDesk = `ent-accueil-${suffix}`;
const director = `ent-direction-${suffix}`;
const TODAY = "2026-10-21";
let school: string;
let otherSchool: string;
let danse: string;
let studio: string;
let closed: string;
let foreignEntity: string;
let payer: string;

const cheque = (amountCents: number, reference: string) => ({
  method: "cheque" as const,
  amountCents,
  date: TODAY,
  reference,
  issuer: null,
  plannedPayment: null,
});

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zz', ${`ea-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École Zy', ${`eb-${suffix}`}) RETURNING id`;
  danse = await defaultEntityFor(admin, school, "Zz Danse");
  [{ id: studio }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, bank_account_label)
    VALUES (${school}, 'Zz Studio', 'Zz Studio EI', 'not_applicable', 'Compte Zz Studio') RETURNING id`;
  [{ id: closed }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, active)
    VALUES (${school}, 'Zz Fermée', 'Zz Fermée', 'not_applicable', false) RETURNING id`;
  foreignEntity = await defaultEntityFor(admin, otherSchool, "Zy Ailleurs");
  for (const [id, role] of [
    [frontDesk, "front_desk"],
    [director, "director"],
  ] as const) {
    await admin`INSERT INTO "user" (id, name, email) VALUES (${id}, 'Zz Test', ${`${id}@exemple.test`})`;
    await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${id}, ${role})`;
  }
  [{ id: payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzfamille', 'Zoé') RETURNING id`;
  const [s] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  // Owes 300 € to Zz Danse and 500 € to Zz Studio.
  await admin`INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents) VALUES (${school}, ${danse}, ${s.id}, ${payer}, 'child', 'year', 30000)`;
  await admin`INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents) VALUES (${school}, ${studio}, ${s.id}, ${payer}, 'child', 'year', 50000)`;
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

describe("payments per billing entity (#300)", () => {
  let studioCheque: string;
  let danseCheque: string;

  it("with several entities, a payment names the one that cashes it", async () => {
    expect(await withSchool(school, (tx) => collect(tx, frontDesk, payer, [cheque(10000, "0001")]))).toEqual({
      ok: false,
      message: ENTITY_REQUIRED,
    });
    for (const refused of [closed, foreignEntity])
      expect(await withSchool(school, (tx) => collect(tx, frontDesk, payer, [cheque(10000, "0001")], refused))).toEqual(
        { ok: false, message: "Entreprise introuvable ou inactive." },
      );
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM payment WHERE school_id = ${school}`;
    expect(n).toBe(0);
  });

  it("records the payment on the chosen entity, with its trace", async () => {
    const s = await withSchool(school, (tx) => collect(tx, frontDesk, payer, [cheque(20000, "0002")], studio));
    if (!s.ok) throw new Error(s.message);
    [studioCheque] = s.ids;
    const d = await withSchool(school, (tx) => collect(tx, frontDesk, payer, [cheque(30000, "0003")], danse));
    if (!d.ok) throw new Error(d.message);
    [danseCheque] = d.ids;
    const rows = await admin`SELECT id, billing_entity_id AS entity FROM payment WHERE school_id = ${school}`;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.entity]))).toEqual({
      [studioCheque]: studio,
      [danseCheque]: danse,
    });
    const [trace] =
      await admin`SELECT after->>'billing_entity_id' AS entity FROM audit_log WHERE row_id = ${studioCheque}`;
    expect(trace.entity).toBe(studio);
    expect((await withSchool(school, (tx) => paymentsOf(tx, payer))).map((p) => p.entity).sort()).toEqual([
      "Zz Danse",
      "Zz Studio",
    ]);
  });

  it("the balance per entity, in the school's order, and the family total", async () => {
    const b = await withSchool(school, (tx) => balanceOf(tx, payer, TODAY));
    expect(b?.severalEntities).toBe(true);
    expect(b?.byEntity.map((e) => [e.name, e.balance.due, e.balance.paid, e.balance.remaining])).toEqual([
      ["Zz Danse", 30000, 30000, 0],
      ["Zz Studio", 50000, 20000, 30000],
    ]);
    expect(b?.total).toMatchObject({ due: 80000, paid: 50000, remaining: 30000 });
  });

  it("payments to deposit are grouped by entity, then method", async () => {
    const groups = await withSchool(school, (tx) => paymentsToDeposit(tx, TODAY));
    expect(groups.map((g) => [g.billingEntityId, g.method, g.payments.map((p) => p.id)])).toEqual([
      [danse, "cheque", [danseCheque]],
      [studio, "cheque", [studioCheque]],
    ]);
  });

  it("a slip never mixes two entities, nor goes to another entity than its payments'", async () => {
    const mixed = await withSchool(school, (tx) =>
      createDeposit(tx, frontDesk, { date: TODAY, method: "cheque", paymentIds: [danseCheque, studioCheque] }, TODAY),
    );
    expect(mixed).toEqual({ ok: false, message: "Une remise ne regroupe que les paiements d’une même entreprise." });
    const stale = await withSchool(school, (tx) =>
      createDeposit(
        tx,
        frontDesk,
        { date: TODAY, method: "cheque", paymentIds: [studioCheque], billingEntityId: danse },
        TODAY,
      ),
    );
    expect(stale.ok).toBe(false);
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM bank_deposit WHERE school_id = ${school}`;
    expect(n).toBe(0);
  });

  it("the slip carries its entity, prints its legal name and account label", async () => {
    const r = await withSchool(school, (tx) =>
      createDeposit(
        tx,
        frontDesk,
        { date: TODAY, method: "cheque", paymentIds: [studioCheque], billingEntityId: studio },
        TODAY,
      ),
    );
    if (!r.ok) throw new Error(r.message);
    const [row] = await admin`SELECT billing_entity_id AS entity FROM bank_deposit WHERE id = ${r.id}`;
    expect(row.entity).toBe(studio);
    expect(await withSchool(school, (tx) => readDeposit(tx, r.id))).toMatchObject({
      entity: "Zz Studio",
      legalName: "Zz Studio EI",
      bankAccountLabel: "Compte Zz Studio",
      count: 1,
      totalCents: 20000,
    });
    expect((await withSchool(school, (tx) => listDeposits(tx))).map((d) => d.entity)).toEqual(["Zz Studio"]);
  });

  it("a rejected cheque is reversed on its own entity and reopens that entity's balance only", async () => {
    const r = await withSchool(school, (tx) => correctPayment(tx, director, studioCheque, 20000, TODAY, TODAY));
    if (!r.ok) throw new Error(r.message);
    const [row] =
      await admin`SELECT billing_entity_id AS entity, reversal_kind AS kind FROM payment WHERE id = ${r.ids[0]}`;
    expect(row).toEqual({ entity: studio, kind: "rejection" });
    const b = await withSchool(school, (tx) => balanceOf(tx, payer, TODAY));
    expect(b?.byEntity.map((e) => [e.name, e.balance.remaining])).toEqual([
      ["Zz Danse", 0],
      ["Zz Studio", 50000],
    ]);
  });

  it("the payment log and its CSV name the entity, in the last column", async () => {
    const log = await withSchool(school, (tx) => paymentLog(tx, TODAY, TODAY, null));
    expect(log.map((l) => [l.amountCents, l.entity])).toEqual([
      [20000, "Zz Studio"],
      [30000, "Zz Danse"],
      [-20000, "Zz Studio"],
    ]);
    const csv = toCsv(log.map((l) => exportRowOf({ ...l, methodLabel: PAYMENT_METHODS[l.method] })));
    const lines = csv
      .slice(1)
      .split("\r\n")
      .filter((l) => l !== "");
    expect(lines[0].endsWith(";Entreprise")).toBe(true);
    expect(lines.slice(1).map((l) => l.split(";").at(-1))).toEqual(["Zz Studio", "Zz Danse", "Zz Studio"]);
  });

  it("another school sees none of it", async () => {
    expect(await withSchool(otherSchool, (tx) => paymentsToDeposit(tx, TODAY))).toEqual([]);
    expect(await withSchool(otherSchool, (tx) => paymentLog(tx, TODAY, TODAY, null))).toEqual([]);
    expect(await withSchool(otherSchool, (tx) => balanceOf(tx, payer, TODAY))).toBeNull();
  });
});
