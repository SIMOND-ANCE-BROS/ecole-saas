import { rmSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationsBefore } from "./migration.integration-helpers";

/**
 * Migration 0047 (#301) replayed on a throwaway database: migrated up to the migration
 * before it, filled with two schools, courses, a lesson pack and an invoice line as they
 * were before (no VAT treatment), then migrated to the end. Needs a role allowed to
 * create a database (the local and CI owner role is).
 */

const MIGRATION = "0047_vat_treatment";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const databaseUrl = (name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};
const database = `zz_migration_301_${Math.random().toString(36).slice(2, 8)}`;
let db: postgres.Sql;
let before: string;
const ids: Record<string, string> = {};

/** A school with its default entity, a season, a room, an instructor and a discipline: what a course needs. */
async function schoolOf(sql: postgres.Sql, key: string) {
  const [school] = await sql`INSERT INTO school (name, slug) VALUES (${`Zz ${key}`}, ${`zz-${key}`}) RETURNING id`;
  const [entity] = await sql`INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, is_default)
    VALUES (${school.id}, 'Zz a', 'Zz a', 'franchise_293b', true) RETURNING id`;
  const [season] = await sql`INSERT INTO season (school_id, label, start_date, end_date)
    VALUES (${school.id}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
  const [site] = await sql`INSERT INTO site (school_id, name, address) VALUES (${school.id}, 'Zz', 'Zz') RETURNING id`;
  const [room] =
    await sql`INSERT INTO room (school_id, site_id, name) VALUES (${school.id}, ${site.id}, 'Zz') RETURNING id`;
  const [teacher] =
    await sql`INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
    VALUES (${school.id}, 'Zzprof', 'Zz', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
  const [discipline] = await sql`INSERT INTO discipline (school_id, name) VALUES (${school.id}, 'Zzjazz') RETURNING id`;
  const [payer] = await sql`INSERT INTO person (school_id, last_name) VALUES (${school.id}, 'Zzpayeur') RETURNING id`;
  const course = (entityId: string) => sql`
    INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
    VALUES (${school.id}, ${entityId}, ${season.id}, ${discipline.id}, ${room.id}, ${teacher.id}, 1, '17:00', 60) RETURNING id`;
  return { school: school.id as string, entity: entity.id as string, payer: payer.id as string, course };
}

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${database}`);
  db = postgres(databaseUrl(database), { max: 1, onnotice: () => {} });
  before = migrationsBefore(MIGRATION);
  await migrate(drizzle(db), { migrationsFolder: before });

  const one = await schoolOf(db, "un");
  const two = await schoolOf(db, "deux");
  Object.assign(ids, { one: one.school, two: two.school, entityOne: one.entity });
  [{ id: ids.entityB }] = await db`INSERT INTO billing_entity (school_id, name, legal_name, vat_regime)
    VALUES (${one.school}, 'Zz b', 'Zz b', 'vat_registered') RETURNING id`;
  [{ id: ids.courseA }] = await one.course(one.entity);
  [{ id: ids.courseB }] = await one.course(ids.entityB);
  [{ id: ids.courseTwo }] = await two.course(two.entity);
  [{ id: ids.pack }] = await db`
    INSERT INTO lesson_pack (school_id, billing_entity_id, payer_id, people_count, lesson_count, price_cents)
    VALUES (${one.school}, ${ids.entityB}, ${one.payer}, 1, 5, 20000) RETURNING id`;
  const [invoice] = await db`
    INSERT INTO invoice (school_id, billing_entity_id, payer_id) VALUES (${one.school}, ${one.entity}, ${one.payer}) RETURNING id`;
  // One and a half units at 110,05 €: 165,075 € → 165,08 €.
  [{ id: ids.line }] = await db`
    INSERT INTO invoice_line (school_id, billing_entity_id, invoice_id, label, quantity_thousandths, unit_price_cents)
    VALUES (${one.school}, ${one.entity}, ${invoice.id}, 'Zz forfait', 1500, 11005) RETURNING id`;

  await migrate(drizzle(db), { migrationsFolder: "migrations" });
}, 60_000);

afterAll(async () => {
  await db?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.end();
  if (before) rmSync(before, { recursive: true, force: true });
});

describe(`migration ${MIGRATION}`, () => {
  it("creates one exemption per school, default of each of its businesses", async () => {
    const treatments = await db`SELECT school_id, label, category, rate_bps, mention FROM vat_treatment ORDER BY label`;
    expect(treatments).toHaveLength(2);
    for (const t of treatments)
      expect(t).toMatchObject({
        category: "exempt",
        rate_bps: 0,
        label: "Exonéré (art. 261-4-4° b)",
        mention: "Exonération de TVA, article 261, 4, 4° b du CGI",
      });
    const entities = await db`
      SELECT e.school_id = t.school_id AS same FROM billing_entity e JOIN vat_treatment t ON t.id = e.default_vat_treatment_id`;
    expect(entities).toHaveLength(3);
    expect(entities.every((e) => e.same)).toBe(true);
  });

  it("gives every course and lesson pack its business's default treatment, and makes it mandatory", async () => {
    const rows = await db`
      SELECT x.id, x.vat_treatment_id = e.default_vat_treatment_id AS same FROM (
        SELECT id, school_id, billing_entity_id, vat_treatment_id FROM course
        UNION ALL SELECT id, school_id, billing_entity_id, vat_treatment_id FROM lesson_pack) x
      JOIN billing_entity e ON e.id = x.billing_entity_id`;
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.same)).toBe(true);
    const columns = await db`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE column_name = 'vat_treatment_id' AND table_name IN ('course', 'lesson_pack', 'invoice_line') ORDER BY 1`;
    expect(columns.map((c) => c.is_nullable)).toEqual(["NO", "NO", "NO"]);
  });

  it("derives an invoice line's amounts from its unit price and quantity, with the exemption's mention", async () => {
    const [line] = await db`
      SELECT incl_tax_cents, excl_tax_cents, vat_cents, vat_category, vat_mention FROM invoice_line WHERE id = ${ids.line}`;
    expect(line).toEqual({
      incl_tax_cents: 16508,
      excl_tax_cents: 16508,
      vat_cents: 0,
      vat_category: "exempt",
      vat_mention: "Exonération de TVA, article 261, 4, 4° b du CGI",
    });
  });

  it("gives a course inserted without a treatment its business's default", async () => {
    const [school] = await db`SELECT id FROM school WHERE id = ${ids.one}`;
    const [c] = await db`SELECT season_id, discipline_id, room_id, instructor_id FROM course WHERE id = ${ids.courseA}`;
    const [inserted] = await db`
      INSERT INTO course (school_id, billing_entity_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${school.id}, ${ids.entityB}, ${c.season_id}, ${c.discipline_id}, ${c.room_id}, ${c.instructor_id}, 2, '18:00', 45)
      RETURNING vat_treatment_id`;
    const [entity] = await db`SELECT default_vat_treatment_id FROM billing_entity WHERE id = ${ids.entityB}`;
    expect(inserted.vat_treatment_id).toBe(entity.default_vat_treatment_id);
  });
});

describe(`migration ${MIGRATION} on a line with a VAT rate`, () => {
  it("fails instead of giving it a treatment without VAT", async () => {
    const name = `zz_migration_301_rate_${Math.random().toString(36).slice(2, 8)}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const taxed = postgres(databaseUrl(name), { max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(taxed), { migrationsFolder: before });
      const s = await schoolOf(taxed, "taxe");
      const [invoice] = await taxed`
        INSERT INTO invoice (school_id, billing_entity_id, payer_id) VALUES (${s.school}, ${s.entity}, ${s.payer}) RETURNING id`;
      await taxed`INSERT INTO invoice_line (school_id, billing_entity_id, invoice_id, label, unit_price_cents, vat_rate_bps)
        VALUES (${s.school}, ${s.entity}, ${invoice.id}, 'Zz', 12000, 2000)`;
      const error: unknown = await migrate(drizzle(taxed), { migrationsFolder: "migrations" }).then(
        () => null,
        (e: unknown) => e,
      );
      const text = error instanceof Error ? `${error.message} ${String(error.cause)}` : String(error);
      expect(text).toMatch(/vat_treatment_id/);
      // Rolled back: no treatment table left behind.
      const [table] = await taxed`SELECT to_regclass('vat_treatment') IS NULL AS absent`;
      expect(table.absent).toBe(true);
    } finally {
      await taxed.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  }, 60_000);
});
