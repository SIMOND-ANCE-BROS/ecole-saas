import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Droits du rôle applicatif `app_user` : toute table et séquence du schéma
 * public lui est accessible (la RLS filtre ensuite les lignes), y compris
 * celles créées par une migration future (droits par défaut, migration 0006).
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

describe("Droits de app_user", () => {
  it("couvrent toutes les tables et séquences existantes", async () => {
    expect(await withoutPrivileges(admin)).toEqual([]);
  });

  it("couvrent une table créée par une migration future", async () => {
    // Même rôle que les migrations (DATABASE_ADMIN_URL), table témoin annulée.
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
