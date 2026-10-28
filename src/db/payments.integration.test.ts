import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { correctPayment, collect, paymentsOf, balanceOf } from "./payments";

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
const TODAY = "2026-10-21";
let school: string;
let otherSchool: string;
let payer: string;
let foreign: string;

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`pa-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`pb-${suffix}`}) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${frontDesk}, 'Accueil Test', ${`${frontDesk}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${frontDesk}, 'front_desk')`;
  [{ id: payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Martin', 'Sophie') RETURNING id`;
  [{ id: foreign }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${otherSchool}, 'Ailleurs', 'Paul') RETURNING id`;
  const [s] =
    await admin`INSERT INTO season (school_id, label, start_date, end_date) VALUES (${school}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  await admin`INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents) VALUES (${school}, ${s.id}, ${payer}, 'child', 'year', 30000)`;
  await admin`INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents, status) VALUES (${school}, ${s.id}, ${payer}, 'child', 'quarter', 9000, 'dropped')`;
});

afterAll(async () => {
  await admin.begin(async (t) => {
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
  await admin`DELETE FROM "user" WHERE id = ${frontDesk}`;
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
    expect(correction).toMatchObject({ amountCents: -4000, method: "cheque", enteredBy: "Accueil Test" });
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

    // A corrects 60,00 € and keeps its transaction open; B corrects 60,00 € meanwhile.
    let firstDone!: () => void;
    const firstCorrected = new Promise<void>((resolve) => (firstDone = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const first = withSchool(school, async (tx) => {
      const result = await correctPayment(tx, frontDesk, id, 6000, TODAY);
      firstDone();
      await released;
      return result;
    });
    await firstCorrected;
    const second = withSchool(school, (tx) => correctPayment(tx, frontDesk, id, 6000, TODAY));
    // Without a lock, B reads the total before A commits and goes through at once.
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();

    expect((await first).ok).toBe(true);
    expect(await second).toEqual({ ok: false, message: "La correction dépasse le montant encore non corrigé." });
    const rows = await withSchool(school, (tx) => paymentsOf(tx, payer));
    expect(rows.find((l) => l.id === id)?.correctedCents).toBe(6000);
  });
});
