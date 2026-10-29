import { describe, expect, it } from "vitest";
import {
  courseRateAllowed,
  effectiveRate,
  rateAfterUpdate,
  rateInCurrentUnit,
  seasonBlocksPayModeChange,
  type PayMode,
  type RatedInstructor,
} from "./rate";

const hourly: RatedInstructor = { id: "i1", payMode: "hourly", rateCents: 3000 };

/** A course of `instructorId` with its own rate typed in `unit`, or no rate of its own. */
const rated = (instructorId: string, cents: number | null, unit: PayMode | null = null) => ({
  instructorId,
  instructorRateCents: cents,
  instructorRatePayMode: unit,
});

describe("effectiveRate", () => {
  it("takes the course's own rate when it is set", () => {
    expect(effectiveRate(rated("i1", 4550, "hourly"), hourly)).toBe(4550);
  });

  it("falls back to the instructor's default rate", () => {
    expect(effectiveRate(rated("i1", null), hourly)).toBe(3000);
  });

  it("keeps a course rate of zero rather than the default", () => {
    expect(effectiveRate(rated("i1", 0, "hourly"), hourly)).toBe(0);
  });

  it("applies to an instructor paid by the lesson", () => {
    const perLesson: RatedInstructor = { id: "i2", payMode: "per_lesson", rateCents: 4000 };
    expect(effectiveRate(rated("i2", 5000, "per_lesson"), perLesson)).toBe(5000);
  });

  it("gives no rate per course for a monthly flat instructor, even with a stored one (#192)", () => {
    const flat: RatedInstructor = { id: "i3", payMode: "monthly_flat", rateCents: 120000 };
    expect(effectiveRate(rated("i3", 5000, "monthly_flat"), flat)).toBeNull();
    expect(effectiveRate(rated("i3", 5000, "hourly"), flat)).toBeNull();
    expect(effectiveRate(rated("i3", null), flat)).toBeNull();
    expect(courseRateAllowed("monthly_flat")).toBe(false);
    expect(courseRateAllowed("hourly")).toBe(true);
    expect(courseRateAllowed("per_lesson")).toBe(true);
  });

  it("refuses a rate typed in another unit than the instructor's current pay mode (#268)", () => {
    const perLesson: RatedInstructor = { id: "i1", payMode: "per_lesson", rateCents: 4000 };
    // An hourly rate kept from before the change to per-lesson pay: neither it nor the default rate.
    expect(effectiveRate(rated("i1", 4550, "hourly"), perLesson)).toBeNull();
    expect(effectiveRate(rated("i1", 4550, "per_lesson"), hourly)).toBeNull();
    // The same amount in the current unit is taken.
    expect(effectiveRate(rated("i1", 4550, "per_lesson"), perLesson)).toBe(4550);
    // No rate of its own: the default rate, whatever the course's history.
    expect(effectiveRate(rated("i1", null), perLesson)).toBe(4000);
  });

  it("decides nothing for a replacement instructor (open question #192)", () => {
    const other: RatedInstructor = { id: "i9", payMode: "hourly", rateCents: 2500 };
    expect(effectiveRate(rated("i1", 4550, "hourly"), other)).toBeNull();
    expect(effectiveRate(rated("i1", null), other)).toBeNull();
  });
});

describe("rateInCurrentUnit (#268)", () => {
  it("holds only for a rate typed in the instructor's current pay mode", () => {
    expect(rateInCurrentUnit("hourly", "hourly")).toBe(true);
    expect(rateInCurrentUnit("per_lesson", "per_lesson")).toBe(true);
    expect(rateInCurrentUnit("hourly", "per_lesson")).toBe(false);
    expect(rateInCurrentUnit("per_lesson", "hourly")).toBe(false);
    expect(rateInCurrentUnit(null, "hourly")).toBe(false);
  });

  it("never holds for a monthly flat instructor (#192)", () => {
    expect(rateInCurrentUnit("monthly_flat", "monthly_flat")).toBe(false);
    expect(rateInCurrentUnit("hourly", "monthly_flat")).toBe(false);
  });
});

describe("rateAfterUpdate", () => {
  const change = (sent: number | null | undefined, typedFor: string | undefined, stored: number | null, to: string) =>
    rateAfterUpdate({ sent, typedFor, stored, oldInstructor: "x", newInstructor: to });

  it("same instructor: keeps the stored rate when none is sent, else takes the one sent", () => {
    expect(change(undefined, undefined, 4550, "x")).toBe(4550);
    expect(change(5000, "x", 4550, "x")).toBe(5000);
    expect(change(null, "x", 4550, "x")).toBeNull();
    expect(change(4550, "x", 4550, "x")).toBe(4550);
  });

  it("new instructor: keeps a rate typed for them, even the same amount typed deliberately", () => {
    expect(change(3800, "y", 4550, "y")).toBe(3800);
    expect(change(4550, "y", 4550, "y")).toBe(4550);
    expect(change(3800, "y", null, "y")).toBe(3800);
  });

  it("new instructor: drops the previous one's rate, not sent or sent for someone else", () => {
    expect(change(undefined, undefined, 4550, "y")).toBeNull();
    expect(change(4550, "x", 4550, "y")).toBeNull();
    expect(change(4550, undefined, 4550, "y")).toBeNull();
    expect(change(null, "y", null, "y")).toBeNull();
  });
});

describe("seasonBlocksPayModeChange (#192 Q5)", () => {
  const today = "2026-10-29";

  it("counts the current season", () => {
    expect(seasonBlocksPayModeChange("2027-06-30", today)).toBe(true);
  });

  it("counts a future season", () => {
    expect(seasonBlocksPayModeChange("2028-06-30", today)).toBe(true);
  });

  it("still counts a season ending today", () => {
    expect(seasonBlocksPayModeChange(today, today)).toBe(true);
  });

  it("leaves out a season that ended, even yesterday", () => {
    expect(seasonBlocksPayModeChange("2026-10-28", today)).toBe(false);
    expect(seasonBlocksPayModeChange("2026-06-30", today)).toBe(false);
  });

  it("compares dates across a year boundary", () => {
    expect(seasonBlocksPayModeChange("2026-12-31", "2027-01-01")).toBe(false);
    expect(seasonBlocksPayModeChange("2027-01-01", "2026-12-31")).toBe(true);
  });
});
