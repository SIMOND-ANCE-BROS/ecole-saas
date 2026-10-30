import { beforeEach, describe, expect, it, vi } from "vitest";

// The session and the database are stubbed: this checks what the correction action accepts (#242).
const requireRole = vi.fn();
vi.mock("@/lib/session", () => ({ requireRole: (...args: unknown[]) => requireRole(...args) }));
vi.mock("@/lib/form-errors", () => import("../../../lib/form-errors"));
const withSchool = vi.fn();
vi.mock("@/db", () => ({ withSchool: (...args: unknown[]) => withSchool(...args) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => redirect(...args) }));
const collect = vi.fn();
const correctPayment = vi.fn();
vi.mock("@/db/payments", () => ({
  correctPayment: (...args: unknown[]) => correctPayment(...args),
  collect: (...args: unknown[]) => collect(...args),
}));
// `once` runs the creation it is given: the key handling itself is tested against the database.
const once = vi.fn();
vi.mock("@/db/submissions", () => ({ once: (...args: unknown[]) => once(...args), storedPayments: {} }));
vi.mock("@/domain/people/age", () => import("../../../domain/people/age"));
vi.mock("@/lib/action-result", () => import("../../../lib/action-result"));

const { correct, collectPayments } = await import("./actions");

const PAYMENT = "8d2c6c1e-3f4a-4b5c-9d6e-7f8091a2b3c4";
const OPENING = "4d5e6f70-8192-4a3b-8c4d-5e6f70819203";
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
  redirect.mockReset();
  collect.mockReset();
  correctPayment.mockReset();
  once.mockReset();
  once.mockImplementation((_tx, _kind, _key, _request, _stored, create: () => unknown) => create());
});

