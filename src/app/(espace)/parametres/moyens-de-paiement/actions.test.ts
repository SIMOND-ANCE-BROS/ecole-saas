import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAYMENT_METHOD_VALUES } from "../../../../domain/payments/methods";

// The session and the database are stubbed: this checks who may change the methods and what is accepted (#293).
const requireRole = vi.fn();
vi.mock("@/lib/session", () => ({ requireRole: (...args: unknown[]) => requireRole(...args) }));
const withSchool = vi.fn();
vi.mock("@/db", () => ({ withSchool: (...args: unknown[]) => withSchool(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/payment-methods", () => import("../../../../db/payment-methods"));
vi.mock("@/lib/action-result", () => import("../../../../lib/action-result"));

const { savePaymentMethods } = await import("./actions");

const all = (accepted: boolean) => PAYMENT_METHOD_VALUES.map((method) => ({ method, accepted, deskHint: null }));

beforeEach(() => {
  withSchool.mockReset();
  requireRole.mockReset();
  requireRole.mockResolvedValue({ schoolId: "school-a", userId: "user-a", role: "director" });
});

describe("savePaymentMethods", () => {
  it("is for management only, checked before anything else", async () => {
    requireRole.mockRejectedValueOnce(new Error("redirect"));
    await expect(savePaymentMethods(all(true))).rejects.toThrow("redirect");
    expect(requireRole).toHaveBeenCalledWith("director");
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuses accepting nothing, or a list missing a method, in French and without writing", async () => {
    expect(await savePaymentMethods(all(false))).toEqual({
      ok: false,
      message: "Cochez au moins un moyen de paiement.",
    });
    expect(await savePaymentMethods(all(true).slice(1))).toEqual({
      ok: false,
      message: "Saisie invalide : rechargez la page.",
    });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("saves within the session's school", async () => {
    withSchool.mockResolvedValueOnce({ ok: true });
    expect(await savePaymentMethods(all(true))).toEqual({ ok: true });
    expect(withSchool).toHaveBeenCalledWith("school-a", expect.any(Function));
  });
});
