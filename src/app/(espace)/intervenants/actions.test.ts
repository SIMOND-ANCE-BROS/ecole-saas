import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/**
 * « Synchroniser maintenant » (#377): a sync that throws (its connection unreadable, or its own
 * error not recorded) must come back as a French message, never as an exception. The session
 * and the sync are stubbed; nothing touches the database.
 */
const SCHOOL = "5b0c1d2e-0000-4000-8000-000000000001";
const INSTRUCTOR = "5b0c1d2e-0000-4000-8000-000000000002";

vi.mock("@/lib/session", () => ({
  requireRole: async () => ({ schoolId: "5b0c1d2e-0000-4000-8000-000000000001", userId: "user-a", role: "director" }),
}));
vi.mock("@/db", () => ({ withSchool: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
// Modules the other actions use: never reached here.
vi.mock("@/db/calendar-feed", () => ({}));
vi.mock("@/db/calendar-connections", () => ({}));
vi.mock("@/db/unavailabilities", () => ({}));
vi.mock("@/db/instructors", () => ({}));
vi.mock("@/domain/people/age", () => ({}));
vi.mock("@/domain/schedule/availability", () => ({}));
vi.mock("@/lib/public-calendar", () => ({}));
vi.mock("@/lib/money", () => ({}));
vi.mock("@/lib/form-errors", () => ({}));
// Vitest has no `@/` alias: the real modules, by relative path.
vi.mock("@/lib/form-fields", () => import("../../../lib/form-fields"));
const syncCalendar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/calendar-sync", async () => ({
  ...(await import("../../../lib/calendar-sync")),
  syncCalendar,
}));

const { syncNow } = await import("./actions");

let logged: MockInstance<typeof console.error>;
beforeEach(() => {
  syncCalendar.mockReset();
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => logged.mockRestore());

describe("syncNow", () => {
  it("answers a French message when the sync throws, and logs ids and the error kind only (#377)", async () => {
    // A failed write may quote the row's values in its message: never in the log nor to the user.
    const e = Object.assign(new Error("write failed: refresh token zz-secret for Zz Camille"), { code: "57P01" });
    syncCalendar.mockRejectedValueOnce(e);

    expect(await syncNow(INSTRUCTOR)).toEqual({
      ok: false,
      message: "Synchronisation impossible pour le moment ; elle sera retentée.",
    });
    expect(syncCalendar).toHaveBeenCalledWith(SCHOOL, INSTRUCTOR);
    expect(logged).toHaveBeenCalledOnce();
    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toContain(SCHOOL);
    expect(line).toContain(INSTRUCTOR);
    expect(line).toContain("Error 57P01");
    for (const leak of ["write failed", "zz-secret", "Camille"]) expect(line).not.toContain(leak);
  });

  it("passes on a recorded failure's message without logging", async () => {
    syncCalendar.mockResolvedValueOnce({ ok: false, message: "Accès à l’agenda retiré." });
    expect(await syncNow(INSTRUCTOR)).toEqual({ ok: false, message: "Accès à l’agenda retiré." });
    expect(logged).not.toHaveBeenCalled();
  });

  it("refuses a malformed id before syncing or logging", async () => {
    expect(await syncNow("zz-pas-un-id")).toEqual({ ok: false, message: "Intervenant introuvable." });
    expect(syncCalendar).not.toHaveBeenCalled();
    expect(logged).not.toHaveBeenCalled();
  });

  it("counts the busy ranges read", async () => {
    syncCalendar.mockResolvedValueOnce({ ok: true, ranges: 2 });
    expect(await syncNow(INSTRUCTOR)).toEqual({ ok: true, message: "Agenda mis à jour : 2 plages occupées." });
  });
});
