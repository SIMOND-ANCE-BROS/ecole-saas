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

describe("overlaps with lesson dates (#96)", () => {
  const at = (lessonDates: string[], startTime = "17:00") => ({ ...slot(3, startTime, 60), lessonDates });

  it("does not report two « une semaine sur deux » courses that alternate", () => {
    expect(overlaps(at(["2026-09-02", "2026-09-16"]), at(["2026-09-09", "2026-09-23"]))).toBe(false);
  });
  it("does not report two regular courses on disjoint periods", () => {
    expect(overlaps(at(["2026-12-09", "2026-12-16"]), at(["2027-01-06", "2027-01-13"]))).toBe(false);
  });
  it("reports courses sharing at least one date, at overlapping times", () => {
    expect(overlaps(at(["2026-09-02", "2026-09-16"]), at(["2026-09-16"], "17:30"))).toBe(true);
    expect(overlaps(at(["2026-09-16"]), at(["2026-09-16"], "18:00"))).toBe(false);
  });
  it("compares workshops by their dates", () => {
    const workshop = { ...slot(null, "14:00", 120), lessonDates: ["2026-10-24"] };
    expect(overlaps(workshop, { ...slot(null, "15:00", 60), lessonDates: ["2026-10-24"] })).toBe(true);
  });
  it("falls back on the weekday when one side has no dates", () => {
    expect(overlaps(at(["2026-09-09"]), slot(3, "17:30", 60))).toBe(true);
  });
});
