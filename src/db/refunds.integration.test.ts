import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { defaultEntityFor } from "./billing-entity.integration-helpers";
import { overlapping } from "./overlap.integration-helpers";
import { balanceOf, collect, paymentsOf, REFUND_ENTITY_REQUIRED, refundPayer } from "./payments";
import { createDeposit, paymentLog, paymentsToDeposit } from "./deposits";
import { once, storedPayments } from "./submissions";
import { totals } from "../domain/payments/deposits";
import { exportRowOf } from "../domain/payments/payment-log";
import { formatEuros } from "../lib/money";

/**
 * Refunding a payer (#294) as the application runs it (app_user, RLS): a family paid
 * 280,00 €, then a works council cheque of 100,00 € for the same enrollment; the school
 * pays the family back. Fictitious data deleted at the end; payments and the audit log
 * being immutable, the cleanup disables their triggers inside an administration transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const frontDesk = `remb-accueil-${suffix}`;
const director = `remb-direction-${suffix}`;
const TODAY = "2026-11-02";
let school: string;
let twoEntities: string;
let entity: string;
let danse: string;
let studio: string;
let family: string;
let other: string;
let split: string;
let late: string;

// Cash in hand or a transfer is collected when recorded; a cheque once deposited.
const cash = (amountCents: number, reference: string | null, method: "cash" | "transfer" = "cash") => ({
  method,
  amountCents,
  date: TODAY,
  reference,
  issuer: null,
  plannedPayment: null,
});
const cheque = (amountCents: number, reference: string, issuer: string | null = null) => ({
  method: "cheque" as const,
  amountCents,
  date: TODAY,
  reference,
  issuer,
  plannedPayment: null,
});
const refund = (amountCents: number, method: "cheque" | "cash" | "transfer" = "cheque", date = TODAY) => ({
  method,
  amountCents,
  date,
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

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École Zz', ${`ra-${suffix}`}) RETURNING id`;
  [{ id: twoEntities }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École Zy', ${`rb-${suffix}`}) RETURNING id`;
  entity = await defaultEntityFor(admin, school);
  danse = await defaultEntityFor(admin, twoEntities, "Zy Danse");
  [{ id: studio }] = await admin`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, active)
    VALUES (${twoEntities}, 'Zy Studio', 'Zy Studio EI', 'not_applicable', false) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${frontDesk}, 'Accueil Zz', ${`${frontDesk}@exemple.test`})`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Direction Zz', ${`${director}@exemple.test`})`;
  for (const s of [school, twoEntities]) {
    await admin`INSERT INTO member (school_id, user_id, role) VALUES (${s}, ${frontDesk}, 'front_desk')`;
    await admin`INSERT INTO member (school_id, user_id, role) VALUES (${s}, ${director}, 'director')`;
  }
  [{ id: family }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzfamille', 'Zoé') RETURNING id`;
  [{ id: other }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzautre', 'Zia') RETURNING id`;
  [{ id: split }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${twoEntities}, 'Zydeux', 'Zack') RETURNING id`;
  await enroll(school, entity, family, 28000);
  await enroll(school, entity, other, 28000);
  [{ id: late }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zztard', 'Zelie') RETURNING id`;
  await enroll(school, entity, late, 28000);
  await enroll(twoEntities, danse, split, 20000);
  await enroll(twoEntities, studio, split, 30000);
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

const remaining = async (payer: string) => (await withSchool(school, (tx) => balanceOf(tx, payer, TODAY)))?.total;

describe("refunding a payer after a works council cheque (#294)", () => {
  beforeAll(async () => {
    const paid = await withSchool(school, (tx) =>
      collect(tx, frontDesk, family, [cheque(28000, "0001"), cheque(10000, "0002", "CSE Zz")]),
    );
    if (!paid.ok) throw new Error(paid.message);
  });

  it("shows the overpayment before any refund", async () => {
    expect((await remaining(family))?.remaining).toBe(-10000);
  });

  it("pays nothing back out of cheques still in the drawer, until they are deposited", async () => {
    const refunds = async () => (await withSchool(school, (tx) => balanceOf(tx, family, TODAY)))?.refunds;
    expect(await refunds()).toEqual([expect.objectContaining({ id: entity, overpaid: 10000, refundable: 0 })]);
    expect(await withSchool(school, (tx) => refundPayer(tx, director, family, refund(10000), TODAY))).toEqual({
      ok: false,
      message: "Le trop-perçu n’est pas encore encaissé : remettez d’abord les chèques en banque.",
    });
    const ids = (await admin`SELECT id FROM payment WHERE payer_id = ${family}`).map((p) => p.id as string);
    const d = await withSchool(school, (tx) =>
      createDeposit(tx, frontDesk, { date: TODAY, method: "cheque", paymentIds: ids }, TODAY),
    );
    if (!d.ok) throw new Error(d.message);
    expect(await refunds()).toEqual([expect.objectContaining({ id: entity, overpaid: 10000, refundable: 10000 })]);
  });

  it("holds back an advance on an enrollment on trial", async () => {
    const [{ id: trial }] =
      await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzessai', 'Zack') RETURNING id`;
    const [s] = await admin`SELECT season_id AS id FROM enrollment WHERE payer_id = ${family}`;
    await admin`
      INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents, status)
      VALUES (${school}, ${entity}, ${s.id}, ${trial}, 'child', 'year', 28000, 'trial')`;
    const r = await withSchool(school, (tx) => collect(tx, frontDesk, trial, [cash(38000, null)]));
    if (!r.ok) throw new Error(r.message);
    // Nothing due yet: 380 € overpaid, of which 280 € is held for the trial enrollment.
    expect((await withSchool(school, (tx) => balanceOf(tx, trial, TODAY)))?.refunds).toEqual([
      expect.objectContaining({ overpaid: 38000, held: 28000, uncollected: 0, refundable: 10000 }),
    ]);
    expect(await withSchool(school, (tx) => refundPayer(tx, director, trial, refund(10001, "cash"), TODAY))).toEqual({
      ok: false,
      message: `Le remboursement dépasse ce qui peut être remboursé (${formatEuros(10000)}) : le reste attend l’encaissement de chèques ou couvre une inscription à l’essai ou en liste d’attente.`,
    });
    expect((await withSchool(school, (tx) => refundPayer(tx, director, trial, refund(10000, "cash"), TODAY))).ok).toBe(
      true,
    );
    expect(await withSchool(school, (tx) => refundPayer(tx, director, trial, refund(100, "cash"), TODAY))).toEqual({
      ok: false,
      message:
        "Le trop-perçu couvre une inscription à l’essai ou en liste d’attente : rien à rembourser avant qu’elle soit confirmée ou annulée.",
    });
  });

  it("pays nothing back out of a cheque to cash later", async () => {
    const r = await withSchool(school, (tx) =>
      collect(tx, frontDesk, late, [cash(28000, null), { ...cheque(5000, "0007"), plannedPayment: "2026-12-01" }]),
    );
    if (!r.ok) throw new Error(r.message);
    expect(await withSchool(school, (tx) => refundPayer(tx, director, late, refund(5000), TODAY))).toEqual({
      ok: false,
      message: "Le trop-perçu n’est pas encore encaissé : remettez d’abord les chèques en banque.",
    });
  });

  it("is refused to the front desk, and to anyone with nothing overpaid", async () => {
    expect(await withSchool(school, (tx) => refundPayer(tx, frontDesk, family, refund(10000), TODAY))).toEqual({
      ok: false,
      message: "Seule la direction peut rembourser un payeur.",
    });
    expect(await withSchool(school, (tx) => refundPayer(tx, director, other, refund(100), TODAY))).toEqual({
      ok: false,
      message: "Rien à rembourser : ce payeur n’a pas de trop-perçu.",
    });
  });

  it("refuses a refund larger than the overpayment", async () => {
    expect(await withSchool(school, (tx) => refundPayer(tx, director, family, refund(10001), TODAY))).toEqual({
      ok: false,
      message: `Le remboursement dépasse le trop-perçu (${formatEuros(10000)}) : rechargez la fiche.`,
    });
  });

  it("refuses a method a refund is not paid by, and a day after today", async () => {
    expect(
      await withSchool(school, (tx) =>
        refundPayer(tx, director, family, { ...refund(1000), method: "card" as never }, TODAY),
      ),
    ).toEqual({ ok: false, message: "Choisissez comment vous remboursez." });
    expect(
      await withSchool(school, (tx) => refundPayer(tx, director, family, refund(1000, "cash", "2026-11-03"), TODAY)),
    ).toEqual({ ok: false, message: "Le remboursement ne peut pas être daté après aujourd’hui." });
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM payment WHERE payer_id = ${family} AND amount_cents < 0`;
    expect(n).toBe(0);
  });

  it("records a partial refund, the rest staying overpaid", async () => {
    const r = await withSchool(school, (tx) => refundPayer(tx, director, family, refund(4000, "cash"), TODAY));
    expect(r.ok).toBe(true);
    expect((await remaining(family))?.remaining).toBe(-6000);
  });

  it("then the rest, which settles the balance; the next one is refused", async () => {
    const r = await withSchool(school, (tx) => refundPayer(tx, director, family, refund(6000), TODAY));
    if (!r.ok) throw new Error(r.message);
    expect(await remaining(family)).toMatchObject({ due: 28000, paid: 28000, remaining: 0 });
    const rows = await withSchool(school, (tx) => paymentsOf(tx, family));
    expect(rows.find((p) => p.id === r.ids[0])).toMatchObject({
      amountCents: -6000,
      method: "cheque",
      reference: "R0001",
      reversalKind: "refund",
      correctedId: null,
      depositedOn: null,
      enteredBy: "Direction Zz",
    });
    expect(await withSchool(school, (tx) => refundPayer(tx, director, family, refund(1), TODAY))).toEqual({
      ok: false,
      message: "Rien à rembourser : ce payeur n’a pas de trop-perçu.",
    });
  });

  it("leaves a trace with technical ids only", async () => {
    const rows = await admin`
      SELECT a.after FROM audit_log a JOIN payment p ON p.id = a.row_id
      WHERE p.payer_id = ${family} AND p.reversal_kind = 'refund' ORDER BY p.amount_cents`;
    expect(rows.map((r) => r.after)).toEqual([
      { montant_centimes: -6000, method: "cheque", date: TODAY, reversal_kind: "refund", billing_entity_id: entity },
      { montant_centimes: -4000, method: "cash", date: TODAY, reversal_kind: "refund", billing_entity_id: entity },
    ]);
  });

  it("never goes on a deposit slip, and shows apart in the log and its totals", async () => {
    const groups = await withSchool(school, (tx) => paymentsToDeposit(tx, TODAY));
    // The family's two cheques are on their slip; the refund cheque and cash are on none.
    const toDeposit = groups.flatMap((g) => g.payments.filter((p) => p.payerId === family));
    expect(toDeposit).toEqual([]);
    const log = await withSchool(school, (tx) => paymentLog(tx, TODAY, TODAY, null));
    const mine = log.filter((l) => l.payerId === family);
    expect(totals(mine)).toEqual({ total: 28000, byMethod: { cheque: 38000 }, refunded: -10000 });
    expect(
      mine.filter((l) => l.reversalKind === "refund").map((l) => exportRowOf({ ...l, methodLabel: l.method })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amountCents: -6000, reference: "Remboursement, R0001" }),
        expect.objectContaining({ amountCents: -4000, reference: "Remboursement" }),
      ]),
    );
  });

  it("is refused by the database as a correction of a payment, or as a negative payment without a kind", async () => {
    const [p] = await admin`SELECT id FROM payment WHERE payer_id = ${family} AND amount_cents = 28000`;
    await expect(admin`
      INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, corrects_id, reversal_kind)
      VALUES (${school}, ${entity}, ${family}, -100, 'cheque', ${p.id}, 'refund')`).rejects.toThrow(
      /payment_reversal_kind/,
    );
    await expect(admin`
      INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method)
      VALUES (${school}, ${entity}, ${family}, -100, 'cheque')`).rejects.toThrow(/payment_sign/);
    await expect(admin`
      INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, reversal_kind)
      VALUES (${school}, ${entity}, ${family}, 100, 'cheque', 'refund')`).rejects.toThrow(/payment_sign/);
  });
});

describe("a refund sent twice (#260)", () => {
  it("records it once, and replays the first result", async () => {
    const paid = await withSchool(school, (tx) => collect(tx, frontDesk, other, [cash(30000, "0003")]));
    if (!paid.ok) throw new Error(paid.message);
    const key = crypto.randomUUID();
    const entry = refund(2000, "transfer");
    const send = () =>
      withSchool(school, (tx) =>
        once(tx, "payment", key, { refund: { payerId: other, entry } }, storedPayments, () =>
          refundPayer(tx, director, other, entry, TODAY),
        ),
      );
    const r = await send();
    if (!r.ok) throw new Error(r.message);
    expect(await send()).toEqual(r);
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM payment WHERE payer_id = ${other} AND amount_cents < 0`;
    expect(n).toBe(1);
  });
});

describe("refunds under concurrency", () => {
  it("two refunds saved at the same time never pay back more than the overpayment", async () => {
    // `other` is now 280 € due, 300 € paid, 20 € refunded: 0 overpaid. A works council transfer of 50 €.
    const paid = await withSchool(school, (tx) => collect(tx, frontDesk, other, [cash(5000, "V0004", "transfer")]));
    if (!paid.ok) throw new Error(paid.message);
    const [first, second] = await overlapping(
      admin,
      (hold) =>
        withSchool(school, async (tx) => {
          const result = await refundPayer(tx, director, other, refund(5000), TODAY);
          await hold();
          return result;
        }),
      () => withSchool(school, (tx) => refundPayer(tx, director, other, refund(5000), TODAY)),
    );
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, message: "Rien à rembourser : ce payeur n’a pas de trop-perçu." });
    expect((await remaining(other))?.remaining).toBe(0);
  });
});

describe("refunds with several entities (#300)", () => {
  beforeAll(async () => {
    // Danse received 150 € too much, Studio 50 €, cashed before Studio was deactivated.
    const paid = await withSchool(twoEntities, (tx) =>
      collect(tx, director, split, [cash(35000, "V0005", "transfer")], danse),
    );
    if (!paid.ok) throw new Error(paid.message);
    await admin`UPDATE billing_entity SET active = true WHERE id = ${studio}`;
    const s = await withSchool(twoEntities, (tx) =>
      collect(tx, director, split, [cash(35000, "V0006", "transfer")], studio),
    );
    if (!s.ok) throw new Error(s.message);
    await admin`UPDATE billing_entity SET active = false WHERE id = ${studio}`;
  });

  it("never reaches a payer of another school", async () => {
    expect(await withSchool(school, (tx) => refundPayer(tx, director, split, refund(1000), TODAY))).toEqual({
      ok: false,
      message: "Payeur introuvable.",
    });
  });

  it("names the entity that pays back", async () => {
    expect(await withSchool(twoEntities, (tx) => refundPayer(tx, director, split, refund(1000), TODAY))).toEqual({
      ok: false,
      message: REFUND_ENTITY_REQUIRED,
    });
    expect(
      await withSchool(twoEntities, (tx) => refundPayer(tx, director, split, refund(1000), TODAY, entity)),
    ).toEqual({ ok: false, message: "Entreprise introuvable." });
  });

  it("pays back only what that entity received in excess, even once deactivated", async () => {
    // Danse: 200 € due, 350 € paid → 150 € overpaid; Studio: 300 € due, 350 € paid → 50 € overpaid.
    expect(
      await withSchool(twoEntities, (tx) => refundPayer(tx, director, split, refund(5001), TODAY, studio)),
    ).toEqual({
      ok: false,
      message: `Le remboursement dépasse le trop-perçu (${formatEuros(5000)}) : rechargez la fiche.`,
    });
    const r = await withSchool(twoEntities, (tx) => refundPayer(tx, director, split, refund(5000), TODAY, studio));
    if (!r.ok) throw new Error(r.message);
    const [{ e }] = await admin`SELECT billing_entity_id AS e FROM payment WHERE id = ${r.ids[0]}`;
    expect(e).toBe(studio);
    const b = await withSchool(twoEntities, (tx) => balanceOf(tx, split, TODAY));
    expect(b?.byEntity.map((x) => [x.name, x.balance.remaining])).toEqual([
      ["Zy Danse", -15000],
      ["Zy Studio", 0],
    ]);
  });
});
