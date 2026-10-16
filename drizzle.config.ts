import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  // Migrations lancées avec le rôle propriétaire, pas avec app_user.
  dbCredentials: { url: process.env.DATABASE_ADMIN_URL! },
});
