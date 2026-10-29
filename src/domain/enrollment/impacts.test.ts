import { describe, expect, it } from "vitest";
import { computeTariff } from "../tariff/compute";
import { ribasGrid, ribasSiblings } from "../tariff/fixtures/ribas-grid-2026";
import type { EnrollmentRequest } from "../tariff/types";
import { discountImpacts } from "./impacts";

const child = (reference: string, minutes = 60): EnrollmentRequest => ({
  reference,
  studentIds: [`student-${reference}`],
  audience: "child",
  period: "quarter",
  courses: [{ disciplineId: "classical", durationMinutes: minutes }],
});

const price = (...enrollments: EnrollmentRequest[]) =>
  computeTariff({ grid: ribasGrid, discounts: [ribasSiblings], enrollments }).enrollments;

describe("discountImpacts", () => {
  it("reports nothing when every saved discount stays the same", () => {
    const now = price(child("a"), child("b"));
    const saved = now.map((r) => ({
      reference: r.reference,
      savedDiscountCents: r.status === "ok" ? r.discountCents : 0,
    }));
    expect(discountImpacts(saved, now)).toEqual([]);
  });

  it("three siblings, one drops out: the two others lose nothing (still siblings), nothing is reported", () => {
    const three = price(child("a"), child("b"), child("c"));
    const saved = three.map((r) => ({
      reference: r.reference,
      savedDiscountCents: r.status === "ok" ? r.discountCents : 0,
    }));
    const afterDrop = price(child("a"), child("b"));
    expect(discountImpacts(saved.slice(0, 2), afterDrop)).toEqual([]);
  });

  it("two siblings, one drops out: the other one's siblings discount would go, reported without re-pricing", () => {
    const two = price(child("a"), child("b"));
    const savedA = two.find((r) => r.reference === "a");
    if (savedA?.status !== "ok") throw new Error("expected a price");
    expect(savedA.discountCents).toBeGreaterThan(0);
    const alone = price(child("a"));
    expect(discountImpacts([{ reference: "a", savedDiscountCents: savedA.discountCents }], alone)).toEqual([
      { reference: "a", savedDiscountCents: savedA.discountCents, recalculatedDiscountCents: 0 },
    ]);
  });

  it("a trial confirmed: the sibling saved without a discount would get one, reported", () => {
    const withTrialConfirmed = price(child("a"), child("trial"));
    const a = withTrialConfirmed.find((r) => r.reference === "a");
    if (a?.status !== "ok") throw new Error("expected a price");
    expect(discountImpacts([{ reference: "a", savedDiscountCents: 0 }], withTrialConfirmed)).toEqual([
      { reference: "a", savedDiscountCents: 0, recalculatedDiscountCents: a.discountCents },
    ]);
  });

  it("does not report an enrollment the engine can no longer price", () => {
    const unpriced = price({ ...child("a"), courses: [] });
    expect(discountImpacts([{ reference: "a", savedDiscountCents: 500 }], unpriced)).toEqual([]);
  });
});
