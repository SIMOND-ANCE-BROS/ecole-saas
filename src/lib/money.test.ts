import { describe, expect, it } from "vitest";
import { applyRate, formatEuros, parseEuros, prorate, split, typedEuros } from "./money";

describe("prorate", () => {
  it("prices minutes at an hourly rate, half a cent up", () => {
    expect(prorate(2500, 90, 60)).toBe(3750);
    expect(prorate(2501, 45, 60)).toBe(1876); // 18,7575 €
    expect(prorate(30, 5, 60)).toBe(3); // exactly 2,5 cents: up
    expect(prorate(1, 30, 60)).toBe(1); // half a cent: up
    expect(prorate(1, 29, 60)).toBe(0);
  });

  it("gives zero for a zero rate or no time", () => {
    expect(prorate(0, 90, 60)).toBe(0);
    expect(prorate(2500, 0, 60)).toBe(0);
  });

  it("rounds with an odd denominator too", () => {
    expect(prorate(100, 1, 3)).toBe(33);
    expect(prorate(200, 1, 3)).toBe(67);
  });

  it("refuses non-integers, negatives and a zero denominator", () => {
    expect(() => prorate(25.5, 60, 60)).toThrow(TypeError);
    expect(() => prorate(-1, 60, 60)).toThrow(TypeError);
    expect(() => prorate(100, 1, 0)).toThrow(TypeError);
  });
});

describe("applyRate", () => {
  it("computes a 10 % siblings discount", () => {
    expect(applyRate(31500, 1000)).toBe(3150);
  });
  it("rounds to the nearest cent", () => {
    expect(applyRate(1005, 1000)).toBe(101); // 100.5 → 101
  });
  it("rejects floating-point numbers", () => {
    expect(() => applyRate(10.5, 1000)).toThrow();
  });
});

describe("split", () => {
  it("splits without losing a cent", () => {
    const installments = split(100000, 3);
    expect(installments).toEqual([33334, 33333, 33333]);
    expect(installments.reduce((a, b) => a + b, 0)).toBe(100000);
  });
});

describe("formatEuros", () => {
  it("formats in euros the French way", () => {
    expect(formatEuros(123456).replace(/\s/g, " ")).toBe("1 234,56 €");
  });

  it("writes a negative amount with the typographic minus, not a hyphen", () => {
    expect(formatEuros(-1250).replace(/\s/g, " ")).toBe("−12,50 €");
    expect(formatEuros(-1250)).not.toContain("-");
    expect(formatEuros(-0).replace(/\s/g, " ")).toBe("0,00 €");
  });
});

describe("parseEuros", () => {
  it("reads an input in euros written the French way", () => {
    expect(parseEuros("40")).toBe(4000);
    expect(parseEuros("40,5")).toBe(4050);
    expect(parseEuros(" 1 234,56 € ")).toBe(123456);
    expect(parseEuros("12.30")).toBe(1230);
  });
  it("rejects more than two decimals, a sign or text", () => {
    expect(parseEuros("1,234")).toBeNull();
    expect(parseEuros("-5")).toBeNull();
    expect(parseEuros("abc")).toBeNull();
    expect(parseEuros("")).toBeNull();
  });
});

describe("typedEuros", () => {
  it("writes cents as euros to edit, read back unchanged by parseEuros", () => {
    expect(typedEuros(3500)).toBe("35");
    expect(typedEuros(3550)).toBe("35,50");
    expect(typedEuros(3505)).toBe("35,05");
    expect(typedEuros(0)).toBe("0");
    for (const cents of [0, 5, 99, 100, 3550, 123456]) expect(parseEuros(typedEuros(cents))).toBe(cents);
  });

  it("refuses a negative or non-integer amount", () => {
    expect(() => typedEuros(-1)).toThrow(TypeError);
    expect(() => typedEuros(12.5)).toThrow(TypeError);
  });
});
