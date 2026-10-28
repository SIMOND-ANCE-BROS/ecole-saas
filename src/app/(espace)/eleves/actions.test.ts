import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { has } from "../../../lib/has";

// The session and the database are stubbed: this checks what the « Facturé à » actions accept (#227).
vi.mock("@/lib/session", () => ({
  requireRole: async () => ({ schoolId: "school-a", userId: "user-a" }),
}));
const withSchool = vi.fn();
vi.mock("@/db", () => ({ withSchool: (...args: unknown[]) => withSchool(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/db/people", () => ({ deleteRelationship: vi.fn() }));
vi.mock("@/lib/form-errors", () => import("../../../lib/form-errors"));
// `otherValidPerson` as in src/db/students.ts, on the real person schema (Vitest has no `@/` alias here).
vi.mock("@/db/students", async () => {
  const { validPersonInput } = await import("../../../db/people");
  return {
    otherValidPerson: z.union([z.object({ id: z.uuid() }), z.object({ newPerson: validPersonInput })]),
    setBilling: vi.fn(),
    billTo: vi.fn(),
  };
});
// What the record really sends: `toInput` of the person search (its own imports are stubbed or real).
vi.mock("../_people/actions", () => ({ searchPeopleAction: vi.fn() }));
vi.mock("@/domain/people/name", () => import("../../../domain/people/name"));
vi.mock("@/domain/people/age", () => import("../../../domain/people/age"));
vi.mock("@/lib/deferred-query", () => ({ deferredQuery: vi.fn() }));
vi.mock("@/lib/has", () => import("../../../lib/has"));

const { invoice, billNewPerson } = await import("./actions");
const { newPerson, toInput } = await import("../_people/person-choice");

const STUDENT = "8d2c6c1e-3f4a-4b5c-9d6e-7f8091a2b3c4";
const PAYER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
// Whatever the browser may send, which the types of the call sites never allow.
const target = (v: unknown) => v as Parameters<typeof invoice>[1];
const payer = (v: unknown) => v as Parameters<typeof billNewPerson>[1];

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
    for (const t of [{ type: "guardian" }, { type: "person", id: "x" }, null, "self"]) {
      expect(await invoice(STUDENT, target(t))).toEqual({ ok: false, message: "Choix de facturation invalide." });
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
    for (const p of [{ id: "x" }, {}, null, { newPerson: 3 }]) {
      expect(await billNewPerson(STUDENT, payer(p))).toEqual({
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

  it("accepts a new organisation as sent by the record, and refuses it without its SIREN", async () => {
    const choice = newPerson("organisation");
    if (!has(choice, "newPerson")) throw new Error("newPerson() builds a new person");
    const cse = { newPerson: { ...choice.newPerson, companyName: "Zz CSE Démo", siren: "000 000 001" } };
    withSchool.mockResolvedValueOnce({ ok: true, id: STUDENT });

    expect(await billNewPerson(STUDENT, toInput(cse))).toEqual({ ok: true });
    expect(await billNewPerson(STUDENT, toInput({ newPerson: { ...cse.newPerson, siren: "" } }))).toEqual({
      ok: false,
      message: "Vérifiez les informations du payeur.",
    });
    expect(withSchool).toHaveBeenCalledTimes(1);
  });
});
