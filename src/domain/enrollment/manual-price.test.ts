import { describe, expect, it } from "vitest";
import {
  MAX_REASON_LENGTH,
  NO_GRID_PRICE,
  PRICE_TOO_HIGH,
  REASON_REQUIRED,
  keptManualPrice,
  manualPriceRefusal,
  readTypedPrice,
  savedNetPrice,
} from "./manual-price";

describe("readTypedPrice (the form's reading)", () => {
  it("nothing typed: sendable when the grid prices it, not off the grid", () => {
    expect(readTypedPrice(11000, null)).toMatchObject({ valid: true, differs: false });
    expect(readTypedPrice(null, null)).toMatchObject({ valid: false });
  });

  it("an empty price is missing", () => {
    expect(readTypedPrice(null, { price: " ", reason: "x" })).toMatchObject({
      valid: false,
      problem: "Indiquez le prix",
    });
  });

  it("an amount being typed (« 80, ») is not readable yet", () => {
    expect(readTypedPrice(11000, { price: "80,", reason: "x" })).toMatchObject({
      valid: false,
      problem: "Montant non reconnu",
    });
  });

  it("refuses an amount above the form's bound", () => {
    expect(readTypedPrice(11000, { price: "10000,01", reason: "x" })).toMatchObject({
      valid: false,
      problem: PRICE_TOO_HIGH,
    });
  });

  it("the computed price typed as is needs no reason", () => {
    expect(readTypedPrice(11000, { price: "110,00", reason: "" })).toMatchObject({
      cents: 11000,
      differs: false,
      valid: true,
    });
  });

  it("another price needs its reason, off the grid too", () => {
    expect(readTypedPrice(11000, { price: "80", reason: "" })).toMatchObject({
      cents: 8000,
      differs: true,
      valid: false,
    });
    expect(readTypedPrice(11000, { price: "80", reason: "Pro rata" })).toMatchObject({ valid: true });
    expect(readTypedPrice(null, { price: "80", reason: "" })).toMatchObject({ differs: true, valid: false });
  });
});

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
