import { describe, expect, it } from "vitest";
import { conflicts, overlaps } from "./overlap";

const slot = (weekday: number | null, startTime: string, durationMinutes: number) => ({
  weekday: weekday,
  startTime: startTime,
  durationMinutes: durationMinutes,
});

describe("overlaps", () => {
  it("detects two slots overlapping on the same day", () => {
    expect(overlaps(slot(3, "17:00", 60), slot(3, "17:30", 60))).toBe(true);
  });
  it("accepts two back-to-back slots", () => {
    expect(overlaps(slot(3, "17:00", 60), slot(3, "18:00", 60))).toBe(false);
  });
  it("ignores another day and workshops", () => {
    expect(overlaps(slot(3, "17:00", 60), slot(4, "17:00", 60))).toBe(false);
    expect(overlaps(slot(null, "17:00", 60), slot(null, "17:00", 60))).toBe(false);
  });
});

describe("conflicts", () => {
  const existing = [
    { id: "a", ...slot(3, "17:00", 60), roomId: "studio", instructorId: "camille" },
    { id: "b", ...slot(3, "17:30", 60), roomId: "grande", instructorId: "ines" },
    { id: "c", ...slot(3, "17:15", 30), roomId: "studio", instructorId: "ines" },
  ];

  it("reports the room and instructor already taken, excluding the course itself", () => {
    const target = { id: "c", ...slot(3, "17:15", 30), roomId: "studio", instructorId: "ines" };
    expect(conflicts(target, existing)).toEqual([
      { id: "a", room: true, instructor: false },
      { id: "b", room: false, instructor: true },
    ]);
  });

  it("reports nothing without overlap", () => {
    expect(
      conflicts({ id: null, ...slot(1, "17:00", 60), roomId: "studio", instructorId: "camille" }, existing),
    ).toEqual([]);
  });
});
