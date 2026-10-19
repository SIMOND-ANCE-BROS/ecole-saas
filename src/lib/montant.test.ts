import { describe, expect, it } from "vitest";
import { appliquerTaux, formaterEuros, lireEuros, repartir } from "./montant";

describe("appliquerTaux", () => {
  it("calcule une réduction fratrie de 10 %", () => {
    expect(appliquerTaux(31500, 1000)).toBe(3150);
  });
  it("arrondit au centime le plus proche", () => {
    expect(appliquerTaux(1005, 1000)).toBe(101); // 100,5 → 101
  });
  it("refuse les nombres à virgule", () => {
    expect(() => appliquerTaux(10.5, 1000)).toThrow();
  });
});

describe("repartir", () => {
  it("répartit sans perdre de centime", () => {
    const echeances = repartir(100000, 3);
    expect(echeances).toEqual([33334, 33333, 33333]);
    expect(echeances.reduce((a, b) => a + b, 0)).toBe(100000);
  });
});

describe("formaterEuros", () => {
  it("formate en euros à la française", () => {
    expect(formaterEuros(123456).replace(/\s/g, " ")).toBe("1 234,56 €");
  });
});

describe("lireEuros", () => {
  it("lit une saisie en euros à la française", () => {
    expect(lireEuros("40")).toBe(4000);
    expect(lireEuros("40,5")).toBe(4050);
    expect(lireEuros(" 1 234,56 € ")).toBe(123456);
    expect(lireEuros("12.30")).toBe(1230);
  });
  it("refuse plus de deux décimales, un signe ou du texte", () => {
    expect(lireEuros("1,234")).toBeNull();
    expect(lireEuros("-5")).toBeNull();
    expect(lireEuros("abc")).toBeNull();
    expect(lireEuros("")).toBeNull();
  });
});
