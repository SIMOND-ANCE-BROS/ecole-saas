import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// The session and the database are stubbed: this checks what the « Facturé à » actions accept (#227).
vi.mock("@/lib/session", () => ({
  requireRole: async () => ({ schoolId: "school-a", userId: "user-a" }),
}));
const withSchool = vi.fn();
vi.mock("@/db", () => ({ withSchool: (...args: unknown[]) => withSchool(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/db/people", () => ({ deleteRelationship: vi.fn() }));
vi.mock("@/lib/form-errors", () => ({ errorsOf: () => ({}) }));
// Same shape as `otherValidPerson` in src/db/students.ts (a known person, or a new one).
vi.mock("@/db/students", () => ({
  otherValidPerson: z.union([z.object({ id: z.uuid() }), z.object({ newPerson: z.object({ name: z.string() }) })]),
  setBilling: vi.fn(),
  billTo: vi.fn(),
}));

const { invoice, billNewPerson } = await import("./actions");

const STUDENT = "8d2c6c1e-3f4a-4b5c-9d6e-7f8091a2b3c4";
const PAYER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

beforeEach(() => withSchool.mockReset());

describe("invoice", () => {
  it("refuses an invalid student id without touching the database", async () => {
    expect(await invoice("not-a-uuid", { type: "self" })).toEqual({
      ok: false,
      message: "Choix de facturation invalide.",
    });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuses an unknown target or a person without a valid id", async () => {
    for (const target of [{ type: "guardian" }, { type: "person", id: "x" }, null, "self"]) {
      expect(await invoice(STUDENT, target)).toEqual({ ok: false, message: "Choix de facturation invalide." });
    }
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("returns ok when the payer is saved", async () => {
    withSchool.mockResolvedValueOnce({ ok: true, id: STUDENT });

    expect(await invoice(STUDENT, { type: "person", id: PAYER })).toEqual({ ok: true });
  });

  it("passes the refusal message of the database layer through", async () => {
    withSchool.mockResolvedValueOnce({ ok: false, message: "Cet élève n’existe plus." });

    expect(await invoice(STUDENT, { type: "self" })).toEqual({ ok: false, message: "Cet élève n’existe plus." });
  });
});

describe("billNewPerson", () => {
  it("refuses an invalid student id", async () => {
    expect(await billNewPerson("x", { id: PAYER })).toEqual({ ok: false, message: "Choix de facturation invalide." });
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("refuses a payer that is neither a known person nor a new one", async () => {
    for (const payer of [{ id: "x" }, {}, null, { newPerson: 3 }]) {
      expect(await billNewPerson(STUDENT, payer)).toEqual({
        ok: false,
        message: "Vérifiez les informations du payeur.",
      });
    }
    expect(withSchool).not.toHaveBeenCalled();
  });

  it("returns ok when a known payer is billed", async () => {
    withSchool.mockResolvedValueOnce({ ok: true, id: STUDENT });

    expect(await billNewPerson(STUDENT, { id: PAYER })).toEqual({ ok: true });
  });
});
