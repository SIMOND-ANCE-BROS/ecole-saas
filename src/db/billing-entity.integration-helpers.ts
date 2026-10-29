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

/**
 * Creates a test school with its default billing entity (#299: every course,
 * enrollment and lesson pack belongs to one). Returns the rows of
 * `INSERT … RETURNING id`, so that it replaces that insert as is.
 */
export async function schoolWithDefaultEntity(
  admin: postgres.Sql,
  name: string,
  slug: string,
): Promise<{ id: string }[]> {
  const rows = await admin<{ id: string }[]>`INSERT INTO school (name, slug) VALUES (${name}, ${slug}) RETURNING id`;
  await defaultEntityFor(admin, rows[0].id);
  return rows;
}
