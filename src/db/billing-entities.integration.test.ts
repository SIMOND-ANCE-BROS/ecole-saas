import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSchool } from "./index";
import { createEntity, defaultEntityId, listEntities, makeDefaultEntity, updateEntity } from "./billing-entities";
import { collect, correctPayment } from "./payments";
import { createDeposit } from "./deposits";
import { defaultEntityFor } from "./billing-entity.integration-helpers";

/**
 * Billing entities (#298, ADR 0006), against the real database: the composite
 * keys carrying billing_entity_id refuse whatever mixes two entities, invoice
 * numbers are unique per entity, one default per school, RLS per school.
 * Fictitious data deleted at the end; payments and the audit log being
 * immutable, the cleanup disables their triggers inside an administration
 * transaction, as the payments tests do.
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const suffix = Math.random().toString(36).slice(2, 8);
const director = `ent-direction-${suffix}`;
const TODAY = "2026-10-21";
let school: string;
let otherSchool: string;
let entityA: string;
let entityB: string;
let foreignEntity: string;
let payer: string;

const entry = {
  name: "Zz Danse B",
  legalName: "Zz Danse B EI",
  siren: "000 000 002",
  siret: "",
  vatNumber: "",
  addressLine: "",
  postalCode: "",
  city: "",
  vatRegime: "not_applicable" as const,
  vatMention: "",
  bankAccountLabel: "Compte Zz Banque B",
};

beforeAll(async () => {
  [{ id: school }] = await admin`INSERT INTO school (name, slug) VALUES ('Zz École E', ${`ea-${suffix}`}) RETURNING id`;
  [{ id: otherSchool }] =
    await admin`INSERT INTO school (name, slug) VALUES ('Zz École F', ${`eb-${suffix}`}) RETURNING id`;
  entityA = await defaultEntityFor(admin, school, "Zz Danse A");
  foreignEntity = await defaultEntityFor(admin, otherSchool, "Zz Danse ailleurs");
  await admin`INSERT INTO "user" (id, name, email) VALUES (${director}, 'Zz Direction', ${`${director}@exemple.test`})`;
  await admin`INSERT INTO member (school_id, user_id, role) VALUES (${school}, ${director}, 'director')`;
  [{ id: payer }] =
    await admin`INSERT INTO person (school_id, last_name, first_name) VALUES (${school}, 'Zzmartin', 'Zoé') RETURNING id`;
});

afterAll(async () => {
  await admin.begin(async (t) => {
    await t`DELETE FROM payment_allocation WHERE school_id IN (${school}, ${otherSchool})`;
    await t`DELETE FROM installment WHERE school_id IN (${school}, ${otherSchool})`;
    await t`DELETE FROM invoice WHERE school_id IN (${school}, ${otherSchool})`;
    await t`DELETE FROM bank_deposit WHERE school_id IN (${school}, ${otherSchool})`;
    await t`DELETE FROM invoicing_connector WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE payment DISABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`;
    await t`DELETE FROM audit_log WHERE school_id IN (${school}, ${otherSchool})`;
    await t`DELETE FROM payment WHERE school_id IN (${school}, ${otherSchool}) AND corrects_id IS NOT NULL`;
    await t`DELETE FROM payment WHERE school_id IN (${school}, ${otherSchool})`;
    await t`ALTER TABLE payment ENABLE TRIGGER payment_immutable`;
    await t`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`;
  });
  for (const t of ["person", "member", "billing_entity"])
    await admin.unsafe(`DELETE FROM ${t} WHERE school_id IN ($1, $2)`, [school, otherSchool]);
  await admin`DELETE FROM "user" WHERE id = ${director}`;
  await admin`DELETE FROM school WHERE id IN (${school}, ${otherSchool})`;
  await admin.end();
});

/** A payment written directly, for the entity given (the application only writes the default one yet). */
async function paymentOf(entity: string, amountCents = 5000, method = "cash") {
  const [{ id }] = await admin`
    INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, date)
    VALUES (${school}, ${entity}, ${payer}, ${amountCents}, ${method}, ${TODAY}) RETURNING id`;
  return id as string;
}

async function invoiceOf(entity: string, number: string | null = null) {
  const [{ id }] = await admin`
    INSERT INTO invoice (school_id, billing_entity_id, payer_id, number)
    VALUES (${school}, ${entity}, ${payer}, ${number}) RETURNING id`;
  return id as string;
}

