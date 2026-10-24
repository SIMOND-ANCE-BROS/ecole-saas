import { describe, expect, it } from "vitest";
import { addMonths, computeSchedule } from "./installments";

describe("computeSchedule", () => {
  it("splits an amount into monthly installments, leftover cents on the first one", () => {
    expect(computeSchedule({ amountCents: 10000, installmentCount: 3, firstDate: "2027-09-15" })).toEqual([
      { rank: 1, plannedDate: "2027-09-15", amountCents: 3334 },
      { rank: 2, plannedDate: "2027-10-15", amountCents: 3333 },
      { rank: 3, plannedDate: "2027-11-15", amountCents: 3333 },
    ]);
  });

  it("keeps a single installment for a one-off payment", () => {
    expect(computeSchedule({ amountCents: 14850, installmentCount: 1, firstDate: "2027-09-05" })).toEqual([
      { rank: 1, plannedDate: "2027-09-05", amountCents: 14850 },
    ]);
  });

  it("always adds up to the total amount, to the cent", () => {
    const installments = computeSchedule({ amountCents: 64501, installmentCount: 10, firstDate: "2027-09-01" });
    expect(installments.reduce((s, e) => s + e.amountCents, 0)).toBe(64501);
    expect(installments.at(-1)).toEqual({ rank: 10, plannedDate: "2028-06-01", amountCents: 6450 });
  });

  it("accepts another interval (quarterly)", () => {
    const dates = computeSchedule({
      amountCents: 30000,
      installmentCount: 3,
      firstDate: "2027-09-10",
      monthInterval: 3,
    }).map((e) => e.plannedDate);
    expect(dates).toEqual(["2027-09-10", "2027-12-10", "2028-03-10"]);
  });

  it("rejects invalid parameters", () => {
    const base = { amountCents: 10000, installmentCount: 3, firstDate: "2027-09-15" };
    expect(() => computeSchedule({ ...base, amountCents: 0 })).toThrow(TypeError);
    expect(() => computeSchedule({ ...base, amountCents: 99.5 })).toThrow(TypeError);
    expect(() => computeSchedule({ ...base, installmentCount: 0 })).toThrow(TypeError);
    expect(() => computeSchedule({ ...base, monthInterval: 0 })).toThrow(TypeError);
    expect(() => computeSchedule({ ...base, firstDate: "15/09/2027" })).toThrow(TypeError);
    expect(() => computeSchedule({ ...base, firstDate: "2027-02-30" })).toThrow(TypeError);
  });
});

describe("addMonths", () => {
  it("keeps the day when it exists", () => {
    expect(addMonths("2027-09-15", 1)).toBe("2027-10-15");
  });

  it("falls back to the last day of the month when the day does not exist", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2027-08-31", 1)).toBe("2027-09-30");
  });

  it("computes each date from the first one, without drifting after a short month", () => {
    // 31 January + 2 months = 31 March, not 28 March.
    expect(addMonths("2027-01-31", 2)).toBe("2027-03-31");
  });

  it("rolls over from one year to the next", () => {
    expect(addMonths("2027-11-30", 3)).toBe("2028-02-29");
  });
});
