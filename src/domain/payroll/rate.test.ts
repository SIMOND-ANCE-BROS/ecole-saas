import { describe, expect, it } from "vitest";
import {
  courseRateAllowed,
  effectiveRate,
  rateAfterUpdate,
  seasonBlocksPayModeChange,
  type RatedInstructor,
} from "./rate";

const hourly: RatedInstructor = { id: "i1", payMode: "hourly", rateCents: 3000 };

describe("effectiveRate", () => {
  it("takes the course's own rate when it is set", () => {
    expect(effectiveRate({ instructorId: "i1", instructorRateCents: 4550 }, hourly)).toBe(4550);
  });

  it("falls back to the instructor's default rate", () => {
    expect(effectiveRate({ instructorId: "i1", instructorRateCents: null }, hourly)).toBe(3000);
  });

  it("keeps a course rate of zero rather than the default", () => {
    expect(effectiveRate({ instructorId: "i1", instructorRateCents: 0 }, hourly)).toBe(0);
  });

  it("applies to an instructor paid by the lesson", () => {
    const perLesson: RatedInstructor = { id: "i2", payMode: "per_lesson", rateCents: 4000 };
    expect(effectiveRate({ instructorId: "i2", instructorRateCents: 5000 }, perLesson)).toBe(5000);
  });

  it("gives no rate per course for a monthly flat instructor, even with a stored one (#192)", () => {
    const flat: RatedInstructor = { id: "i3", payMode: "monthly_flat", rateCents: 120000 };
    expect(effectiveRate({ instructorId: "i3", instructorRateCents: 5000 }, flat)).toBeNull();
    expect(effectiveRate({ instructorId: "i3", instructorRateCents: null }, flat)).toBeNull();
    expect(courseRateAllowed("monthly_flat")).toBe(false);
    expect(courseRateAllowed("hourly")).toBe(true);
    expect(courseRateAllowed("per_lesson")).toBe(true);
  });

  it("decides nothing for a replacement instructor (open question #192)", () => {
    const other: RatedInstructor = { id: "i9", payMode: "hourly", rateCents: 2500 };
    expect(effectiveRate({ instructorId: "i1", instructorRateCents: 4550 }, other)).toBeNull();
    expect(effectiveRate({ instructorId: "i1", instructorRateCents: null }, other)).toBeNull();
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