describe("billing entities", () => {
  it("adds a second entity, lists the default first, and keeps a single default", async () => {
    const r = await withSchool(school, (tx) => createEntity(tx, entry));
    if (!r.ok) throw new Error(r.message);
    entityB = r.id;

    const list = await withSchool(school, (tx) => listEntities(tx));
    expect(list.map((e) => [e.name, e.isDefault, e.siren])).toEqual([
      ["Zz Danse A", true, null],
      ["Zz Danse B", false, "000000002"],
    ]);
    // The partial unique index refuses a second default.
    await expect(admin`UPDATE billing_entity SET is_default = true WHERE id = ${entityB}`).rejects.toThrow(
      /billing_entity_one_default/,
    );
  });

  it("refuses a name already taken, in French", async () => {
    expect(await withSchool(school, (tx) => createEntity(tx, { ...entry, name: "zz danse a" }))).toEqual({
      ok: false,
      message: "Une autre entreprise porte déjà ce nom.",
    });
  });

  it("edits an entity; a SIRET alone also gives the SIREN", async () => {
    const r = await withSchool(school, (tx) =>
      updateEntity(tx, entityB, { ...entry, siren: "", siret: "000 000 002 00012", postalCode: "69100" }),
    );
    expect(r.ok).toBe(true);
    const [e] = await admin`SELECT siren, siret, postal_code FROM billing_entity WHERE id = ${entityB}`;
    expect(e).toEqual({ siren: "000000002", siret: "00000000200012", postal_code: "69100" });
  });

  it("changes the default entity, then back", async () => {
    expect((await withSchool(school, (tx) => makeDefaultEntity(tx, entityB))).ok).toBe(true);
    expect(await withSchool(school, (tx) => defaultEntityId(tx))).toBe(entityB);
    expect((await withSchool(school, (tx) => makeDefaultEntity(tx, entityA))).ok).toBe(true);
    expect(await withSchool(school, (tx) => defaultEntityId(tx))).toBe(entityA);
  });

  it("another school neither sees nor edits them", async () => {
    expect((await withSchool(otherSchool, (tx) => listEntities(tx))).map((e) => e.name)).toEqual(["Zz Danse ailleurs"]);
    expect(await withSchool(otherSchool, (tx) => updateEntity(tx, entityB, entry))).toEqual({
      ok: false,
      message: "Cette entreprise n’existe plus.",
    });
    expect(await withSchool(otherSchool, (tx) => makeDefaultEntity(tx, entityB))).toEqual({
      ok: false,
      message: "Cette entreprise n’existe plus.",
    });
  });

  it("refuses a payment pointing to another school's entity", async () => {
    await expect(paymentOf(foreignEntity)).rejects.toThrow(/payment_billing_entity_same_school_fk/);
  });
});

