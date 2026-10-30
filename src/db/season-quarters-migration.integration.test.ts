import { rmSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultQuarters } from "../domain/enrollment/quarters";
import { migrationsBefore } from "./migration.integration-helpers";

/**
 * Migration 0050 (#291) replayed on a throwaway database: migrated up to the migration
 * before it, filled with seasons and quarterly enrollments as they were (no quarters), then
 * migrated to the end. Checks the default quarters it gives each season (the same as
 * `defaultQuarters`) and the quarters it gives each quarterly enrollment.
 */

const MIGRATION = "0050_season_quarters";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const database = `zz_migration_291_${Math.random().toString(36).slice(2, 8)}`;
const target = new URL(url);
target.pathname = `/${database}`;
let db: postgres.Sql;
let before: string;
const ids: Record<string, string> = {};
const SEASONS = {
  full: { label: "2027-2028", startDate: "2027-09-01", endDate: "2028-06-30" },
  gala: { label: "2028-2029", startDate: "2028-10-09", endDate: "2029-06-27" },
  short: { label: "Zz court", startDate: "2030-01-15", endDate: "2030-06-30" },
};

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${database}`);
  db = postgres(target.toString(), { max: 1, onnotice: () => {} });
  before = migrationsBefore(MIGRATION);
  await migrate(drizzle(db), { migrationsFolder: before });

  [{ id: ids.school }] = await db`INSERT INTO school (name, slug) VALUES ('Zz École', 'zz-ecole') RETURNING id`;
  const s = ids.school;
  const [entity] = await db`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, is_default)
    VALUES (${s}, 'Zz', 'Zz', 'not_applicable', true) RETURNING id`;
  for (const [key, season] of Object.entries(SEASONS))
    [{ id: ids[key] }] = await db`INSERT INTO season (school_id, label, start_date, end_date)
      VALUES (${s}, ${season.label}, ${season.startDate}, ${season.endDate}) RETURNING id`;
  const [payer] = await db`INSERT INTO person (school_id, last_name) VALUES (${s}, 'Zzpayeur') RETURNING id`;
  const enroll = async (key: string, period: string, enrolledOn: string) =>
    ([{ id: ids[key] }] = await db`
      INSERT INTO enrollment (school_id, billing_entity_id, season_id, payer_id, audience, period, gross_price_cents, enrolled_on)
      VALUES (${s}, ${entity.id}, ${ids.full}, ${payer.id}, 'child', ${period}, 11000, ${enrolledOn}) RETURNING id`);
  await enroll("september", "quarter", "2027-09-15");
  await enroll("november", "quarter", "2027-11-15");
  await enroll("january", "quarter", "2028-01-10");
  await enroll("late", "quarter", "2028-07-02");
  await enroll("yearly", "year", "2027-09-15");

  await migrate(drizzle(db), { migrationsFolder: "migrations" });
}, 60_000);

afterAll(async () => {
  await db?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.end();
  if (before) rmSync(before, { recursive: true, force: true });
});

const quartersOf = (seasonId: string) => db`
  SELECT label, to_char(start_date, 'YYYY-MM-DD') AS "startDate", to_char(end_date, 'YYYY-MM-DD') AS "endDate"
  FROM season_quarter WHERE season_id = ${seasonId} ORDER BY start_date`;

const coveredBy = async (enrollmentId: string) =>
  (
    await db`SELECT q.label FROM enrollment_quarter e JOIN season_quarter q ON q.id = e.quarter_id
      WHERE e.enrollment_id = ${enrollmentId} ORDER BY q.start_date`
  ).map((r) => r.label);

describe(`migration ${MIGRATION}`, () => {
  it("gives every season the default quarters, the same as defaultQuarters", async () => {
    for (const [key, season] of Object.entries(SEASONS))
      expect([...(await quartersOf(ids[key]))]).toEqual(defaultQuarters(season));
  });

  it("a September-to-June season gets October–December, January–March and April–June", async () => {
    expect([...(await quartersOf(ids.full))]).toEqual([
      { label: "1er trimestre", startDate: "2027-10-01", endDate: "2027-12-31" },
      { label: "2e trimestre", startDate: "2028-01-01", endDate: "2028-03-31" },
      { label: "3e trimestre", startDate: "2028-04-01", endDate: "2028-06-30" },
    ]);
  });

  it("gives each quarterly enrollment the quarters not over on its enrollment day", async () => {
    expect(await coveredBy(ids.september)).toEqual(["1er trimestre", "2e trimestre", "3e trimestre"]);
    // #291 Q1 default: the quarter already started counts in full.
    expect(await coveredBy(ids.november)).toEqual(["1er trimestre", "2e trimestre", "3e trimestre"]);
    expect(await coveredBy(ids.january)).toEqual(["2e trimestre", "3e trimestre"]);
  });

  it("an enrollment dated after the last quarter keeps the last one: still owed once", async () => {
    expect(await coveredBy(ids.late)).toEqual(["3e trimestre"]);
  });

  it("a yearly enrollment covers no quarter", async () => {
    expect(await coveredBy(ids.yearly)).toEqual([]);
  });
});
