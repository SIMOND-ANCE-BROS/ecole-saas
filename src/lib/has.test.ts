import { describe, expect, it } from "vitest";
import { has, isKeyOf } from "./has";

describe("has", () => {
  it("tells union members apart by a declared key", () => {
    const choices: ({ id: string } | { newPerson: { name: string } })[] = [{ id: "1" }, { newPerson: { name: "N" } }];
    expect(choices.map((c) => (has(c, "id") ? c.id : c.newPerson.name))).toEqual(["1", "N"]);
  });
});

describe("isKeyOf", () => {
  it("accepts own keys only, never inherited ones", () => {
    const methods = { cash: "Espèces", cheque: "Chèque" };
    expect(["cash", "toString", "constructor", "autre"].map((k) => isKeyOf(methods, k))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});
