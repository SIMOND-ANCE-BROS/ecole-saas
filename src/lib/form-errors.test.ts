import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorsOf, issuePath, topErrorsOf } from "./form-errors";
import { formFields } from "./form-fields";
import { has } from "./has";

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
type Input = z.input<typeof schema>;
const issues = (v: unknown) => {
  const r = schema.safeParse(v);
  if (r.success) throw new Error("expected a failure");
  return r.error.issues;
};

describe("form errors", () => {
  it("keys each message by the field's dotted path, first message only", () => {
    const e = errorsOf<Input>(issues({ name: "", payer: { newPerson: { siren: "12" } }, start: "b", end: "a" }));
    expect(e).toEqual({
      name: "Nom obligatoire",
      "payer.newPerson.siren": "9 chiffres",
      end: "La fin suit le début",
    });
  });

  it("keeps only the top-level field for flat forms", () => {
    const e = topErrorsOf<Input>(issues({ name: "x", payer: { newPerson: { siren: "12" } }, start: "a", end: "b" }));
    expect(e).toEqual({ payer: "9 chiffres" });
  });
});

describe("form fields", () => {
  it("reads a text value, empty when the field is absent", () => {
    const f = formFields("email", "password");
    const d = new FormData();
    d.set("email", "a@exemple.test");
    expect([f.read(d, "email"), f.read(d, "password"), f.name("email")]).toEqual(["a@exemple.test", "", "email"]);
  });
});

describe("has", () => {
  it("tells union members apart by a declared key", () => {
    const choices: ({ id: string } | { newPerson: { name: string } })[] = [{ id: "1" }, { newPerson: { name: "N" } }];
    expect(choices.map((c) => (has(c, "id") ? c.id : c.newPerson.name))).toEqual(["1", "N"]);
  });
});
