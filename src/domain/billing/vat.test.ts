import { describe, expect, it } from "vitest";
import {
  formatRate,
  parseRate,
  proposedTreatment,
  treatmentRefusal,
  treatmentShapeRefusal,
  typedRate,
  type VatTreatment,
  vatBreakdown,
} from "./vat";

const TVA20: VatTreatment = { id: "t20", category: "standard", rateBps: 2000 };
const TVA55: VatTreatment = { id: "t55", category: "standard", rateBps: 550 };
const EXEMPT: VatTreatment = { id: "ex", category: "exempt", mention: "Zz mention d’exonération" };
const OUTSIDE: VatTreatment = { id: "hc", category: "not_subject", mention: "Zz hors champ" };
const ALL = [TVA20, TVA55, EXEMPT, OUTSIDE];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("vatBreakdown", () => {
  it("takes 20 % VAT out of 415,00 €: 345,83 € excl. + 69,17 €", () => {
    const b = vatBreakdown([{ inclTaxCents: 41500, vatTreatmentId: "t20" }], ALL);
    expect(b.lines).toEqual([{ inclTaxCents: 41500, exclTaxCents: 34583, vatCents: 6917 }]);
    expect(b.byTreatment).toEqual([
      { vatTreatmentId: "t20", inclTaxCents: 41500, exclTaxCents: 34583, vatCents: 6917 },
    ]);
  });

  it("computes VAT once per treatment, and takes the cents left over off the lines", () => {
    // 100,00 € each: 16,666… of VAT per line, 50,00 € on the total.
    const lines = [10000, 10000, 10000].map((inclTaxCents) => ({ inclTaxCents, vatTreatmentId: "t20" }));
    const b = vatBreakdown(lines, ALL);
    expect(b.byTreatment[0].vatCents).toBe(5000);
    // Line by line it would be 3 × 16,67 € = 50,01 €: the extra cent comes off one line.
    expect(b.lines.map((l) => l.vatCents)).toEqual([1666, 1667, 1667]);
    expect(sum(b.lines.map((l) => l.vatCents))).toBe(5000);
    expect(b.lines.map((l) => l.exclTaxCents)).toEqual([8334, 8333, 8333]);
    expect(sum(b.lines.map((l) => l.exclTaxCents))).toBe(b.byTreatment[0].exclTaxCents);
  });

  it("moves the cent left over on the lowest index when lines tie", () => {
    const lines = [100, 100, 100].map((inclTaxCents) => ({ inclTaxCents, vatTreatmentId: "t20" }));
    // 3,00 € at 20 %: 0,50 € of VAT, 16,66… cents per line (17 each, one too many).
    expect(vatBreakdown(lines, ALL).lines.map((l) => l.vatCents)).toEqual([16, 17, 17]);
  });

  it("keeps each line's own VAT when a discount nearly cancels it", () => {
    const b = vatBreakdown(
      [
        { inclTaxCents: 41500, vatTreatmentId: "t20" },
        { inclTaxCents: -41400, vatTreatmentId: "t20" },
      ],
      ALL,
    );
    // Spreading the group's 0,17 € in proportion would give the first line 70,55 € of VAT.
    expect(b.lines.map((l) => l.vatCents)).toEqual([6917, -6900]);
    expect(b.byTreatment[0].vatCents).toBe(17);
  });

  it("takes VAT off a negative discount line too", () => {
    const b = vatBreakdown(
      [
        { inclTaxCents: 30000, vatTreatmentId: "t20" },
        { inclTaxCents: -3000, vatTreatmentId: "t20" },
      ],
      ALL,
    );
    expect(b.byTreatment).toEqual([
      { vatTreatmentId: "t20", inclTaxCents: 27000, exclTaxCents: 22500, vatCents: 4500 },
    ]);
    expect(b.lines).toEqual([
      { inclTaxCents: 30000, exclTaxCents: 25000, vatCents: 5000 },
      { inclTaxCents: -3000, exclTaxCents: -2500, vatCents: -500 },
    ]);
  });

  it("mixes treatments in one breakdown: no VAT on exempt or out-of-scope lines", () => {
    const b = vatBreakdown(
      [
        { inclTaxCents: 41500, vatTreatmentId: "ex" },
        { inclTaxCents: 41500, vatTreatmentId: "t20" },
        { inclTaxCents: 10550, vatTreatmentId: "t55" },
        { inclTaxCents: -4150, vatTreatmentId: "ex" },
        { inclTaxCents: 2000, vatTreatmentId: "hc" },
      ],
      ALL,
    );
    expect(b.lines).toEqual([
      { inclTaxCents: 41500, exclTaxCents: 41500, vatCents: 0 },
      { inclTaxCents: 41500, exclTaxCents: 34583, vatCents: 6917 },
      { inclTaxCents: 10550, exclTaxCents: 10000, vatCents: 550 },
      { inclTaxCents: -4150, exclTaxCents: -4150, vatCents: 0 },
      { inclTaxCents: 2000, exclTaxCents: 2000, vatCents: 0 },
    ]);
    // Groups in the order of their first line.
    expect(b.byTreatment).toEqual([
      { vatTreatmentId: "ex", inclTaxCents: 37350, exclTaxCents: 37350, vatCents: 0 },
      { vatTreatmentId: "t20", inclTaxCents: 41500, exclTaxCents: 34583, vatCents: 6917 },
      { vatTreatmentId: "t55", inclTaxCents: 10550, exclTaxCents: 10000, vatCents: 550 },
      { vatTreatmentId: "hc", inclTaxCents: 2000, exclTaxCents: 2000, vatCents: 0 },
    ]);
  });

  it("gives no VAT to a group whose lines cancel out, each line keeping its own", () => {
    const b = vatBreakdown(
      [
        { inclTaxCents: 3000, vatTreatmentId: "t20" },
        { inclTaxCents: -3000, vatTreatmentId: "t20" },
      ],
      ALL,
    );
    expect(b.lines.map((l) => l.vatCents)).toEqual([500, -500]);
    expect(b.byTreatment[0].vatCents).toBe(0);
  });

  it("returns nothing for no line", () => {
    expect(vatBreakdown([], ALL)).toEqual({ lines: [], byTreatment: [] });
  });

  it("refuses an unknown treatment and a non-integer amount", () => {
    expect(() => vatBreakdown([{ inclTaxCents: 100, vatTreatmentId: "zz" }], ALL)).toThrow();
    expect(() => vatBreakdown([{ inclTaxCents: 100.5, vatTreatmentId: "t20" }], ALL)).toThrow(TypeError);
  });
});

