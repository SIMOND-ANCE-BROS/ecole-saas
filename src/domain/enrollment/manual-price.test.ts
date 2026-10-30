import { describe, expect, it } from "vitest";
import {
  MAX_REASON_LENGTH,
  NO_GRID_PRICE,
  REASON_REQUIRED,
  keptManualPrice,
  manualPriceRefusal,
  savedNetPrice,
} from "./manual-price";

describe("manualPriceRefusal", () => {
  it("accepts the computed price when nothing is typed", () => {
    expect(manualPriceRefusal({ computedNetCents: 14850, manual: null }, "front_desk")).toBeNull();
  });

  it("requires a price when the grid has no package for the courses", () => {
    expect(manualPriceRefusal({ computedNetCents: null, manual: null }, "front_desk")).toBe(NO_GRID_PRICE);
  });

  it("accepts a typed price with a reason for a combination missing from the grid", () => {
    expect(
      manualPriceRefusal(
        { computedNetCents: null, manual: { priceCents: 21000, reason: "Trois cours, prix convenu" } },
        "front_desk",
      ),
    ).toBeNull();
  });

  it("requires the reason for a combination missing from the grid too", () => {
    expect(manualPriceRefusal({ computedNetCents: null, manual: { priceCents: 21000, reason: "" } }, "director")).toBe(
      REASON_REQUIRED,
    );
  });

  it("accepts a price lower than the grid's with a reason (pro rata)", () => {
    expect(
      manualPriceRefusal(
        { computedNetCents: 16500, manual: { priceCents: 11000, reason: "Inscription en cours de trimestre" } },
        "front_desk",
      ),
    ).toBeNull();
  });

  it("accepts a price higher than the grid's with a reason", () => {
    expect(
      manualPriceRefusal(
        { computedNetCents: 11000, manual: { priceCents: 12000, reason: "Cours ajouté" } },
        "director",
      ),
    ).toBeNull();
  });

  it("refuses a changed price without a reason, in French", () => {
    expect(
      manualPriceRefusal({ computedNetCents: 16500, manual: { priceCents: 11000, reason: "  " } }, "front_desk"),
    ).toBe(REASON_REQUIRED);
  });

  it("needs no reason when the typed price is the computed one", () => {
    expect(
      manualPriceRefusal({ computedNetCents: 16500, manual: { priceCents: 16500, reason: "" } }, "front_desk"),
    ).toBeNull();
  });

  it("refuses a negative or fractional price", () => {
    expect(manualPriceRefusal({ computedNetCents: 100, manual: { priceCents: -1, reason: "x" } }, "director")).toBe(
      "Prix invalide.",
    );
    expect(manualPriceRefusal({ computedNetCents: 100, manual: { priceCents: 10.5, reason: "x" } }, "director")).toBe(
      "Prix invalide.",
    );
  });

  it("accepts a free enrollment with a reason", () => {
    expect(
      manualPriceRefusal({ computedNetCents: 11000, manual: { priceCents: 0, reason: "Geste" } }, "director"),
    ).toBeNull();
  });

  it("refuses a reason that is too long", () => {
    const reason = "a".repeat(MAX_REASON_LENGTH + 1);
    expect(manualPriceRefusal({ computedNetCents: 11000, manual: { priceCents: 100, reason } }, "director")).toMatch(
      /Motif trop long/,
    );
  });

  it("Q1 default: the front desk and management may change the price, a teacher may not", () => {
    const entry = { computedNetCents: 11000, manual: { priceCents: 100, reason: "Geste" } };
    expect(manualPriceRefusal(entry, "director")).toBeNull();
    expect(manualPriceRefusal(entry, "front_desk")).toBeNull();
    expect(manualPriceRefusal(entry, "teacher")).toMatch(/rôle/);
  });
});

describe("keptManualPrice", () => {
  it("keeps nothing when nothing is typed or the typed price is the computed one", () => {
    expect(keptManualPrice(11000, null)).toBeNull();
    expect(keptManualPrice(11000, { priceCents: 11000, reason: "x" })).toBeNull();
  });

  it("keeps a different price with its trimmed reason", () => {
    expect(keptManualPrice(16500, { priceCents: 11000, reason: "  Pro rata " })).toEqual({
      priceCents: 11000,
      reason: "Pro rata",
    });
  });

  it("keeps the typed price when the grid has no package", () => {
    expect(keptManualPrice(null, { priceCents: 21000, reason: "Prix convenu" })).toEqual({
      priceCents: 21000,
      reason: "Prix convenu",
    });
  });
});

describe("savedNetPrice", () => {
  it("Q2 default: the typed price is the final price, the siblings discount does not apply to it", () => {
    expect(savedNetPrice({ grossPriceCents: 16500, discountCents: 1650, manualPriceCents: 12000 })).toBe(12000);
  });

  it("without a typed price, the grid price less the discount", () => {
    expect(savedNetPrice({ grossPriceCents: 16500, discountCents: 1650, manualPriceCents: null })).toBe(14850);
  });
});
