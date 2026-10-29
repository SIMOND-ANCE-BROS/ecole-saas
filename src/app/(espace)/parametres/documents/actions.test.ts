import { beforeEach, describe, expect, it, vi } from "vitest";

// The session and the database are stubbed: this checks who may change the requirements and what is accepted (#287).
const requireRole = vi.fn();
vi.mock("@/lib/session", () => ({ requireRole: (...args: unknown[]) => requireRole(...args) }));
const withSchool = vi.fn();
vi.mock("@/db", () => ({ withSchool: (...args: unknown[]) => withSchool(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/student-documents", () => import("../../../../db/student-documents"));
vi.mock("@/lib/action-result", () => import("../../../../lib/action-result"));

const { saveDocumentRequirements } = await import("./actions");
const any = <T>(v: unknown) => v as T;

const valid = [
  { type: "medical_certificate", required: true, minorsOnly: false, validityMonths: 36, dueWithinDays: 15 },
  { type: "parental_consent", required: true, minorsOnly: true, validityMonths: null, dueWithinDays: 15 },
  { type: "image_rights", required: false, minorsOnly: false, validityMonths: null, dueWithinDays: 15 },
] as const;

beforeEach(() => {
  withSchool.mockReset();
  requireRole.mockReset();
  requireRole.mockResolvedValue({ schoolId: "school-a", userId: "user-a", role: "director" });
});

describe("saveDocumentRequirements", () => {
  it("is for management only, checked before anything else", async () => {
    requireRole.mockRejectedValueOnce(new Error("redirect"));
    await expect(saveDocumentRequirements([...valid])).rejects.toThrow("redirect");
    expect(requireRole).toHaveBeenCalledWith("director");
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuses a validity out of bounds or a document that cannot be asked, in French", async () => {
    expect(await saveDocumentRequirements([{ ...valid[0], validityMonths: 0 }])).toEqual({
      ok: false,
      message: "Validité : au moins 1 mois.",
    });
    expect(await saveDocumentRequirements([{ ...valid[0], validityMonths: 1.5 }])).toEqual({
      ok: false,
      message: "Validité : un nombre entier de mois.",
    });
    expect(await saveDocumentRequirements([any({ ...valid[0], type: "other" })])).toEqual({
      ok: false,
      message: "Document inconnu.",
    });
    expect(await saveDocumentRequirements([{ ...valid[0], dueWithinDays: Number.NaN }])).toEqual({
      ok: false,
      message: "Délai : un nombre de jours.",
    });
    expect(await saveDocumentRequirements([valid[0], valid[0]])).toEqual({ ok: false, message: "Saisie invalide." });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("saves a valid entry for the session's school", async () => {
    withSchool.mockResolvedValueOnce({ ok: true });
    expect(await saveDocumentRequirements([...valid])).toEqual({ ok: true });
    expect(withSchool).toHaveBeenCalledWith("school-a", expect.any(Function));
  });
});
