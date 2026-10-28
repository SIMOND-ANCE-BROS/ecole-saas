import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The session and the database are stubbed: this checks how the action reports a failure (#212).
vi.mock("@/lib/session", () => ({
  schoolContext: async () => ({ schoolId: "school-a", userId: "user-a" }),
}));
const withSchool = vi.fn();
vi.mock("@/db", () => ({ withSchool: (...args: unknown[]) => withSchool(...args) }));
vi.mock("@/db/preferences", () => ({ savePreference: vi.fn() }));
// The real domain modules (Vitest has no `@/` alias in this project).
vi.mock("@/domain/filters/columns", () => import("../../../domain/filters/columns"));
vi.mock("@/domain/filters/layout", () => import("../../../domain/filters/layout"));

const { saveColumns } = await import("./actions");

beforeEach(() => withSchool.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("saveColumns", () => {
  it("returns a retryable failure instead of throwing when the database fails", async () => {
    withSchool.mockRejectedValueOnce(
      Object.assign(new Error("connection refused for Zz Zzélève"), { name: "DbError" }),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await saveColumns("eleves", ["nom"]);

    expect(result).toEqual({ ok: false, message: "Colonnes non enregistrées : réessayez.", retryable: true });
    // Technical ids only: the list and the error name, never the error message.
    expect(log).toHaveBeenCalledWith("saveColumns failed", { list: "eleves", error: "DbError" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Zzélève");
  });

  it("does not offer a retry when the input is refused", async () => {
    const result = await saveColumns("unknown-list", ["nom"]);

    expect(result).toEqual({ ok: false, message: "Colonnes non enregistrées : réessayez.", retryable: false });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("does not offer a retry when the account is not a member of the school", async () => {
    withSchool.mockResolvedValueOnce(false);

    expect(await saveColumns("eleves", ["nom"])).toEqual({
      ok: false,
      message: "Colonnes non enregistrées : réessayez.",
      retryable: false,
    });
  });

  it("succeeds when the layout is saved", async () => {
    withSchool.mockResolvedValueOnce(true);

    expect(await saveColumns("eleves", ["nom"])).toEqual({ ok: true });
  });
});
