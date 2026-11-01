import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The season of a rules signature comes from the record shown (#362), so from the browser:
 * a malformed id is refused before anything is read. The database checks (another school's
 * season refused under RLS) are in src/db/internal-rules.integration.test.ts.
 */

const calls = vi.hoisted(() => ({ withSchool: 0 }));
vi.mock("@/lib/session", () => ({
  requireRole: async () => ({ schoolId: "s", userId: "u", role: "front_desk" }),
}));
vi.mock("@/db", () => ({
  withSchool: async () => {
    calls.withSchool++;
    return { ok: true };
  },
}));
vi.mock("@/db/internal-rules", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/domain/people/age", () => ({ todayInParis: () => "2027-06-20" }));
vi.mock("@/lib/action-result", () => ({ actionResult: (r: unknown) => r }));

const { signRules, unsignRules } = await import("./rules-actions");

const PAYER = "11111111-1111-4111-8111-111111111111";
const SEASON = "22222222-2222-4222-8222-222222222222";
const INVALID = { ok: false, message: "Saisie invalide : rechargez la fiche." };

beforeEach(() => {
  calls.withSchool = 0;
});

describe("signRules and unsignRules: the season shown (#362)", () => {
  it("refuses a malformed season without reading the database", async () => {
    for (const season of ["", "abc", `${SEASON}x`]) {
      expect(await signRules(PAYER, season, "2027-06-20")).toEqual(INVALID);
      expect(await unsignRules(PAYER, season)).toEqual(INVALID);
    }
    expect(calls.withSchool).toBe(0);
  });

  it("goes on to the database with a well-formed season", async () => {
    expect(await signRules(PAYER, SEASON, "2027-06-20")).toEqual({ ok: true });
    expect(await unsignRules(PAYER, SEASON)).toEqual({ ok: true });
    expect(calls.withSchool).toBe(2);
  });
});
