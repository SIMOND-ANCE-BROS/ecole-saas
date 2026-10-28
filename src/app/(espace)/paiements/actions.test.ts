import { beforeEach, describe, expect, it, vi } from "vitest";

// The session and the database are stubbed: this checks what the correction action accepts (#242).
const requireRole = vi.fn();
vi.mock("@/lib/session", () => ({ requireRole: (...args: unknown[]) => requireRole(...args) }));
vi.mock("@/lib/form-errors", () => import("../../../lib/form-errors"));
const withSchool = vi.fn();
vi.mock("@/db", () => ({ withSchool: (...args: unknown[]) => withSchool(...args) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/db/payments", () => ({ correctPayment: vi.fn(), collect: vi.fn() }));
vi.mock("@/domain/people/age", () => import("../../../domain/people/age"));
vi.mock("@/lib/action-result", () => import("../../../lib/action-result"));

const { correct } = await import("./actions");

const PAYMENT = "8d2c6c1e-3f4a-4b5c-9d6e-7f8091a2b3c4";
const RECORD = "/eleves/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
// Whatever the browser may send, which the types of the call site never allow.
const entry = (v: unknown) => v as Parameters<typeof correct>[0];
const REFUSED = { ok: false, message: "Montant de la correction invalide." };
const TAMPERED = { ok: false, message: "Correction impossible : rechargez la fiche." };

beforeEach(() => {
  withSchool.mockReset();
  revalidatePath.mockReset();
  requireRole.mockReset();
  requireRole.mockResolvedValue({ schoolId: "school-a", userId: "user-a" });
});

describe("correct", () => {
  it("checks the role before reading anything", async () => {
    requireRole.mockRejectedValueOnce(new Error("redirect /"));
    await expect(correct(entry({ paymentId: "not-a-uuid", amountCents: -1, back: 42 }))).rejects.toThrow("redirect /");
    expect(requireRole).toHaveBeenCalledWith("director");
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuses an invalid payment id without touching the database", async () => {
    expect(await correct({ paymentId: "not-a-uuid", amountCents: 1000, back: RECORD })).toEqual(TAMPERED);
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuses a zero, negative, fractional or missing amount", async () => {
    for (const amountCents of [0, -500, 12.5, Number.NaN, "1000", null]) {
      expect(await correct(entry({ paymentId: PAYMENT, amountCents, back: RECORD }))).toEqual(REFUSED);
    }
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuses a return path that is not text", async () => {
    expect(await correct(entry({ paymentId: PAYMENT, amountCents: 1000, back: 42 }))).toEqual(TAMPERED);
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("passes on the database refusal, such as an amount above what is left", async () => {
    withSchool.mockResolvedValueOnce({ ok: false, message: "Au plus 20,00 € peuvent encore être corrigés." });
    expect(await correct({ paymentId: PAYMENT, amountCents: 5000, back: RECORD })).toEqual({
      ok: false,
      message: "Au plus 20,00 € peuvent encore être corrigés.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns ok and refreshes the record and the payment log", async () => {
    withSchool.mockResolvedValueOnce({ ok: true });
    expect(await correct({ paymentId: PAYMENT, amountCents: 1000, back: RECORD })).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(RECORD);
    expect(revalidatePath).toHaveBeenCalledWith("/encaissements");
  });

  it("does not refresh a return path that is not a student or contact record", async () => {
    withSchool.mockResolvedValueOnce({ ok: true });
    expect(await correct({ paymentId: PAYMENT, amountCents: 1000, back: "https://example.test" })).toEqual({
      ok: true,
    });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/encaissements");
  });
});