describe("composite keys carrying the entity", () => {
  it("refuse an allocation mixing the payment of one entity and the installment of another", async () => {
    const payment = await paymentOf(entityA);
    const invoice = await invoiceOf(entityB);
    const [{ id: installment }] = await admin`
      INSERT INTO installment (school_id, billing_entity_id, invoice_id, rank, due_date, amount_cents)
      VALUES (${school}, ${entityB}, ${invoice}, 1, ${TODAY}, 5000) RETURNING id`;

    await expect(
      admin`INSERT INTO payment_allocation (school_id, billing_entity_id, payment_id, installment_id, amount_cents)
            VALUES (${school}, ${entityA}, ${payment}, ${installment}, 5000)`,
    ).rejects.toThrow(/payment_allocation_installment_same_entity_fk/);
    await expect(
      admin`INSERT INTO payment_allocation (school_id, billing_entity_id, payment_id, installment_id, amount_cents)
            VALUES (${school}, ${entityB}, ${payment}, ${installment}, 5000)`,
    ).rejects.toThrow(/payment_allocation_payment_same_entity_fk/);
    // Same entity on both sides: accepted.
    const sameEntityPayment = await paymentOf(entityB);
    await expect(
      admin`INSERT INTO payment_allocation (school_id, billing_entity_id, payment_id, installment_id, amount_cents)
            VALUES (${school}, ${entityB}, ${sameEntityPayment}, ${installment}, 5000)`,
    ).resolves.toBeDefined();
  });

  it("refuse an installment of another entity than its invoice", async () => {
    const invoice = await invoiceOf(entityA);
    await expect(
      admin`INSERT INTO installment (school_id, billing_entity_id, invoice_id, rank, due_date, amount_cents)
            VALUES (${school}, ${entityB}, ${invoice}, 1, ${TODAY}, 5000)`,
    ).rejects.toThrow(/installment_invoice_same_entity_fk/);
  });

  it("refuse a deposit line whose payment belongs to another entity than the slip", async () => {
    const payment = await paymentOf(entityB);
    const [{ id: deposit }] = await admin`
      INSERT INTO bank_deposit (school_id, billing_entity_id, date, method)
      VALUES (${school}, ${entityA}, ${TODAY}, 'cash') RETURNING id`;

    await expect(
      admin`INSERT INTO bank_deposit_payment (school_id, billing_entity_id, bank_deposit_id, payment_id)
            VALUES (${school}, ${entityA}, ${deposit}, ${payment})`,
    ).rejects.toThrow(/bank_deposit_payment_payment_same_entity_fk/);
    await expect(
      admin`INSERT INTO bank_deposit_payment (school_id, billing_entity_id, bank_deposit_id, payment_id)
            VALUES (${school}, ${entityB}, ${deposit}, ${payment})`,
    ).rejects.toThrow(/bank_deposit_payment_bank_deposit_same_entity_fk/);
  });

  it("createDeposit refuses payments of two entities with a French message", async () => {
    const a = await paymentOf(entityA, 1000);
    const b = await paymentOf(entityB, 1000);
    expect(
      await withSchool(school, (tx) =>
        createDeposit(tx, director, { date: TODAY, method: "cash", paymentIds: [a, b] }, TODAY),
      ),
    ).toEqual({ ok: false, message: "Une remise ne regroupe que les paiements d’une même entreprise." });
    // One entity only: the slip takes the payments' entity.
    const r = await withSchool(school, (tx) =>
      createDeposit(tx, director, { date: TODAY, method: "cash", paymentIds: [b] }, TODAY),
    );
    if (!r.ok) throw new Error(r.message);
    const [d] = await admin`SELECT billing_entity_id AS entity FROM bank_deposit WHERE id = ${r.id}`;
    expect(d.entity).toBe(entityB);
  });

  it("refuse a reverse entry of another entity than the payment it corrects", async () => {
    const payment = await paymentOf(entityA);
    await expect(
      admin`INSERT INTO payment (school_id, billing_entity_id, payer_id, amount_cents, method, corrects_id, reversal_kind)
            VALUES (${school}, ${entityB}, ${payer}, -1000, 'cash', ${payment}, 'correction')`,
    ).rejects.toThrow(/payment_corrects_same_entity_fk/);
  });

  it("refuse a credit note of another entity than its invoice", async () => {
    const invoice = await invoiceOf(entityA);
    await expect(
      admin`INSERT INTO invoice (school_id, billing_entity_id, payer_id, credit_note_of)
            VALUES (${school}, ${entityB}, ${payer}, ${invoice})`,
    ).rejects.toThrow(/invoice_credit_note_of_same_entity_fk/);
  });

  it("number invoices per entity: « A-1 » once in each entity, never twice in one", async () => {
    await invoiceOf(entityA, "A-1");
    await expect(invoiceOf(entityB, "A-1")).resolves.toBeDefined();
    await expect(invoiceOf(entityA, "A-1")).rejects.toThrow(/invoice_billing_entity_id_number_unique/);
  });

  it("collect records the payments for the default entity", async () => {
    const r = await withSchool(school, (tx) =>
      collect(tx, director, payer, [
        { method: "cash", amountCents: 700, date: TODAY, reference: null, issuer: null, plannedPayment: null },
      ]),
    );
    if (!r.ok) throw new Error(r.message);
    const [p] = await admin`SELECT billing_entity_id AS entity FROM payment WHERE id = ${r.ids[0]}`;
    expect(p.entity).toBe(entityA);

    // Another default since: the reverse entry still belongs to the original's entity, A.
    expect((await withSchool(school, (tx) => makeDefaultEntity(tx, entityB))).ok).toBe(true);
    try {
      const c = await withSchool(school, (tx) => correctPayment(tx, director, r.ids[0], 200, TODAY));
      if (!c.ok) throw new Error(c.message);
      const [x] = await admin`SELECT billing_entity_id AS entity FROM payment WHERE id = ${c.ids[0]}`;
      expect(x.entity).toBe(entityA);
    } finally {
      await withSchool(school, (tx) => makeDefaultEntity(tx, entityA));
    }
  });
});

describe("invoicing connector per entity", () => {
  it("one connector per entity, never for another school's entity", async () => {
    await admin`INSERT INTO invoicing_connector (school_id, billing_entity_id, tool, encrypted_credentials)
                VALUES (${school}, ${entityA}, 'abby', 'zz-chiffre-a'), (${school}, ${entityB}, 'pennylane', 'zz-chiffre-b')`;
    await expect(
      admin`INSERT INTO invoicing_connector (school_id, billing_entity_id, tool, encrypted_credentials)
            VALUES (${school}, ${entityA}, 'shine', 'zz-chiffre-c')`,
    ).rejects.toThrow(/invoicing_connector_pkey/);
    await expect(
      admin`INSERT INTO invoicing_connector (school_id, billing_entity_id, tool, encrypted_credentials)
            VALUES (${school}, ${foreignEntity}, 'shine', 'zz-chiffre-d')`,
    ).rejects.toThrow(/invoicing_connector_billing_entity_same_school_fk/);
  });
});

describe("payment immutability after the 0038 backfill", () => {
  it("leaves the trigger payment_immutable enabled", async () => {
    const [t] = await admin`SELECT tgenabled FROM pg_trigger WHERE tgname = 'payment_immutable'`;
    expect(t.tgenabled).toBe("O");
    const id = await paymentOf(entityA);
    await expect(admin`UPDATE payment SET billing_entity_id = ${entityB} WHERE id = ${id}`).rejects.toThrow(
      /cannot be modified/,
    );
  });
});
