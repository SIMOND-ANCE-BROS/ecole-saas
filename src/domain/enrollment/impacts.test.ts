import { describe, expect, it } from "vitest";
import { computeTariff } from "../tariff/compute";
import { ribasGrid, ribasSiblings } from "../tariff/fixtures/ribas-grid-2026";
import type { EnrollmentRequest } from "../tariff/types";
import { discountImpacts, raisedNow, raisesMayApply } from "./impacts";

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

  it("two siblings, the most expensive drops out: the other one's siblings discount would go, reported", () => {
    const two = price(child("a", 60), child("b", 45));
    const savedB = two.find((r) => r.reference === "b");
    if (savedB?.status !== "ok") throw new Error("expected a price");
    expect(savedB.discountCents).toBe(850);
    const alone = price(child("b", 45));
    expect(discountImpacts([{ reference: "b", savedDiscountCents: 850 }], alone)).toEqual([
      { reference: "b", savedDiscountCents: 850, recalculatedDiscountCents: 0 },
    ]);
  });

  it("a more expensive sibling confirmed: the child saved at full price would now get the discount (#290)", () => {
    const withTrialConfirmed = price(child("a", 45), child("trial", 60));
    expect(discountImpacts([{ reference: "a", savedDiscountCents: 0 }], withTrialConfirmed)).toEqual([
      { reference: "a", savedDiscountCents: 0, recalculatedDiscountCents: 850 },
    ]);
  });

  it("a cheaper sibling confirmed: the child saved at full price keeps it, nothing is reported (#290)", () => {
    const withTrialConfirmed = price(child("a", 60), child("trial", 45));
    expect(discountImpacts([{ reference: "a", savedDiscountCents: 0 }], withTrialConfirmed)).toEqual([]);
  });

  it("does not report an enrollment the engine can no longer price", () => {
    const unpriced = price({ ...child("a"), courses: [] });
    expect(discountImpacts([{ reference: "a", savedDiscountCents: 500 }], unpriced)).toEqual([]);
  });
});

describe("raisesMayApply (#290, #155 Q2)", () => {
  it("lets raises apply when no saved discount goes down", () => {
    expect(raisesMayApply([{ reference: "a", savedDiscountCents: 0, recalculatedDiscountCents: 850 }])).toBe(true);
  });

  it("holds every raise back when the same arrival lowers another sibling (a child moving up the ranking)", () => {
    // B 150 € at full price, A 110 € with 11 € off; A enrolls again at 85 € elsewhere and becomes the most expensive.
    const b = { ...child("b", 90), studentIds: ["student-b"] };
    const a1 = { ...child("a1", 60), studentIds: ["student-a"] };
    const a2 = { ...child("a2", 45), studentIds: ["student-a"] };
    const grid = [...ribasGrid];
    const now = computeTariff({ grid, discounts: [ribasSiblings], enrollments: [b, a1, a2] }).enrollments;
    const impacts = discountImpacts(
      [
        { reference: "b", savedDiscountCents: 0 },
        { reference: "a1", savedDiscountCents: 1100 },
      ],
      now,
    );
    expect(impacts).toEqual([
      { reference: "b", savedDiscountCents: 0, recalculatedDiscountCents: 1500 },
      { reference: "a1", savedDiscountCents: 1100, recalculatedDiscountCents: 0 },
    ]);
    expect(raisesMayApply(impacts)).toBe(false);
  });
});

describe("raisedNow (#155 Q2)", () => {
  const raised = { reference: "a", savedDiscountCents: 0, recalculatedDiscountCents: 850 };
  const free = { manual: false, invoiced: false, paidDraft: false, sameGross: true };

  it("applies a raised discount at once to an enrollment no invoice bills yet", () => {
    expect(raisedNow(raised, free)).toBe(true);
  });

  it("only reports it once an invoice other than an unsent draft bills the enrollment", () => {
    expect(raisedNow(raised, { ...free, invoiced: true })).toBe(false);
  });

  it("only reports it when a payment is allocated to the unsent draft billing it", () => {
    expect(raisedNow(raised, { ...free, paidDraft: true })).toBe(false);
  });

  it("never re-prices a typed price, nor an enrollment whose grid price changed since", () => {
    expect(raisedNow(raised, { ...free, manual: true })).toBe(false);
    expect(raisedNow(raised, { ...free, sameGross: false })).toBe(false);
  });

  it("never applies a lowered discount (a sibling leaving)", () => {
    expect(raisedNow({ reference: "a", savedDiscountCents: 850, recalculatedDiscountCents: 0 }, free)).toBe(false);
  });
});
