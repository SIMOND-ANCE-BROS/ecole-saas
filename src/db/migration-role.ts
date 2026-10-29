import type postgres from "postgres";

/**
 * Preflight of `npm run db:migrate` (#279).
 *
 * Business tables have `FORCE ROW LEVEL SECURITY`: even their owner is
 * filtered unless it is a superuser or has `BYPASSRLS`. A data backfill inside
 * a migration (0019, 0036…) runs without `app.school_id`, so with any other
 * role it silently matches no row. Migrations therefore refuse to run then.
 */

/** Attributes of the connected role, as read from `pg_roles`. */
export type MigrationRole = {
  name: string;
  superuser: boolean;
  bypassRls: boolean;
};

/** True when the role sees every row despite forced RLS. */
export function bypassesRls(role: MigrationRole): boolean {
  return role.superuser || role.bypassRls;
}

/** Error shown when the migration role would be filtered by RLS. */
export function migrationRoleError(role: MigrationRole): string {
  return (
    `Refusing to migrate: role "${role.name}" is neither a superuser nor BYPASSRLS. ` +
    "Business tables use FORCE ROW LEVEL SECURITY, so data backfills inside migrations " +
    "would silently update no row. DATABASE_ADMIN_URL must connect as a superuser or a " +
    "role with BYPASSRLS (see #279 and docs/adr/0001-multi-school-row-level-security.md)."
  );
}

/** Reads the attributes of the role the connection runs as. */
export async function readMigrationRole(sql: postgres.Sql): Promise<MigrationRole> {
  const rows = await sql<{ name: string; superuser: boolean; bypass_rls: boolean }[]>`
    select rolname as name, rolsuper as superuser, rolbypassrls as bypass_rls
    from pg_roles
    where rolname = current_user
  `;
  const row = rows[0];
  if (!row) throw new Error("Current role not found in pg_roles.");
  return { name: row.name, superuser: row.superuser, bypassRls: row.bypass_rls };
}
