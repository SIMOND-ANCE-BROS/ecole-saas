import { beforeEach, describe, expect, it, vi } from "vitest";

// The session and the database are stubbed: this checks who may change VAT treatments and what is accepted (#301).
const requireRole = vi.fn();
vi.mock("@/lib/session", () => ({ requireRole: (...args: unknown[]) => requireRole(...args) }));
const withSchool = vi.fn();
vi.mock("@/db", () => ({ withSchool: (...args: unknown[]) => withSchool(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/vat-treatments", () => import("../../../../db/vat-treatments"));
vi.mock("@/lib/action-result", () => import("../../../../lib/action-result"));

const { changeTreatment, newTreatment, removeTreatment } = await import("./actions");
const any = <T>(v: unknown) => v as T;
const ID = "00000000-0000-4000-8000-000000000001";
const exempt = { label: "Zz exonéré", category: "exempt" as const, rate: "", mention: "Zz mention" };

beforeEach(() => {
  withSchool.mockReset();
  requireRole.mockReset();
  requireRole.mockResolvedValue({ schoolId: "school-a", userId: "user-a", role: "director" });
});

describe("VAT treatment actions", () => {
  it("are for management only, checked before anything else", async () => {
    requireRole.mockRejectedValueOnce(new Error("redirect"));
    await expect(newTreatment(exempt)).rejects.toThrow("redirect");
    expect(requireRole).toHaveBeenCalledWith("director");
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuse a rate that is not one, an exemption without mention and an unknown category, in French", async () => {
    expect(await newTreatment({ label: "Zz TVA", category: "standard", rate: "vingt", mention: "" })).toEqual({
      ok: false,
      message: "Taux en pourcentage, par exemple 20 ou 5,5",
    });
    expect(await newTreatment({ label: "Zz TVA", category: "standard", rate: "0", mention: "" })).toEqual({
      ok: false,
      message: "Taux de TVA entre 0,01 et 100 %",
    });
    expect(await newTreatment({ ...exempt, mention: "  " })).toEqual({
      ok: false,
      message: "Mention obligatoire : elle est imprimée sur les lignes de facture sans TVA.",
    });
    expect(await newTreatment(any({ ...exempt, category: "vat_exempt" }))).toEqual({
      ok: false,
      message: "Type de traitement à choisir",
    });
    expect(await changeTreatment("x", exempt)).toEqual({ ok: false, message: "Ce traitement de TVA n’existe plus." });
    expect(await removeTreatment("x")).toEqual({ ok: false, message: "Ce traitement de TVA n’existe plus." });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("let a valid treatment through, for the session's school", async () => {
    withSchool.mockResolvedValueOnce({ ok: true, id: ID });
    expect(await changeTreatment(ID, { label: "Zz TVA 20", category: "standard", rate: "20", mention: "" })).toEqual({
      ok: true,
    });
    expect(withSchool).toHaveBeenCalledWith("school-a", expect.any(Function));
  });
});
