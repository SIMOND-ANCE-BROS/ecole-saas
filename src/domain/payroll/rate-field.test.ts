import { describe, expect, it } from "vitest";
import { courseRateLabel, rateField, type RateFieldState } from "./rate-field";

/** A course saved with 45,50 € per hour, its instructor now paid by the lesson. */
const stale: RateFieldState = {
  payMode: "per_lesson",
  ownInstructor: true,
  saved: { cents: 4550, payMode: "hourly" },
  typed: "45,50",
  convert: false,
};

describe("rateField (#268)", () => {
  it("shows an older pay mode's rate in its unit, sending nothing while untouched", () => {
    expect(rateField(stale)).toEqual({
      allowed: true,
      unused: false,
      oldUnit: "hourly",
      shownUnit: "hourly",
      sent: undefined,
    });
  });

  it("sends an amount typed differently, in the current unit", () => {
    expect(rateField({ ...stale, typed: "40" })).toMatchObject({ oldUnit: null, shownUnit: "per_lesson", sent: "40" });
  });

  it("sends an emptied field", () => {
    expect(rateField({ ...stale, typed: "" })).toMatchObject({ oldUnit: null, sent: "" });
  });

  it("sends the same amount in the current unit when asked to convert it", () => {
    expect(rateField({ ...stale, convert: true })).toMatchObject({
      oldUnit: null,
      shownUnit: "per_lesson",
      sent: "45,50",
    });
  });

  it("keeps an untouched old rate of 0 cents untouched", () => {
    expect(rateField({ ...stale, saved: { cents: 0, payMode: "hourly" }, typed: "0" })).toMatchObject({
      oldUnit: "hourly",
      sent: undefined,
    });
  });

  it("another instructor: no stored rate of theirs, what is typed is sent in their unit; and back", () => {
    const other = rateField({ ...stale, ownInstructor: false, payMode: "hourly", typed: "" });
    expect(other).toMatchObject({ oldUnit: null, shownUnit: "hourly", sent: "" });
    expect(rateField({ ...stale, ownInstructor: false, payMode: "hourly", typed: "45,50" })).toMatchObject({
      shownUnit: "hourly",
      sent: "45,50",
    });
    // Back to the course's own instructor, the saved rate restored: untouched again.
    expect(rateField(stale)).toMatchObject({ oldUnit: "hourly", sent: undefined });
  });

  it("a rate in the current unit is always sent, even unchanged", () => {
    const current = { ...stale, saved: { cents: 4550, payMode: "per_lesson" as const } };
    expect(rateField(current)).toMatchObject({ oldUnit: null, shownUnit: "per_lesson", sent: "45,50" });
  });

  it("monthly flat instructor with an unused rate: offered to be emptied, sent only when changed", () => {
    const flat = {
      ...stale,
      payMode: "monthly_flat" as const,
      saved: { cents: 3000, payMode: "monthly_flat" as const },
    };
    expect(rateField({ ...flat, typed: "30" })).toEqual({
      allowed: false,
      unused: true,
      oldUnit: null,
      // No unit for a monthly flat "rate per course".
      shownUnit: null,
      sent: undefined,
    });
    expect(rateField({ ...flat, typed: "" })).toMatchObject({ unused: true, sent: "" });
    // Its hourly rate from before the change to a monthly flat keeps its unit while untouched.
    expect(rateField({ ...flat, saved: { cents: 3000, payMode: "hourly" }, typed: "30" })).toMatchObject({
      shownUnit: "hourly",
      sent: undefined,
    });
  });

  it("a monthly flat instructor who is not the course's: nothing offered, nothing sent", () => {
    expect(rateField({ ...stale, ownInstructor: false, payMode: "monthly_flat", typed: "" })).toEqual({
      allowed: false,
      unused: false,
      oldUnit: null,
      shownUnit: null,
      sent: undefined,
    });
  });
});

describe("courseRateLabel (#268)", () => {
  it("gives the amount with its unit", () => {
    expect(courseRateLabel({ cents: 4550, payMode: "hourly" })).toMatch(/^45,50\s€ \/ heure$/);
    expect(courseRateLabel({ cents: 4000, payMode: "per_lesson" })).toMatch(/^40,00\s€ \/ séance$/);
  });

  it("never gives a monthly flat rate as « / mois »", () => {
    const label = courseRateLabel({ cents: 3000, payMode: "monthly_flat" });
    expect(label).toMatch(/^30,00\s€, tarif non utilisé \(forfait mensuel\)$/);
    expect(label).not.toContain("mois");
  });
});