describe("correct", () => {
  it("checks the role before reading anything", async () => {
    requireRole.mockRejectedValueOnce(new Error("redirect /"));
    await expect(correct(entry({ paymentId: "not-a-uuid", amountCents: -1, back: 42 }))).rejects.toThrow("redirect /");
    expect(requireRole).toHaveBeenCalledWith("director");
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuses an invalid payment id without touching the database", async () => {
    expect(await correct({ key: OPENING, paymentId: "not-a-uuid", amountCents: 1000, back: RECORD })).toEqual(TAMPERED);
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuses a zero, negative, fractional or missing amount", async () => {
    for (const amountCents of [0, -500, 12.5, Number.NaN, "1000", null]) {
      expect(await correct(entry({ key: OPENING, paymentId: PAYMENT, amountCents, back: RECORD }))).toEqual(REFUSED);
    }
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuses a return path that is not text", async () => {
    expect(await correct(entry({ key: OPENING, paymentId: PAYMENT, amountCents: 1000, back: 42 }))).toEqual(TAMPERED);
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("passes on the database refusal, such as an amount above what is left", async () => {
    withSchool.mockResolvedValueOnce({ ok: false, message: "Au plus 20,00 € peuvent encore être corrigés." });
    expect(await correct({ key: OPENING, paymentId: PAYMENT, amountCents: 5000, back: RECORD })).toEqual({
      ok: false,
      message: "Au plus 20,00 € peuvent encore être corrigés.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns ok and refreshes the record and the payment log", async () => {
    withSchool.mockResolvedValueOnce({ ok: true });
    expect(await correct({ key: OPENING, paymentId: PAYMENT, amountCents: 1000, back: RECORD })).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(RECORD);
    expect(revalidatePath).toHaveBeenCalledWith("/encaissements");
  });

  it("does not refresh a return path that is not a student or contact record", async () => {
    withSchool.mockResolvedValueOnce({ ok: true });
    expect(
      await correct({ key: OPENING, paymentId: PAYMENT, amountCents: 1000, back: "https://example.test" }),
    ).toEqual({
      ok: true,
    });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/encaissements");
  });

  it("passes the day a deposited payment was rejected, and no day for a plain correction (#253)", async () => {
    withSchool.mockImplementation((_school, run: (tx: string) => unknown) => run("tx"));
    correctPayment.mockResolvedValue({ ok: true, ids: [] });
    await correct({ key: OPENING, paymentId: PAYMENT, amountCents: 1000, back: RECORD, rejectedOn: "2026-10-20" });
    expect(correctPayment).toHaveBeenLastCalledWith("tx", "user-a", PAYMENT, 1000, expect.any(String), "2026-10-20");
    await correct({ key: OPENING, paymentId: PAYMENT, amountCents: 1000, back: RECORD });
    expect(correctPayment).toHaveBeenLastCalledWith("tx", "user-a", PAYMENT, 1000, expect.any(String), null);
  });

  it("records through once(), keyed by the form's key, with what was sent (#260)", async () => {
    withSchool.mockImplementation((_school, run: (tx: string) => unknown) => run("tx"));
    correctPayment.mockResolvedValue({ ok: true, ids: [] });
    await correct({ key: OPENING, paymentId: PAYMENT, amountCents: 1000, back: RECORD, rejectedOn: "2026-10-20" });
    expect(once).toHaveBeenCalledWith(
      "tx",
      "payment",
      OPENING,
      { paymentId: PAYMENT, amountCents: 1000, rejectedOn: "2026-10-20" },
      expect.anything(),
      expect.any(Function),
    );
  });

  it("refuses a missing or malformed key without touching the database", async () => {
    for (const key of [undefined, "not-a-uuid"])
      expect(await correct(entry({ key, paymentId: PAYMENT, amountCents: 1000, back: RECORD }))).toEqual(TAMPERED);
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuses a rejection day that is not a date, in the words of the field", async () => {
    for (const rejectedOn of ["20/10/2026", "2026-02-31", 42])
      expect(
        await correct(entry({ key: OPENING, paymentId: PAYMENT, amountCents: 1000, back: RECORD, rejectedOn })),
      ).toEqual({
        ok: false,
        message: "Date du rejet invalide.",
      });
    expect(withSchool).not.toHaveBeenCalled();
  });
});

describe("collectPayments", () => {
  const PAYER = "2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182";
  const SUBMISSION = "3c4d5e6f-7081-4b92-8c3d-4e5f60718293";
  const PAID = [
    { method: "cash", amountCents: 1250, date: "2026-10-21", reference: null, issuer: null, plannedPayment: null },
  ];

  it("refuses a missing or malformed key before reading anything", async () => {
    expect(await collectPayments(PAYER, PAID, null, "not-a-uuid")).toEqual({ message: "Saisie invalide." });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("records through once(), keyed by the form's key, then goes back to the payer", async () => {
    withSchool.mockImplementation((_school, run: (tx: string) => unknown) => run("tx"));
    collect.mockResolvedValue({ ok: true, ids: [PAYMENT] });
    await collectPayments(PAYER, PAID, RECORD, SUBMISSION);
    expect(once).toHaveBeenCalledWith(
      "tx",
      "payment",
      SUBMISSION,
      { payerId: PAYER, entry: PAID, billingEntityId: undefined },
      expect.anything(),
      expect.any(Function),
    );
    expect(collect).toHaveBeenCalledWith("tx", "user-a", PAYER, PAID, undefined);
    expect(redirect).toHaveBeenCalledWith(`${RECORD}?encaisse=1`);
  });

  it("passes the chosen entity on, and keys the retry on it too (#300)", async () => {
    const ENTITY = "5e6f7081-92a3-4b4c-9d5e-6f708192a3b4";
    withSchool.mockImplementation((_school, run: (tx: string) => unknown) => run("tx"));
    collect.mockResolvedValue({ ok: true, ids: [PAYMENT] });
    await collectPayments(PAYER, PAID, RECORD, SUBMISSION, ENTITY);
    expect(once).toHaveBeenCalledWith(
      "tx",
      "payment",
      SUBMISSION,
      { payerId: PAYER, entry: PAID, billingEntityId: ENTITY },
      expect.anything(),
      expect.any(Function),
    );
    expect(collect).toHaveBeenCalledWith("tx", "user-a", PAYER, PAID, ENTITY);
  });

  it("refuses a malformed entity before reading anything", async () => {
    expect(await collectPayments(PAYER, PAID, RECORD, SUBMISSION, "not-a-uuid")).toEqual({
      message: "Choisissez l’entreprise qui encaisse ce paiement.",
    });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("gives the refusal back without redirecting", async () => {
    withSchool.mockImplementation((_school, run: (tx: string) => unknown) => run("tx"));
    collect.mockResolvedValue({ ok: false, message: "Payeur introuvable." });
    expect(await collectPayments(PAYER, PAID, RECORD, SUBMISSION)).toEqual({ message: "Payeur introuvable." });
    expect(redirect).not.toHaveBeenCalled();
  });
});
