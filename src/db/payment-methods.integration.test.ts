import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { defaultEntityFor } from "./billing-entity.integration-helpers";
import { collect, correctPayment, paymentsOf } from "./payments";
import { paymentLog, paymentsToDeposit } from "./deposits";
import { readMethodSettings, saveMethodSettings } from "./payment-methods";
import { PAYMENT_METHOD_VALUES, type Method } from "../domain/payments/methods";

/**
 * Payment methods the school accepts (#293), as the application runs them
 * (app_user, RLS). Fictitious data deleted at the end; payments and the audit
 * log being immutable, the cleanup disables their triggers in an admin transaction.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const director = `pm-direction-${suffix}`;
const TODAY = "2026-10-21";
let school: string;
let otherSchool: string;
let payer: string;

const pay = (method: Method, amountCents = 5000) => ({
  method,
  amountCents,
  date: TODAY,
  reference: null,
  issuer: null,
  plannedPayment: null,
});

/** Settings accepting `accepted` only, with the given hints. */
const only = (accepted: Method[], hints: Partial<Record<Method, string>> = {}) =>
  PAYMENT_METHOD_VALUES.map((method) => ({
    method,
    accepted: accepted.includes(method),
    deskHint: hints[method] ?? null,
  }));

beforeAll(async () => {
  [{ id: school }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École A', ${`pma-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École B', ${`pmb-${suffix}`}) RETURNING id`;
  await defaultEntityFor(admin, school);
  await defaultEntityFor(admin, otherSchool);
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Zz Direction', ${`${director}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${director}, 'director')`;
  [{ id: payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzpayeur', 'Zoé') RETURNING id`;
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
  for (const t of ["payment_method_setting", "person", "member"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM "user" WHERE id = ${director}`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

describe("payment methods the school accepts (#293)", () => {
  let passSport: string;
  let online: string;

  it("a school that never chose accepts every method, ANCV Connect included", async () => {
    const settings = await withSchool(school, (tx) => readMethodSettings(tx));
    expect(settings.every((s) => s.accepted)).toBe(true);
    const r = await withSchool(school, (tx) =>
      collect(tx, director, payer, [pay("pass_sport"), pay("holiday_voucher_online"), pay("holiday_voucher")]),
    );
    if (!r.ok) throw new Error(r.message);
    [passSport, online] = r.ids;
  });

  it("ANCV Connect is never offered for a bank deposit, paper vouchers are", async () => {
    const groups = await withSchool(school, (tx) => paymentsToDeposit(tx, TODAY));
    const ids = groups.flatMap((g) => g.payments.map((p) => p.id));
    expect(ids).not.toContain(online);
    expect(groups.map((g) => g.method)).toEqual(["holiday_voucher"]);
  });

  it("management switches methods off and writes a desk hint; the audit log keeps each change", async () => {
    const r = await withSchool(school, (tx) =>
      saveMethodSettings(
        tx,
        director,
        only(["cheque", "cash", "card", "transfer", "holiday_voucher", "holiday_voucher_online"], {
          transfer: "  Virement : règlement de la totalité  ",
        }),
      ),
    );
    expect(r).toEqual({ ok: true });
    const settings = await withSchool(school, (tx) => readMethodSettings(tx));
    expect(settings.filter((s) => !s.accepted).map((s) => s.method)).toEqual(["direct_debit", "pass_sport", "other"]);
    expect(settings.find((s) => s.method === "transfer")?.deskHint).toBe("Virement : règlement de la totalité");
    const [{ n }] =
      await admin`SELECT count(*)::int AS n FROM audit_log WHERE school_id = ${school} AND target_table = 'payment_method_setting'`;
    expect(n).toBe(4);
    // Saving the same again writes nothing new.
    await withSchool(school, (tx) =>
      saveMethodSettings(
        tx,
        director,
        only(["cheque", "cash", "card", "transfer", "holiday_voucher", "holiday_voucher_online"], {
          transfer: "Virement : règlement de la totalité",
        }),
      ),
    );
    const [{ n: again }] =
      await admin`SELECT count(*)::int AS n FROM audit_log WHERE school_id = ${school} AND target_table = 'payment_method_setting'`;
    expect(again).toBe(4);
  });

  it("refuses a payment by a method switched off, and records nothing of the entry", async () => {
    const r = await withSchool(school, (tx) => collect(tx, director, payer, [pay("cheque"), pay("pass_sport")]));
    expect(r).toEqual({
      ok: false,
      message: "Le paiement par « Pass’Sport » n’est plus accepté : rechargez la page pour choisir un autre moyen.",
    });
    expect(await withSchool(school, (tx) => paymentsOf(tx, payer))).toHaveLength(3);
  });

  it("a payment recorded before still shows, exports and can be corrected with its method", async () => {
    const rows = await withSchool(school, (tx) => paymentsOf(tx, payer));
    expect(rows.find((p) => p.id === passSport)?.method).toBe("pass_sport");
    const log = await withSchool(school, (tx) => paymentLog(tx, TODAY, TODAY, "pass_sport"));
    expect(log.map((l) => l.id)).toEqual([passSport]);
    const c = await withSchool(school, (tx) => correctPayment(tx, director, passSport, 1000, TODAY));
    expect(c.ok).toBe(true);
  });

  it("refuses accepting no method at all, or a hint too long", async () => {
    expect(await withSchool(school, (tx) => saveMethodSettings(tx, director, only([])))).toEqual({
      ok: false,
      message: "Cochez au moins un moyen de paiement.",
    });
    expect(
      await withSchool(school, (tx) => saveMethodSettings(tx, director, only(["cash"], { cash: "x".repeat(121) }))),
    ).toEqual({ ok: false, message: "Consigne : 120 caractères au plus." });
  });

  it("another school keeps its own methods and cannot see this one's", async () => {
    const other = await withSchool(otherSchool, (tx) => readMethodSettings(tx));
    expect(other.every((s) => s.accepted && s.deskHint === null)).toBe(true);
    const seen = await withSchool(otherSchool, async (tx) =>
      (await tx.execute(`SELECT count(*)::int AS n FROM payment_method_setting`)).at(0),
    );
    expect(seen).toEqual({ n: 0 });
  });
});
