import { describe, expect, it } from "vitest";
import {
  ALREADY_SIGNED_UP,
  MAX_PARTICIPANTS,
  MAX_PRICE_CENTS,
  MAX_REASON_LENGTH,
  NO_WORKSHOP_PRICE,
  REASON_REQUIRED,
  placesLeft,
  signupDueCents,
  signupPriceRefusal,
  signupRefusal,
} from "./signup";

const ALICE = "00000000-0000-4000-8000-000000000001";
const BRUNO = "00000000-0000-4000-8000-000000000002";

describe("signupPriceRefusal", () => {
  it("accepts the workshop's price without a reason (Q1: a price per participant set on the workshop)", () => {
    expect(signupPriceRefusal({ workshopPriceCents: 4_000, priceCents: 4_000, reason: "" }, "front_desk")).toBeNull();
  });

  it("asks a reason for another price, from the front desk or management only", () => {
    const entry = { workshopPriceCents: 4_000, priceCents: 3_000, reason: " " };
    expect(signupPriceRefusal(entry, "front_desk")).toBe(REASON_REQUIRED);
    expect(signupPriceRefusal({ ...entry, reason: "Tarif réduit" }, "director")).toBeNull();
    expect(signupPriceRefusal({ ...entry, reason: "Tarif réduit" }, "teacher")).toMatch(/rôle/);
  });

  it("never records a missing price, even on a priced workshop", () => {
    expect(signupPriceRefusal({ workshopPriceCents: 4_000, priceCents: null, reason: "" }, "director")).toBe(
      "Indiquez le prix.",
    );
  });

  it("refuses a price beyond the form's bound or not in whole cents, and a reason too long", () => {
    const entry = { workshopPriceCents: 4_000, reason: "x" };
    expect(signupPriceRefusal({ ...entry, priceCents: MAX_PRICE_CENTS + 1 }, "director")).toMatch(/invalide/);
    expect(signupPriceRefusal({ ...entry, priceCents: 10.5 }, "director")).toMatch(/invalide/);
    expect(
      signupPriceRefusal({ ...entry, priceCents: 3_000, reason: "x".repeat(MAX_REASON_LENGTH + 1) }, "director"),
    ).toMatch(/trop long/);
  });

  it("needs a typed price when the workshop has none, and refuses a negative one", () => {
    expect(signupPriceRefusal({ workshopPriceCents: null, priceCents: null, reason: "" }, "director")).toBe(
      NO_WORKSHOP_PRICE,
    );
    expect(signupPriceRefusal({ workshopPriceCents: null, priceCents: 2_500, reason: "" }, "director")).toBeNull();
    expect(signupPriceRefusal({ workshopPriceCents: null, priceCents: -1, reason: "x" }, "director")).toMatch(
      /invalide/,
    );
  });
});

describe("signupRefusal", () => {
  it("needs at least one participant, each once, none already signed up", () => {
    expect(signupRefusal({ participantIds: [], alreadySignedUp: [] })).toMatch(/au moins un/);
    expect(signupRefusal({ participantIds: [ALICE, ALICE], alreadySignedUp: [] })).toMatch(/deux fois/);
    expect(signupRefusal({ participantIds: [ALICE, BRUNO], alreadySignedUp: [BRUNO] })).toBe(ALREADY_SIGNED_UP);
    expect(signupRefusal({ participantIds: [ALICE, BRUNO], alreadySignedUp: [] })).toBeNull();
    const many = Array.from({ length: MAX_PARTICIPANTS + 1 }, (_, i) => `id-${i}`);
    expect(signupRefusal({ participantIds: many, alreadySignedUp: [] })).toMatch(/au plus/);
  });
});

describe("signupDueCents", () => {
  it("is the price per participant times the participants: two children of the same payer pay twice", () => {
    expect(signupDueCents({ unitPriceCents: 4_000, participantCount: 1 })).toBe(4_000);
    expect(signupDueCents({ unitPriceCents: 4_000, participantCount: 2 })).toBe(8_000);
  });

  it("takes no siblings discount off (Q2 default)", () => {
    expect(signupDueCents({ unitPriceCents: 3_333, participantCount: 3 })).toBe(9_999);
  });
});

describe("placesLeft", () => {
  it("is null without a capacity, and never below zero", () => {
    expect(placesLeft({ maxCapacity: null, participants: 4 })).toBeNull();
    expect(placesLeft({ maxCapacity: 10, participants: 4 })).toBe(6);
    expect(placesLeft({ maxCapacity: 10, participants: 12 })).toBe(0);
  });
});
