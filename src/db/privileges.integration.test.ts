import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Privileges of the application role `app_user`: every table and sequence of the
 * public schema is accessible to it (RLS then filters the rows), including
 * those created by a future migration (default privileges, migration 0006).
 */

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await admin.end();
});

const QUERY_WITHOUT_PRIVILEGES = `
  SELECT c.relname AS objet
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE CASE c.relkind
    WHEN 'r' THEN NOT has_table_privilege('app_user', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
    WHEN 'p' THEN NOT has_table_privilege('app_user', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
    WHEN 'S' THEN NOT has_sequence_privilege('app_user', c.oid, 'USAGE,SELECT')
    ELSE false
  END
  ORDER BY 1
`;

async function withoutPrivileges(sql: postgres.Sql | postgres.TransactionSql): Promise<string[]> {
  const rows = await sql.unsafe<{ object: string }[]>(QUERY_WITHOUT_PRIVILEGES);
  return rows.map((l) => l.object);
}

class Cancellation extends Error {
  constructor(readonly result: string[]) {
    super("annulation volontaire");
  }
}

describe("app_user privileges", () => {
  it("cover every existing table and sequence", async () => {
    expect(await withoutPrivileges(admin)).toEqual([]);
  });

  it("cover a table created by a future migration", async () => {
    // Same role as the migrations (DATABASE_ADMIN_URL), rolled-back probe table.
    const result = await admin
      .begin(async (tx) => {
        await tx.unsafe("CREATE TABLE temoin_droits (id bigserial PRIMARY KEY, school_id uuid)");
        throw new Cancellation(await withoutPrivileges(tx));
      })
      .catch((e: unknown) => {
        if (e instanceof Cancellation) return e.result;
        throw e;
      });

    expect(result).toEqual([]);
  });
});
