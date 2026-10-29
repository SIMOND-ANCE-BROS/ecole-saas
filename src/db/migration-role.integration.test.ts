import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { bypassesRls, readMigrationRole } from "./migration-role";

/** Preflight of `npm run db:migrate` against the real roles (#279). */

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl || !appUrl) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is missing: copy .env.example to .env");
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
const app = postgres(appUrl, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe("migration role preflight", () => {
  it("lets the migration role (DATABASE_ADMIN_URL) migrate", async () => {
    expect(bypassesRls(await readMigrationRole(admin))).toBe(true);
  });

  it("refuses app_user, which is subject to RLS", async () => {
    const role = await readMigrationRole(app);
    expect(role).toEqual({ name: "app_user", superuser: false, bypassRls: false });
    expect(bypassesRls(role)).toBe(false);
  });
});
