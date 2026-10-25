import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorsOf, issuePath, topErrorsOf } from "./form-errors";

const fields = z.object({
  name: z.string().min(1, "Nom obligatoire"),
  payer: z.object({ newPerson: z.object({ siren: z.string().length(9, "9 chiffres") }) }),
  start: z.string(),
  end: z.string(),
});
const schema = fields.refine((v) => v.end > v.start, {
  path: issuePath(fields, "end"),
  message: "La fin suit le début",
});
const failure = (v: unknown) => {
  const r = schema.safeParse(v);
  if (r.success) throw new Error("expected a failure");
  return r.error;
};

describe("form errors", () => {
  it("keys each message by the field's dotted path, first message only", () => {
    expect(errorsOf(failure({ name: "", payer: { newPerson: { siren: "12" } }, start: "b", end: "a" }))).toEqual({
      name: "Nom obligatoire",
      "payer.newPerson.siren": "9 chiffres",
      end: "La fin suit le début",
    });
  });

  it("keeps only the top-level field for flat forms", () => {
    expect(topErrorsOf(failure({ name: "x", payer: { newPerson: { siren: "12" } }, start: "a", end: "b" }))).toEqual({
      payer: "9 chiffres",
    });
  });

  it("ignores a root issue, which belongs to no field", () => {
    expect(errorsOf(failure("not an object"))).toEqual({});
  });
});
