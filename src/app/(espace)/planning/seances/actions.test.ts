import { beforeEach, describe, expect, it, vi } from "vitest";

// The session and the database are stubbed: this checks what the lesson and closure actions accept (#233).
const requireRole = vi.fn(async (..._roles: string[]) => ({ schoolId: "school-a", userId: "user-a" }));
vi.mock("@/lib/session", () => ({ requireRole: (...roles: string[]) => requireRole(...roles) }));
const withSchool = vi.fn();
vi.mock("@/db", () => ({ withSchool: (...args: unknown[]) => withSchool(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Vitest has no `@/` alias here: the real modules, by relative path.
vi.mock("@/db/lessons", () => import("../../../../db/lessons"));
vi.mock("@/db/schedule", () => ({ currentSeason: vi.fn(), seasonById: vi.fn() }));
vi.mock("@/domain/people/age", () => import("../../../../domain/people/age"));
vi.mock("@/lib/action-result", () => import("../../../../lib/action-result"));

const { doAttendance, replace, cancel, close, reopen, updateLessons } = await import("./actions");

const LESSON = "8d2c6c1e-3f4a-4b5c-9d6e-7f8091a2b3c4";
const PERSON = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
// Whatever the browser may send, which the types of the call sites never allow.
const anyValue = <T>(v: unknown) => v as T;

beforeEach(() => {
  withSchool.mockReset();
  requireRole.mockClear();
});

describe("doAttendance", () => {
  it("refuses an invalid lesson id without touching the database", async () => {
    expect(await doAttendance("not-a-uuid", [])).toEqual({ ok: false, message: "Cette séance n’existe plus." });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuses rows that are not a student id with present true or false", async () => {
    for (const rows of [[{ studentId: "x", present: true }], [{ studentId: PERSON, present: "yes" }], null]) {
      expect(await doAttendance(LESSON, anyValue(rows))).toEqual({ ok: false, message: "Saisie invalide." });
    }
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("returns ok without the internal id when the attendance is saved", async () => {
    withSchool.mockResolvedValueOnce({ ok: true, id: LESSON });

    expect(await doAttendance(LESSON, [{ studentId: PERSON, present: true }])).toEqual({ ok: true });
  });

  it("passes the refusal message of the database layer through", async () => {
    withSchool.mockResolvedValueOnce({ ok: false, message: "Cette séance est annulée." });

    expect(await doAttendance(LESSON, [])).toEqual({ ok: false, message: "Cette séance est annulée." });
  });
});

describe("replace", () => {
  it("refuses an invalid instructor id without touching the database", async () => {
    expect(await replace(LESSON, "x")).toEqual({ ok: false, message: "Intervenant introuvable ou inactif." });
    expect(await replace("x", PERSON)).toEqual({ ok: false, message: "Cette séance n’existe plus." });
    expect(withSchool).not.toHaveBeenCalled();
  });
});

describe("cancel", () => {
  it("refuses a value that is not true or false", async () => {
    expect(await cancel(LESSON, anyValue("true"))).toEqual({ ok: false, message: "Saisie invalide." });
    expect(withSchool).not.toHaveBeenCalled();
  });
});

describe("close", () => {
  it("refuses an invalid closure with the message of the field, without touching the database", async () => {
    expect(await close({ scope: "school", label: " ", start: "2026-11-12", end: "2026-11-12" })).toEqual({
      ok: false,
      message: "Libellé obligatoire",
    });
    expect(await close(anyValue({ scope: "everything", label: "Zz" }))).toEqual({
      ok: false,
      message: "Choix invalide.",
    });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("returns how many lessons left the planning", async () => {
    withSchool.mockResolvedValueOnce({ ok: true, removed: 3 });

    expect(await close({ scope: "school", label: "Zz vacances", start: "2026-11-12", end: "2026-11-12" })).toEqual({
      ok: true,
      removed: 3,
    });
  });

  it("passes a closure of some sites through, and refuses one without any site", async () => {
    withSchool.mockResolvedValueOnce({ ok: true, removed: 0 });
    const sites = { scope: "sites", label: "Zz travaux", start: "2026-11-12", end: "2026-11-13" } as const;

    expect(await close({ ...sites, siteIds: [PERSON] })).toEqual({ ok: true, removed: 0 });
    expect(withSchool).toHaveBeenCalledTimes(1);
    expect(await close({ ...sites, siteIds: [] })).toEqual({
      ok: false,
      message: "Choisissez au moins un site.",
    });
    expect(withSchool).toHaveBeenCalledTimes(1);
  });

  it("checks the role before reading the closure", async () => {
    requireRole.mockRejectedValueOnce(new Error("redirect to /connexion"));

    await expect(close(anyValue({ scope: "everything" }))).rejects.toThrow("redirect to /connexion");
    expect(requireRole).toHaveBeenCalledWith("director");
    expect(withSchool).not.toHaveBeenCalled();
  });
});

describe("updateLessons", () => {
  it("returns ok without the count, or the season refusal", async () => {
    withSchool.mockResolvedValueOnce({ ok: true, removed: 2 });
    expect(await updateLessons()).toEqual({ ok: true });

    withSchool.mockResolvedValueOnce({ ok: false, message: "Aucune saison n’est paramétrée." });
    expect(await updateLessons()).toEqual({ ok: false, message: "Aucune saison n’est paramétrée." });
    expect(requireRole).toHaveBeenCalledWith("director");
  });
});

describe("reopen", () => {
  it("refuses an invalid closure id without touching the database", async () => {
    expect(await reopen("x")).toEqual({ ok: false, message: "Cette fermeture n’existe plus." });
    expect(withSchool).not.toHaveBeenCalled();
  });
});
