import { describe, expect, it } from "vitest";
import { bypassesRls, migrationRoleError } from "./migration-role";

describe("bypassesRls", () => {
  it("accepts a superuser", () => {
    expect(bypassesRls({ name: "owner", superuser: true, bypassRls: false })).toBe(true);
  });

  it("accepts a BYPASSRLS role", () => {
    expect(bypassesRls({ name: "migrator", superuser: false, bypassRls: true })).toBe(true);
  });

  it("refuses a plain table owner, filtered by FORCE ROW LEVEL SECURITY", () => {
    expect(bypassesRls({ name: "owner", superuser: false, bypassRls: false })).toBe(false);
  });
});

describe("migrationRoleError", () => {
  it("names the role, the variable to fix and the issue", () => {
    const message = migrationRoleError({ name: "owner", superuser: false, bypassRls: false });
    expect(message).toContain('"owner"');
    expect(message).toContain("DATABASE_ADMIN_URL");
    expect(message).toContain("BYPASSRLS");
    expect(message).toContain("#279");
  });
});
