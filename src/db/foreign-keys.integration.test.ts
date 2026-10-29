import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Guard: a foreign key between two tables carrying `school_id` must
 * match school_id to school_id (composite key, see `sameSchool` in
 * src/db/schema.ts). Foreign-key checks ignore Row Level
 * Security: a plain key would let a row point to one of another school.
 */

const QUERY_KEYS_WITHOUT_SCHOOL = `
  WITH colonne_ecole AS (
    SELECT a.attrelid AS rel, a.attnum
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid AND c.relkind IN ('r', 'p')
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE a.attname = 'school_id' AND NOT a.attisdropped
  )
  SELECT con.conrelid::regclass::text || ' → ' || con.confrelid::regclass::text
         || ' (' || con.conname || ')' AS defect
  FROM pg_constraint con
  JOIN colonne_ecole source ON source.rel = con.conrelid
  JOIN colonne_ecole cible ON cible.rel = con.confrelid
  WHERE con.contype = 'f'
    AND NOT EXISTS (
      SELECT 1 FROM unnest(con.conkey, con.confkey) AS k(colonne, colonne_cible)
      WHERE k.colonne = source.attnum AND k.colonne_cible = cible.attnum
    )
  ORDER BY 1
`;

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante : copier .env.example en .env");
const admin = postgres(url, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await admin.end();
});

async function defects(sql: postgres.Sql | postgres.TransactionSql): Promise<string[]> {
  const rows = await sql.unsafe<{ defect: string }[]>(QUERY_KEYS_WITHOUT_SCHOOL);
  return rows.map((l) => l.defect);
}

class Cancellation extends Error {
  constructor(readonly result: string[]) {
    super("annulation volontaire");
  }
}

describe("Foreign keys across schools", () => {
  it("always pair school_id with school_id", async () => {
    expect(await defects(admin)).toEqual([]);
  });

  it("detects a plain foreign key between two school tables", async () => {
    // Checks the guard itself, on rolled-back probe tables.
    const result = await admin
      .begin(async (tx) => {
        await tx.unsafe(`
          CREATE TABLE temoin_cible (id uuid PRIMARY KEY, school_id uuid NOT NULL, UNIQUE (school_id, id));
          CREATE TABLE temoin_simple (school_id uuid, cible_id uuid REFERENCES temoin_cible (id));
          CREATE TABLE temoin_composite (
            school_id uuid, cible_id uuid,
            FOREIGN KEY (school_id, cible_id) REFERENCES temoin_cible (school_id, id)
          );
          -- Three-column keys carrying the billing entity (#298): accepted when school_id pairs
          -- with school_id, reported otherwise.
          CREATE TABLE temoin_entite (
            id uuid PRIMARY KEY, school_id uuid NOT NULL, billing_entity_id uuid NOT NULL,
            UNIQUE (school_id, id, billing_entity_id)
          );
          CREATE TABLE temoin_trois (
            school_id uuid, cible_id uuid, billing_entity_id uuid,
            FOREIGN KEY (school_id, cible_id, billing_entity_id) REFERENCES temoin_entite (school_id, id, billing_entity_id)
          );
          CREATE TABLE temoin_trois_croise (
            school_id uuid, cible_id uuid, billing_entity_id uuid,
            FOREIGN KEY (billing_entity_id, cible_id, school_id) REFERENCES temoin_entite (school_id, id, billing_entity_id)
          );`);
        throw new Cancellation(await defects(tx));
      })
      .catch((e: unknown) => {
        if (e instanceof Cancellation) return e.result;
        throw e;
      });

    expect(result.filter((d) => d.startsWith("temoin_"))).toEqual([
      "temoin_simple → temoin_cible (temoin_simple_cible_id_fkey)",
      "temoin_trois_croise → temoin_entite (temoin_trois_croise_billing_entity_id_cible_id_school_id_fkey)",
    ]);
  });
});
