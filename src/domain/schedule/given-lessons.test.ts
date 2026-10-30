import { describe, expect, it } from "vitest";
import { givenLessonsKeep } from "./given-lessons";

const before = { instructorId: "i1", startTime: "18:00", durationMinutes: 60 };

describe("givenLessonsKeep", () => {
  it("keeps nothing when neither the instructor nor the slot changes", () => {
    expect(givenLessonsKeep(before, { ...before })).toEqual({ instructor: false, slot: false });
  });

  it("keeps the regular teacher when the course changes hands", () => {
    expect(givenLessonsKeep(before, { ...before, instructorId: "i2" })).toEqual({ instructor: true, slot: false });
  });

  it("keeps the time and length when the length changes (hourly pay)", () => {
    expect(givenLessonsKeep(before, { ...before, durationMinutes: 90 })).toEqual({ instructor: false, slot: true });
  });

  it("keeps the time and length when the time changes", () => {
    expect(givenLessonsKeep(before, { ...before, startTime: "19:15" })).toEqual({ instructor: false, slot: true });
  });

  it("reads a time with seconds as the same time", () => {
    expect(givenLessonsKeep({ ...before, startTime: "18:00:00" }, before).slot).toBe(false);
  });

  it("keeps both when both change", () => {
    expect(givenLessonsKeep(before, { instructorId: "i2", startTime: "17:00", durationMinutes: 45 })).toEqual({
      instructor: true,
      slot: true,
    });
  });
});
