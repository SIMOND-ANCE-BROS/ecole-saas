import { rmSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationsBefore } from "./migration.integration-helpers";

/**
 * Migration 0045 (#318) replayed on a throwaway database: migrated up to the migration
 * before it, filled with invoice lines as they were before (no entity), then migrated to
 * the end. Checks that each line gets its invoice's entity and that the new keys hold.
 * Needs a role allowed to create a database (the local and CI owner role is).
 */

const MIGRATION = "0045_entity_on_invoice_lines";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const database = `zz_migration_318_${Math.random().toString(36).slice(2, 8)}`;
const target = new URL(url);
target.pathname = `/${database}`;
let db: postgres.Sql;
let before: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${database}`);
  db = postgres(target.toString(), { max: 1, onnotice: () => {} });
  before = migrationsBefore(MIGRATION);
  await migrate(drizzle(db), { migrationsFolder: before });

  [{ id: ids.school }] = await db`INSERT INTO school (name, slug) VALUES ('Zz École', 'zz-ecole') RETURNING id`;
  const s = ids.school;
  // Two entities, each with its own invoice: a line must take its invoice's, not the default.
  for (const [key, isDefault] of [
    ["a", true],
    ["b", false],
  ] as const)
    [{ id: ids[key] }] = await db`
      INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, is_default)
      VALUES (${s}, ${`Zz ${key}`}, ${`Zz ${key}`}, 'not_applicable', ${isDefault}) RETURNING id`;
  const [season] = await db`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${s}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [payer] = await db`INSERT INTO person (school_id, last_name) VALUES (${s}, 'Zzpayeur') RETURNING id`;
  for (const key of ["a", "b"]) {
    const [enrollment] = await db`
      INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents)
      VALUES (${s}, ${ids[key]}, ${season.id}, ${payer.id}, 'child', 'quarter', 11000) RETURNING id`;
    const [pack] = await db`
      INSERT INTO lesson_pack (school_id, billing_entity_id, payer_id, people_count, lesson_count, price_cents)
      VALUES (${s}, ${ids[key]}, ${payer.id}, 1, 5, 20000) RETURNING id`;
    const [invoice] = await db`
      INSERT INTO invoice (school_id, billing_entity_id, payer_id) VALUES (${s}, ${ids[key]}, ${payer.id}) RETURNING id`;
    await db`INSERT INTO invoice_line (school_id, invoice_id, label, unit_price_cents, enrollment_id)
      VALUES (${s}, ${invoice.id}, 'Zz forfait', 11000, ${enrollment.id})`;
    await db`INSERT INTO invoice_line (school_id, invoice_id, label, unit_price_cents, lesson_pack_id)
      VALUES (${s}, ${invoice.id}, 'Zz carnet', 20000, ${pack.id})`;
    ids[`enrollment-${key}`] = enrollment.id;
  }

  await migrate(drizzle(db), { migrationsFolder: "migrations" });
}, 60_000);

afterAll(async () => {
  await db?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.end();
  if (before) rmSync(before, { recursive: true, force: true });
});

describe(`migration ${MIGRATION}`, () => {
  it("gives every invoice line its invoice's entity, and makes it mandatory", async () => {
    const lines = await db`
      SELECT l.billing_entity_id = i.billing_entity_id AS same, l.billing_entity_id AS entity
      FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id ORDER BY 2`;
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l.same)).toBe(true);
    expect(new Set(lines.map((l) => l.entity))).toEqual(new Set([ids.a, ids.b]));
    const [column] = await db`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'invoice_line' AND column_name = 'billing_entity_id'`;
    expect(column.is_nullable).toBe("NO");
  });

  it("refuses afterwards to move a billed enrollment to another entity", async () => {
    await expect(
      db`UPDATE enrollment SET billing_entity_id = ${ids.b} WHERE id = ${ids["enrollment-a"]}`,
    ).rejects.toThrow(/invoice_line_enrollment_same_entity_fk/);
  });
});

describe(`migration ${MIGRATION} on a line mixing two entities`, () => {
  it("fails instead of moving the line silently", async () => {
    const name = `zz_migration_318_mixed_${Math.random().toString(36).slice(2, 8)}`;
    const mixedUrl = new URL(url);
    mixedUrl.pathname = `/${name}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const mixed = postgres(mixedUrl.toString(), { max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(mixed), { migrationsFolder: before });
      const [school] = await mixed`INSERT INTO school (name, slug) VALUES ('Zz École', 'zz-ecole') RETURNING id`;
      const [a] = await mixed`INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, is_default)
        VALUES (${school.id}, 'Zz a', 'Zz a', 'not_applicable', true) RETURNING id`;
      const [b] = await mixed`INSERT INTO billing_entity (school_id, name, legal_name, vat_regime)
        VALUES (${school.id}, 'Zz b', 'Zz b', 'not_applicable') RETURNING id`;
      const [season] = await mixed`INSERT INTO season (school_id, label, start_date, end_date)
        VALUES (${school.id}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
      const [payer] =
        await mixed`INSERT INTO person (school_id, last_name) VALUES (${school.id}, 'Zzpayeur') RETURNING id`;
      // An invoice of entity A billing an enrollment of entity B, as nothing refused it before.
      const [enrollment] = await mixed`
        INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents)
        VALUES (${school.id}, ${b.id}, ${season.id}, ${payer.id}, 'child', 'quarter', 11000) RETURNING id`;
      const [invoice] = await mixed`
        INSERT INTO invoice (school_id, billing_entity_id, payer_id) VALUES (${school.id}, ${a.id}, ${payer.id}) RETURNING id`;
      await mixed`INSERT INTO invoice_line (school_id, invoice_id, label, unit_price_cents, enrollment_id)
        VALUES (${school.id}, ${invoice.id}, 'Zz forfait', 11000, ${enrollment.id})`;

      const error: unknown = await migrate(drizzle(mixed), { migrationsFolder: "migrations" }).then(
        () => null,
        (e: unknown) => e,
      );
      // Drizzle may wrap the database error: look at its cause too.
      const text = error instanceof Error ? `${error.message} ${String(error.cause)}` : String(error);
      expect(text).toMatch(/invoice_line_enrollment_same_entity_fk/);
      // Rolled back: the line has no entity column, nothing was moved.
      const [column] = await mixed`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'invoice_line' AND column_name = 'billing_entity_id'`;
      expect(column.n).toBe(0);
    } finally {
      await mixed.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  }, 60_000);
});
