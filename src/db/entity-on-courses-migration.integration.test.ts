import { rmSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationsBefore } from "./migration.integration-helpers";

/**
 * Migration 0044 (#299) replayed on a throwaway database: migrated up to the
 * migration before it, filled with a course, an enrollment and a lesson pack as they
 * were before entities on courses, then migrated to the end. Checks that each row gets
 * its school's default entity and that the new keys hold. Needs a role allowed to
 * create a database (the local and CI owner role is).
 */

const MIGRATION = "0044_entity_on_courses";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

const database = `zz_migration_299_${Math.random().toString(36).slice(2, 8)}`;
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

  // Two schools with their default entity, the second also with a second entity.
  for (const key of ["school", "other"]) {
    [{ id: ids[key] }] = await db`INSERT INTO school (name, slug) VALUES (${`Zz ${key}`}, ${`zz-${key}`}) RETURNING id`;
    [{ id: ids[`${key}Entity`] }] = await db`
      INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, is_default)
      VALUES (${ids[key]}, 'Zz Entreprise', 'Zz Entreprise', 'not_applicable', true) RETURNING id`;
  }
  await db`INSERT INTO billing_entity (school_id, name, legal_name, vat_regime)
    VALUES (${ids.other}, 'Zz Seconde', 'Zz Seconde', 'not_applicable')`;
  for (const key of ["school", "other"]) {
    const s = ids[key];
    const [season] = await db`INSERT INTO season (school_id, label, start_date, end_date)
      VALUES (${s}, '2026-2027', '2026-09-01', '2027-06-30') RETURNING id`;
    const [site] = await db`INSERT INTO site (school_id, name, address) VALUES (${s}, 'Zz', 'Zz') RETURNING id`;
    const [room] = await db`INSERT INTO room (school_id, site_id, name) VALUES (${s}, ${site.id}, 'Zz') RETURNING id`;
    const [teacher] = await db`
      INSERT INTO instructor (school_id, last_name, first_name, status, vat_regime, pay_mode, rate_cents)
      VALUES (${s}, 'Zzprof', 'Zz', 'employee', 'not_applicable', 'hourly', 3000) RETURNING id`;
    const [discipline] = await db`INSERT INTO discipline (school_id, name) VALUES (${s}, 'Zzjazz') RETURNING id`;
    const [course] = await db`
      INSERT INTO course (school_id, season_id, discipline_id, room_id, instructor_id, weekday, start_time, duration_minutes)
      VALUES (${s}, ${season.id}, ${discipline.id}, ${room.id}, ${teacher.id}, 1, '17:00', 60) RETURNING id`;
    const [payer] = await db`INSERT INTO person (school_id, last_name) VALUES (${s}, 'Zzpayeur') RETURNING id`;
    const [enrollment] = await db`
      INSERT INTO enrollment (school_id, season_id, payer_id, audience, period, gross_price_cents)
      VALUES (${s}, ${season.id}, ${payer.id}, 'child', 'quarter', 11000) RETURNING id`;
    await db`INSERT INTO enrollment_course (school_id, enrollment_id, student_id, course_id)
      VALUES (${s}, ${enrollment.id}, ${payer.id}, ${course.id})`;
    await db`INSERT INTO lesson_pack (school_id, payer_id, people_count, lesson_count, price_cents)
      VALUES (${s}, ${payer.id}, 1, 5, 20000)`;
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
  it("gives every course, enrollment, enrollment course and lesson pack its school's default entity", async () => {
    for (const t of ["course", "enrollment", "enrollment_course", "lesson_pack"]) {
      const rows = await db.unsafe<{ school: string; entity: string }[]>(
        `SELECT DISTINCT school_id AS school, billing_entity_id AS entity FROM ${t} ORDER BY 1`,
      );
      expect(rows, t).toEqual(
        [
          { school: ids.school, entity: ids.schoolEntity },
          { school: ids.other, entity: ids.otherEntity },
        ].sort((a, b) => a.school.localeCompare(b.school)),
      );
    }
  });

  it("makes the column mandatory", async () => {
    const columns = await db`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE column_name = 'billing_entity_id'
        AND table_name IN ('course', 'enrollment', 'enrollment_course', 'lesson_pack')
      ORDER BY table_name`;
    expect(columns.map((c) => `${c.table_name} ${c.is_nullable}`)).toEqual([
      "course NO",
      "enrollment NO",
      "enrollment_course NO",
      "lesson_pack NO",
    ]);
  });

  it("refuses afterwards to move an enrolled course to another entity", async () => {
    const [second] = await db`SELECT id FROM billing_entity WHERE school_id = ${ids.other} AND NOT is_default`;
    await expect(db`UPDATE course SET billing_entity_id = ${second.id} WHERE school_id = ${ids.other}`).rejects.toThrow(
      /enrollment_course_course_same_entity_fk/,
    );
  });
});
