import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migration 0041 (#298) replayed on a throwaway database: migrated up to the
 * migration before it, filled as a school was before billing entities, then
 * migrated to the end. Checks the backfill (one default entity per school
 * carrying the school's legal identity, every payment, deposit and invoice row
 * given that entity) and that payments are immutable again afterwards. Needs a
 * role allowed to create a database (the local and CI owner role is).
 */

const MIGRATION = "0041_billing_entity";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const database = `zz_migration_298_${Math.random().toString(36).slice(2, 8)}`;
const target = new URL(url);
target.pathname = `/${database}`;
let db: postgres.Sql;
let before: string;

type Journal = { entries: { tag: string }[] };

/** A copy of the migrations folder whose journal stops just before `tag`. */
function migrationsBefore(tag: string): string {
  const folder = mkdtempSync(join(tmpdir(), "zz-migrations-"));
  mkdirSync(join(folder, "meta"));
  for (const f of readdirSync("migrations"))
    if (f.endsWith(".sql")) copyFileSync(join("migrations", f), join(folder, f));
  const journal = JSON.parse(readFileSync("migrations/meta/_journal.json", "utf8")) as Journal;
  const stop = journal.entries.findIndex((e) => e.tag === tag);
  if (stop < 0) throw new Error(`${tag} absent du journal`);
  writeFileSync(
    join(folder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, stop) }),
  );
  return folder;
}

const ids: Record<string, string> = {};

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${database}`);
  db = postgres(target.toString(), { max: 1, onnotice: () => {} });
  before = migrationsBefore(MIGRATION);
  await migrate(drizzle(db), { migrationsFolder: before });

  // Two schools as they were: one with its legal identity on school, one without.
  [{ id: ids.school }] = await db`
    INSERT INTO school (name, slug, company_name, siren, vat_regime, vat_mention)
    VALUES ('Zz École A', 'zz-a', 'Zz Danse SARL', '000000001', 'franchise_293b', 'Zz mention')
    RETURNING id`;
  [{ id: ids.bare }] = await db`INSERT INTO school (name, slug) VALUES ('Zz École B', 'zz-b') RETURNING id`;
  [{ id: ids.payer }] =
    await db`INSERT INTO person (school_id, last_name) VALUES (${ids.school}, 'Zzpayeur') RETURNING id`;
  [{ id: ids.payment }] = await db`
    INSERT INTO payment (school_id, payer_id, amount_cents, method, reference)
    VALUES (${ids.school}, ${ids.payer}, 12000, 'cheque', 'Zz1') RETURNING id`;
  [{ id: ids.correction }] = await db`
    INSERT INTO payment (school_id, payer_id, amount_cents, method, reference, corrects_id, reversal_kind)
    VALUES (${ids.school}, ${ids.payer}, -2000, 'cheque', 'Zz1', ${ids.payment}, 'correction') RETURNING id`;
  [{ id: ids.deposit }] = await db`
    INSERT INTO bank_deposit (school_id, date, method) VALUES (${ids.school}, '2026-10-01', 'cheque') RETURNING id`;
  await db`INSERT INTO bank_deposit_payment (school_id, bank_deposit_id, payment_id) VALUES (${ids.school}, ${ids.deposit}, ${ids.payment})`;
  [{ id: ids.invoice }] =
    await db`INSERT INTO invoice (school_id, payer_id, number) VALUES (${ids.school}, ${ids.payer}, 'A-1') RETURNING id`;
  [{ id: ids.installment }] = await db`
    INSERT INTO installment (school_id, invoice_id, rank, due_date, amount_cents)
    VALUES (${ids.school}, ${ids.invoice}, 1, '2026-10-01', 12000) RETURNING id`;
  await db`INSERT INTO payment_allocation (school_id, payment_id, installment_id, amount_cents) VALUES (${ids.school}, ${ids.payment}, ${ids.installment}, 10000)`;
  await db`INSERT INTO invoicing_connector (school_id, tool, encrypted_credentials) VALUES (${ids.school}, 'abby', 'zz-chiffre')`;

  await migrate(drizzle(db), { migrationsFolder: "migrations" });
}, 60_000);

afterAll(async () => {
  await db?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.end();
  if (before) rmSync(before, { recursive: true, force: true });
});

describe(`migration ${MIGRATION}`, () => {
  it("gives each school exactly one default entity, from its legal identity or its name", async () => {
    const rows = await db`
      SELECT school_id, name, legal_name, siren, vat_regime, vat_mention, is_default, active
      FROM billing_entity ORDER BY name`;
    expect(rows).toEqual([
      {
        school_id: ids.school,
        name: "Zz École A",
        legal_name: "Zz Danse SARL",
        siren: "000000001",
        vat_regime: "franchise_293b",
        vat_mention: "Zz mention",
        is_default: true,
        active: true,
      },
      {
        school_id: ids.bare,
        name: "Zz École B",
        legal_name: "Zz École B",
        siren: null,
        vat_regime: "not_applicable",
        vat_mention: null,
        is_default: true,
        active: true,
      },
    ]);
  });

  it("gives every payment, deposit, invoice, installment, allocation and connector the default entity", async () => {
    const [{ id: entity }] = await db`SELECT id FROM billing_entity WHERE school_id = ${ids.school}`;
    const tables = [
      "payment",
      "bank_deposit",
      "bank_deposit_payment",
      "invoice",
      "installment",
      "payment_allocation",
      "invoicing_connector",
    ];
    for (const t of tables) {
      const rows = await db.unsafe<{ entity: string }[]>(`SELECT DISTINCT billing_entity_id AS entity FROM ${t}`);
      expect(rows, t).toEqual([{ entity }]);
    }
    // Nothing else of a payment moved.
    const payments = await db`SELECT amount_cents, reference, corrects_id FROM payment ORDER BY amount_cents`;
    expect(payments).toEqual([
      { amount_cents: -2000, reference: "Zz1", corrects_id: ids.payment },
      { amount_cents: 12000, reference: "Zz1", corrects_id: null },
    ]);
  });

  it("drops the moved columns from school", async () => {
    const columns = await db`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'school' ORDER BY ordinal_position`;
    expect(columns.map((c) => c.column_name)).toEqual(["id", "name", "slug", "time_zone", "created_at"]);
  });

  it("enables payment_immutable again", async () => {
    const [t] = await db`SELECT tgenabled FROM pg_trigger WHERE tgname = 'payment_immutable'`;
    expect(t.tgenabled).toBe("O");
    await expect(db`UPDATE payment SET amount_cents = 1 WHERE id = ${ids.payment}`).rejects.toThrow(
      /cannot be modified/,
    );
  });
});
