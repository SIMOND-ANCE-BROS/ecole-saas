/**
 * Applies the migrations of `migrations/` with DATABASE_ADMIN_URL, after
 * checking that this role bypasses Row Level Security (#279).
 *
 *   npm run db:migrate
 */
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { bypassesRls, migrationRoleError, readMigrationRole } from "../src/db/migration-role";

// Locally the URL comes from .env; in CI from the environment
// (loadEnvFile does not override a variable already set).
if (existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("DATABASE_ADMIN_URL is missing: copy .env.example to .env.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

async function main(): Promise<number> {
  const role = await readMigrationRole(sql);
  if (!bypassesRls(role)) {
    console.error(migrationRoleError(role));
    return 1;
  }
  // Same journal and bookkeeping table (drizzle.__drizzle_migrations) as drizzle-kit migrate.
  await migrate(drizzle(sql), { migrationsFolder: "./migrations" });
  console.log("Migrations applied.");
  return 0;
}

main()
  .then(async (code) => {
    await sql.end();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await sql.end({ timeout: 5 });
    process.exit(1);
  });
