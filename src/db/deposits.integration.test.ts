import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { correctPayment, collect } from "./payments";
import { cancelDeposit, createDeposit, paymentLog, readDeposit, listDeposits, paymentsToDeposit } from "./deposits";

/**
 * Remises en banque et journal des encaissements (#98), comme l'application
 * (app_user, RLS). Données fictives supprimées à la fin ; paiements et
 * journal étant inaltérables, le nettoyage désactive leurs triggers le temps
 * d'une transaction d'administration.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const direction = `rem-direction-${suffix}`;
const TODAY = "2026-10-21";
let school: string;
let otherSchool: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('École A', ${`ra-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('École B', ${`rb-${suffix}`}) RETURNING id`;
  await admin`INSERT INTO "user" (id, name, email) VALUES (${direction}, 'Direction Test', ${`${direction}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${direction}, 'direction'), (${otherSchool}, ${direction}, 'direction')`;
  const [p] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Martin', 'Sophie') RETURNING id`;
  const r = await withSchool(school, (tx) =>
    collect(tx, direction, p.id, [
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
        method: "especes",
        amountCents: 2000,
        date: TODAY,
        reference: null,
        issuer: null,
        plannedPayment: null,
      },
      {
        method: "carte",
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
  [ids.cheque, ids.differe, ids.especes, ids.carte, ids.annule] = r.ids;
  await withSchool(school, (tx) => correctPayment(tx, direction, ids.annule, 5000, TODAY));
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
  await admin`DELETE FROM "user" WHERE id = ${direction}`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

const toDeposit = () => withSchool(school, (tx) => paymentsToDeposit(tx, TODAY));

describe("remises en banque", () => {
  let chequesDeposit: string;

  it("à remettre : chèque arrivé à échéance et espèces ; ni carte, ni chèque différé, ni chèque entièrement corrigé", async () => {
    const r = await toDeposit();
    expect(r.cheque.map((p) => p.id)).toEqual([ids.cheque]);
    expect(r.especes.map((p) => p.id)).toEqual([ids.especes]);
    expect(r.cheque_vacances).toEqual([]);
  });

  it("crée une remise de chèques ; refuse un chèque déjà remis, un autre moyen, un chèque pas encore à encaisser", async () => {
    const r = await withSchool(school, (tx) =>
      createDeposit(tx, direction, { date: TODAY, method: "cheque", paymentIds: [ids.cheque] }, TODAY),
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
        createDeposit(tx, direction, { date: TODAY, method: "cheque", paymentIds: [ids.cheque] }, TODAY),
      ),
    ).toEqual(refusal);
    expect(
      await withSchool(school, (tx) =>
        createDeposit(tx, direction, { date: TODAY, method: "cheque", paymentIds: [ids.especes] }, TODAY),
      ),
    ).toEqual(refusal);
    expect(
      await withSchool(school, (tx) =>
        createDeposit(tx, direction, { date: TODAY, method: "cheque", paymentIds: [ids.differe] }, TODAY),
      ),
    ).toEqual(refusal);
    // Une remise datée du jour d'encaissement prévu accepte le chèque différé.
    expect(
      (
        await withSchool(school, (tx) =>
          createDeposit(tx, direction, { date: "2027-01-05", method: "cheque", paymentIds: [ids.differe] }, TODAY),
        )
      ).ok,
    ).toBe(true);
    expect((await toDeposit()).cheque).toEqual([]);
  });

  it("un paiement ne peut figurer que dans une seule remise (contrainte en base)", async () => {
    const [{ id: autre }] =
      await admin`INSERT INTO bank_deposit (school_id, date, method) VALUES (${school}, ${TODAY}, 'cheque') RETURNING id`;
    await expect(
      admin`INSERT INTO bank_deposit_payment (school_id, bank_deposit_id, payment_id) VALUES (${school}, ${autre}, ${ids.cheque})`,
    ).rejects.toThrow();
    await admin`DELETE FROM bank_deposit WHERE id = ${autre}`;
  });

  it("bordereau, liste et journal des encaissements", async () => {
    const b = await withSchool(school, (tx) => readDeposit(tx, chequesDeposit));
    expect(b).toMatchObject({
      method: "cheque",
      nombre: 1,
      totalCents: 10000,
      payments: [{ reference: "0001", issuer: "Banque A", payer: "Sophie Martin" }],
    });
    expect(
      (await withSchool(school, (tx) => listDeposits(tx))).map(
        (x) => `${x.date} ${x.method} ${x.nombre} ${x.totalCents}`,
      ),
    ).toEqual(["2027-01-05 cheque 1 10000", "2026-10-21 cheque 1 10000"]);
    const j = await withSchool(school, (tx) => paymentLog(tx, TODAY, TODAY, null));
    expect(j).toHaveLength(6); // cinq règlements et une correction
    expect(j.find((x) => x.id === ids.cheque)?.dateDeposit).toBe(TODAY);
    expect(await withSchool(school, (tx) => paymentLog(tx, TODAY, TODAY, "especes"))).toHaveLength(1);
  });

  it("annuler une remise rend ses chèques à remettre et laisse une trace", async () => {
    expect((await withSchool(school, (tx) => cancelDeposit(tx, direction, chequesDeposit))).ok).toBe(true);
    expect((await toDeposit()).cheque.map((p) => p.id)).toEqual([ids.cheque]);
    const [t] = await admin`SELECT action FROM audit_log WHERE row_id = ${chequesDeposit} AND action = 'delete'`;
    expect(t?.action).toBe("delete");
  });

  it("une autre école ne voit rien et ne peut pas remettre ces paiements", async () => {
    expect(await withSchool(otherSchool, (tx) => listDeposits(tx))).toEqual([]);
    expect((await withSchool(otherSchool, (tx) => paymentsToDeposit(tx, TODAY))).cheque).toEqual([]);
    expect(
      (
        await withSchool(otherSchool, (tx) =>
          createDeposit(tx, direction, { date: TODAY, method: "cheque", paymentIds: [ids.cheque] }, TODAY),
        )
      ).ok,
    ).toBe(false);
  });
});
