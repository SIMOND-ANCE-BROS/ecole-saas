import type postgres from "postgres";

/**
 * Creates the default billing entity of a test school (#298): nothing creates it
 * on its own (no trigger on school), as for a real school set up by a script.
 * Deleted with the school (ON DELETE CASCADE). Returns its id.
 */
export async function defaultEntityFor(admin: postgres.Sql, schoolId: string, name = "Zz Entreprise"): Promise<string> {
  const [{ id }] = await admin<{ id: string }[]>`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, is_default)
    VALUES (${schoolId}, ${name}, ${name}, 'not_applicable', true)
    RETURNING id`;
  return id;
}
