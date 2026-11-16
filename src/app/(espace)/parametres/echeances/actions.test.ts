import { beforeEach, describe, expect, it, vi } from "vitest";

// The session and the database are stubbed: this checks who may change the plans and what is accepted (#176).
const requireRole = vi.fn();
vi.mock("@/lib/session", () => ({ requireRole: (...args: unknown[]) => requireRole(...args) }));
const withSchool = vi.fn();
vi.mock("@/db", () => ({ withSchool: (...args: unknown[]) => withSchool(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/installment-plans", () => import("../../../../db/installment-plans"));
vi.mock("@/lib/action-result", () => import("../../../../lib/action-result"));

const { saveInstallmentPlanSetting } = await import("./actions");

const RIBAS = { counts: [1, 3, 10], dueDay: 5, roundingUnitCents: 100 };

beforeEach(() => {
  withSchool.mockReset();
  requireRole.mockReset();
  requireRole.mockResolvedValue({ schoolId: "school-a", userId: "user-a", role: "director" });
});

describe("saveInstallmentPlanSetting", () => {
  it("is for management only, checked before anything else", async () => {
    requireRole.mockRejectedValueOnce(new Error("redirect"));
    await expect(saveInstallmentPlanSetting(RIBAS)).rejects.toThrow("redirect");
    expect(requireRole).toHaveBeenCalledWith("director");
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuses no plan, a due day past the 28th or an unknown rounding, in French and without writing", async () => {
    expect(await saveInstallmentPlanSetting({ ...RIBAS, counts: [] })).toEqual({
      ok: false,
      message: "Proposez au moins un plan de paiement.",
    });
    expect(await saveInstallmentPlanSetting({ ...RIBAS, dueDay: 31 })).toEqual({
      ok: false,
      message: "Le jour d’échéance va du 1er au 28 du mois.",
    });
    expect((await saveInstallmentPlanSetting({ ...RIBAS, roundingUnitCents: 50 })).ok).toBe(false);
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("saves a valid setting within the school", async () => {
    withSchool.mockResolvedValueOnce({ ok: true });
    expect(await saveInstallmentPlanSetting({ ...RIBAS, counts: [10, 1, 3, 3] })).toEqual({ ok: true });
    expect(withSchool).toHaveBeenCalledWith("school-a", expect.any(Function));
  });
});
