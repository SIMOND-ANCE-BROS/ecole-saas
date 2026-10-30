import type postgres from "postgres";

/**
 * Creates the default billing entity of a test school (#298): nothing creates it
 * on its own (no trigger on school), as for a real school set up by a script.
 * Deleted with the school (ON DELETE CASCADE). Returns its id.
 */
export async function defaultEntityFor(admin: postgres.Sql, schoolId: string, name = "Zz Entreprise"): Promise<string> {
  const treatment = await treatmentFor(admin, schoolId);
  const [{ id }] = await admin<{ id: string }[]>`
    INSERT INTO billing_entity (school_id, name, legal_name, vat_regime, is_default, default_vat_treatment_id)
    VALUES (${schoolId}, ${name}, ${name}, 'not_applicable', true, ${treatment})
    RETURNING id`;
  return id;
}

/**
 * A VAT treatment of a test school (#301), an exemption unless a rate is given; created once
 * per label. Every course and lesson pack carries one (their entity's default when the
 * insert names none). Returns its id.
 */
export async function treatmentFor(
  admin: postgres.Sql,
  schoolId: string,
  rateBps = 0,
  label = rateBps ? `Zz TVA ${rateBps}` : "Zz exonéré",
): Promise<string> {
  const [{ id }] = await admin<{ id: string }[]>`
    INSERT INTO vat_treatment (school_id, label, category, rate_bps, mention)
    VALUES (${schoolId}, ${label}, ${rateBps ? "standard" : "exempt"}, ${rateBps}, ${rateBps ? null : "Zz mention"})
    ON CONFLICT (school_id, label) DO UPDATE SET label = EXCLUDED.label
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
