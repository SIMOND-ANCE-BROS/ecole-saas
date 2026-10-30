import { describe, expect, it } from "vitest";
import { allocate, applyRate, formatEuros, parseEuros, prorate, split, typedEuros, vatOfInclusive } from "./money";

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

describe("vatOfInclusive", () => {
  it("takes 20 % VAT out of a VAT-inclusive price (415,00 € → 69,17 € of VAT, 345,83 € excl.)", () => {
    expect(vatOfInclusive(41500, 2000)).toBe(6917);
    expect(41500 - vatOfInclusive(41500, 2000)).toBe(34583);
  });

  it("rounds half a cent away from zero, on both signs", () => {
    // 0,06 € at 20 %: 6 × 2000 / 12000 = 1 exactly; 0,03 €: 0,5 cent → 1 cent.
    expect(vatOfInclusive(6, 2000)).toBe(1);
    expect(vatOfInclusive(3, 2000)).toBe(1);
    expect(vatOfInclusive(-3, 2000)).toBe(-1);
    // 0,02 €: 0,33 cent → 0.
    expect(vatOfInclusive(2, 2000)).toBe(0);
    expect(vatOfInclusive(-41500, 2000)).toBe(-6917);
  });

  it("handles other rates: 5,5 % and 10 %", () => {
    // 10550 × 550 / 10550 = 550 exactly.
    expect(vatOfInclusive(10550, 550)).toBe(550);
    // 1000 × 1000 / 11000 = 90,909… → 91.
    expect(vatOfInclusive(1000, 1000)).toBe(91);
  });

  it("is zero at a zero rate or on a zero amount", () => {
    expect(vatOfInclusive(41500, 0)).toBe(0);
    expect(vatOfInclusive(0, 2000)).toBe(0);
  });

  it("refuses a non-integer amount or rate, and a negative rate", () => {
    expect(() => vatOfInclusive(10.5, 2000)).toThrow(TypeError);
    expect(() => vatOfInclusive(1000, 20.5)).toThrow(TypeError);
    expect(() => vatOfInclusive(1000, -1)).toThrow(TypeError);
  });
});

describe("allocate", () => {
  it("spreads an amount in proportion to the weights, with an exact sum", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(6917, [20000, 15000, 6500])).toEqual([3334, 2500, 1083]);
  });

  it("gives the cents left over to the largest remainders, ties to the lowest index", () => {
    // 10 × 1/3 = 3,33 each: one cent left, to the first.
    expect(allocate(10, [1, 1, 1])).toEqual([4, 3, 3]);
    // 10 × (1, 2, 2)/5 = 2, 4, 4: nothing left over.
    expect(allocate(10, [1, 2, 2])).toEqual([2, 4, 4]);
    // 7 × (1, 1, 2)/4 = 1,75, 1,75, 3,5: the first two have the largest remainder.
    expect(allocate(7, [1, 1, 2])).toEqual([2, 2, 3]);
  });

  it("handles a negative weight (a discount line) and keeps the exact sum", () => {
    expect(allocate(4500, [30000, -3000])).toEqual([5000, -500]);
    const parts = allocate(4499, [30001, -3001, 7]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(4499);
  });

  it("is symmetric for a negative amount", () => {
    expect(allocate(-10, [1, 1, 1])).toEqual([-4, -3, -3]);
    expect(allocate(-6917, [20000, 15000, 6500])).toEqual([-3334, -2500, -1083]);
  });

  it("gives the whole amount to a single weight", () => {
    expect(allocate(6917, [41500])).toEqual([6917]);
    expect(allocate(-500, [-3000])).toEqual([-500]);
  });

  it("gives zeros for a zero amount, whatever the weights", () => {
    expect(allocate(0, [3000, -3000])).toEqual([0, 0]);
  });

  it("stays exact on large amounts (no floating-point product)", () => {
    const parts = allocate(999_999_999, [999_999_937, 999_999_929, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(999_999_999);
  });

  it("refuses weights summing to zero for a non-zero amount, and non-integers", () => {
    expect(() => allocate(10, [1, -1])).toThrow(RangeError);
    expect(() => allocate(10, [])).toThrow(RangeError);
    expect(() => allocate(10.5, [1])).toThrow(TypeError);
    expect(() => allocate(10, [1.5])).toThrow(TypeError);
  });
});
