import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Guard: every table of the public schema carrying `school_id` must have
 * Row Level Security enabled AND forced, and a `school_isolation` policy
 * valid for all commands.
 *
 * Run against the real database (npm run test:integration), after the migrations.
 * We read the catalog (pg_class, pg_attribute, pg_policy) and not
 * information_schema: the latter hides the tables on which the role
 * has no privilege, precisely the case of a forgotten table.
 */

type SchoolTable = {
  table: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policy: boolean;
  policy_all_commands: boolean;
  /** USING and WITH CHECK both compare school_id with the setting app.school_id. */
  policy_reads_school: boolean;
};

const SCHOOL_TABLES_QUERY = `
  SELECT c.relname AS table,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         p.polname IS NOT NULL AS policy,
         coalesce(p.polcmd = '*', false) AS policy_all_commands,
         coalesce(
           pg_get_expr(p.polqual, p.polrelid) LIKE '%school_id = (NULLIF(current_setting(''app.school_id''%'
           AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%school_id = (NULLIF(current_setting(''app.school_id''%',
           false
         ) AS policy_reads_school
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'school_id' AND NOT a.attisdropped
  LEFT JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = 'school_isolation'
  WHERE c.relkind IN ('r', 'p')
  ORDER BY c.relname
`;

function defects(tables: SchoolTable[]): string[] {
  return tables.flatMap((t) => {
    const manques = [
      !t.rls_enabled && "RLS non activée (ENABLE ROW LEVEL SECURITY)",
      !t.rls_forced && "RLS non forcée (FORCE ROW LEVEL SECURITY)",
      !t.policy && "politique school_isolation absente",
      t.policy && !t.policy_all_commands && "school_isolation ne couvre pas toutes les commandes",
      t.policy && !t.policy_reads_school && "school_isolation ne compare pas school_id au réglage app.school_id",
    ].filter(Boolean);
    return manques.length ? [`${t.table} : ${manques.join(", ")}`] : [];
  });
}

function connection(variable: "DATABASE_URL" | "DATABASE_ADMIN_URL") {
  const url = process.env[variable];
  if (!url) throw new Error(`${variable} manquante : copier .env.example en .env`);
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Thrown to roll back the probe test's transaction while returning its result. */
class Cancellation extends Error {
  constructor(readonly result: string[]) {
    super("annulation volontaire");
  }
}

const app = connection("DATABASE_URL");
const admin = connection("DATABASE_ADMIN_URL");

afterAll(async () => {
  await Promise.all([app.end(), admin.end()]);
});

describe("Row Level Security", () => {
  it("protects every table carrying school_id", async () => {
    const tables = await app.unsafe<SchoolTable[]>(SCHOOL_TABLES_QUERY);

    // Empty database or migrations not applied: the test must not pass vacuously.
    expect(tables.length, "aucune table avec school_id : migrations appliquées ?").toBeGreaterThan(0);
    expect(defects(tables)).toEqual([]);
  });

  it("detects a table carrying school_id without RLS", async () => {
    // Checks the guard itself: a forgotten table must be reported.
    const errors = await admin
      .begin(async (tx) => {
        await tx.unsafe("CREATE TABLE garde_fou_temoin (id int, school_id uuid)");
        throw new Cancellation(defects(await tx.unsafe<SchoolTable[]>(SCHOOL_TABLES_QUERY)));
      })
      .catch((e: unknown) => {
        if (e instanceof Cancellation) return e.result;
        throw e;
      });

    // Only the probe table counts here: a real defect is reported by the previous test.
    expect(errors.filter((e) => e.startsWith("garde_fou_temoin "))).toEqual([
      "garde_fou_temoin : RLS non activée (ENABLE ROW LEVEL SECURITY), " +
        "RLS non forcée (FORCE ROW LEVEL SECURITY), politique school_isolation absente",
    ]);
  });

  it("detects a school_isolation policy reading a setting other than app.school_id", async () => {
    // A policy with the right name but a stale setting (e.g. app.ecole_id after a rename) must be reported.
    const errors = await admin
      .begin(async (tx) => {
        await tx.unsafe(`
          CREATE TABLE garde_fou_reglage (id int, school_id uuid);
          ALTER TABLE garde_fou_reglage ENABLE ROW LEVEL SECURITY;
          ALTER TABLE garde_fou_reglage FORCE ROW LEVEL SECURITY;
          CREATE POLICY school_isolation ON garde_fou_reglage
            USING (school_id = NULLIF(current_setting('app.ecole_id', true), '')::uuid)
            WITH CHECK (school_id = NULLIF(current_setting('app.ecole_id', true), '')::uuid);
        `);
        throw new Cancellation(defects(await tx.unsafe<SchoolTable[]>(SCHOOL_TABLES_QUERY)));
      })
      .catch((e: unknown) => {
        if (e instanceof Cancellation) return e.result;
        throw e;
      });

    expect(errors.filter((e) => e.startsWith("garde_fou_reglage "))).toEqual([
      "garde_fou_reglage : school_isolation ne compare pas school_id au réglage app.school_id",
    ]);
  });
});
