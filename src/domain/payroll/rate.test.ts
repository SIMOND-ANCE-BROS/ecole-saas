import { describe, expect, it } from "vitest";
import { courseRateAllowed, effectiveRate, rateAfterUpdate, type RatedInstructor } from "./rate";

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
  it("same instructor: keeps the stored rate when none is sent, else takes the one sent", () => {
    expect(rateAfterUpdate(undefined, 4550, false)).toBe(4550);
    expect(rateAfterUpdate(5000, 4550, false)).toBe(5000);
    expect(rateAfterUpdate(null, 4550, false)).toBeNull();
    expect(rateAfterUpdate(4550, 4550, false)).toBe(4550);
  });

  it("new instructor: drops the previous one's rate, even sent back unchanged", () => {
    expect(rateAfterUpdate(undefined, 4550, true)).toBeNull();
    expect(rateAfterUpdate(4550, 4550, true)).toBeNull();
    expect(rateAfterUpdate(3800, 4550, true)).toBe(3800);
    expect(rateAfterUpdate(3800, null, true)).toBe(3800);
    expect(rateAfterUpdate(null, null, true)).toBeNull();
  });
});