describe("treatmentRefusal (regime of the business × treatment)", () => {
  it("refuses a VAT rate to a business under the 293 B franchise or not subject to VAT", () => {
    expect(treatmentRefusal("franchise_293b", "standard")).toMatch(/TVA/);
    expect(treatmentRefusal("not_applicable", "standard")).toMatch(/TVA/);
  });

  it("accepts an exemption or an out-of-scope treatment for every regime", () => {
    for (const regime of ["franchise_293b", "vat_registered", "not_applicable"] as const) {
      expect(treatmentRefusal(regime, "exempt")).toBeNull();
      expect(treatmentRefusal(regime, "not_subject")).toBeNull();
    }
  });

  it("accepts a VAT rate for a business registered for VAT", () => {
    expect(treatmentRefusal("vat_registered", "standard")).toBeNull();
  });
});

describe("treatmentShapeRefusal", () => {
  it("needs a positive rate for a VAT rate, at most 100 %", () => {
    expect(treatmentShapeRefusal({ category: "standard", rateBps: 0, mention: null })).not.toBeNull();
    expect(treatmentShapeRefusal({ category: "standard", rateBps: 10001, mention: null })).not.toBeNull();
    expect(treatmentShapeRefusal({ category: "standard", rateBps: 2000, mention: null })).toBeNull();
  });

  it("needs a mention and no rate for an exemption or out of scope", () => {
    expect(treatmentShapeRefusal({ category: "exempt", rateBps: 0, mention: null })).toMatch(/mention/i);
    expect(treatmentShapeRefusal({ category: "exempt", rateBps: 0, mention: "  " })).toMatch(/mention/i);
    expect(treatmentShapeRefusal({ category: "not_subject", rateBps: 2000, mention: "Zz" })).not.toBeNull();
    expect(treatmentShapeRefusal({ category: "exempt", rateBps: 0, mention: "Zz" })).toBeNull();
  });
});

describe("rates typed in percent", () => {
  it("reads « 20 », « 5,5 », « 2.10 % » as basis points, without floating-point", () => {
    expect(parseRate("20")).toBe(2000);
    expect(parseRate("5,5")).toBe(550);
    expect(parseRate("2.10 %")).toBe(210);
    expect(parseRate(" 10 ")).toBe(1000);
  });

  it("refuses what is not a rate", () => {
    expect(parseRate("")).toBeNull();
    expect(parseRate("vingt")).toBeNull();
    expect(parseRate("5,555")).toBeNull();
    expect(parseRate("-5")).toBeNull();
  });

  it("writes a rate back for a field and for reading", () => {
    expect(typedRate(2000)).toBe("20");
    expect(typedRate(550)).toBe("5,5");
    expect(typedRate(210)).toBe("2,1");
    expect(typedRate(5)).toBe("0,05");
    expect(formatRate(2000)).toBe("20\u00a0%");
    expect(formatRate(550)).toBe("5,5\u00a0%");
  });
});

describe("proposedTreatment (course form help)", () => {
  const allowed = ["ex", "t20"];

  it("proposes the treatment of the instructor’s last course", () => {
    expect(proposedTreatment({ instructorLast: "t20", entityDefault: "ex", allowed })).toBe("t20");
  });

  it("falls back on the business’s default, then on the first allowed one", () => {
    expect(proposedTreatment({ instructorLast: null, entityDefault: "ex", allowed })).toBe("ex");
    expect(proposedTreatment({ instructorLast: null, entityDefault: null, allowed })).toBe("ex");
    expect(proposedTreatment({ instructorLast: null, entityDefault: null, allowed: [] })).toBeNull();
  });

  it("skips a treatment the business cannot use (a VAT rate under the franchise)", () => {
    expect(proposedTreatment({ instructorLast: "t20", entityDefault: "ex", allowed: ["ex"] })).toBe("ex");
  });
});
