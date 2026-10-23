import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Garde-fou : une clé étrangère entre deux tables portant `school_id` doit
 * associer school_id à school_id (clé composite, voir `memeEcole` dans
 * src/db/schema.ts). La vérification d'une clé étrangère ignore la Row Level
 * Security : une clé simple laisserait une ligne viser celle d'une autre école.
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

describe("Clés étrangères entre écoles", () => {
  it("associent toujours school_id à school_id", async () => {
    expect(await defects(admin)).toEqual([]);
  });

  it("détecte une clé étrangère simple entre deux tables d’école", async () => {
    // Vérifie le garde-fou lui-même, sur des tables témoins annulées.
    const result = await admin
      .begin(async (tx) => {
        await tx.unsafe(`
          CREATE TABLE temoin_cible (id uuid PRIMARY KEY, school_id uuid NOT NULL, UNIQUE (school_id, id));
          CREATE TABLE temoin_simple (school_id uuid, cible_id uuid REFERENCES temoin_cible (id));
          CREATE TABLE temoin_composite (
            school_id uuid, cible_id uuid,
            FOREIGN KEY (school_id, cible_id) REFERENCES temoin_cible (school_id, id)
          );`);
        throw new Cancellation(await defects(tx));
      })
      .catch((e: unknown) => {
        if (e instanceof Cancellation) return e.result;
        throw e;
      });

    expect(result.filter((d) => d.startsWith("temoin_"))).toEqual([
      "temoin_simple → temoin_cible (temoin_simple_cible_id_fkey)",
    ]);
  });
});
