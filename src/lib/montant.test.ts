import { describe, expect, it } from "vitest";
import { applyRate, formatEuros, parseEuros, split } from "./montant";

describe("appliquerTaux", () => {
  it("calcule une réduction fratrie de 10 %", () => {
    expect(applyRate(31500, 1000)).toBe(3150);
  });
  it("arrondit au centime le plus proche", () => {
    expect(applyRate(1005, 1000)).toBe(101); // 100,5 → 101
  });
  it("refuse les nombres à virgule", () => {
    expect(() => applyRate(10.5, 1000)).toThrow();
  });
});

describe("repartir", () => {
  it("répartit sans perdre de centime", () => {
    const installments = split(100000, 3);
    expect(installments).toEqual([33334, 33333, 33333]);
    expect(installments.reduce((a, b) => a + b, 0)).toBe(100000);
  });
});

describe("formaterEuros", () => {
  it("formate en euros à la française", () => {
    expect(formatEuros(123456).replace(/\s/g, " ")).toBe("1 234,56 €");
  });
});

describe("lireEuros", () => {
  it("lit une saisie en euros à la française", () => {
    expect(parseEuros("40")).toBe(4000);
    expect(parseEuros("40,5")).toBe(4050);
    expect(parseEuros(" 1 234,56 € ")).toBe(123456);
    expect(parseEuros("12.30")).toBe(1230);
  });
  it("refuse plus de deux décimales, un signe ou du texte", () => {
    expect(parseEuros("1,234")).toBeNull();
    expect(parseEuros("-5")).toBeNull();
    expect(parseEuros("abc")).toBeNull();
    expect(parseEuros("")).toBeNull();
  });
});
