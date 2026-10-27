import { describe, expect, it } from "vitest";
import { planSeasonCopy, type CopiedCourse } from "./season-copy";

const course = (over: Partial<CopiedCourse> & { id: string }) => ({
  recurrence: "weekly" as const,
  disciplineId: "jazz",
  roomId: "salle-1",
  weekday: 1,
  startTime: "17:00:00",
  startDate: null,
  endDate: null,
  instructorActive: true,
  ...over,
});

describe("planSeasonCopy", () => {
  it("copies the regular courses into an empty season, with nothing to check", () => {
    const weekly = course({ id: "a" });
    const other = course({ id: "b", weekday: 3 });
    expect(planSeasonCopy([weekly, other], [])).toEqual({
      copied: [weekly, other],
      oneOff: [],
      alreadyThere: [],
      check: { inactiveInstructor: [], periodDropped: [], biweekly: [], roomTaken: [] },
    });
  });

  it("skips the courses held on specific dates", () => {
    const workshop = course({ id: "w", recurrence: "dates", weekday: null });
    const plan = planSeasonCopy([course({ id: "a" }), workshop], []);
    expect(plan.oneOff).toEqual([workshop]);
    expect(plan.copied.map((c) => c.id)).toEqual(["a"]);
  });

  it("does not copy again a course the target already has (same discipline, day, time and room)", () => {
    const same = course({ id: "a" });
    const otherRoom = course({ id: "b", roomId: "salle-2" });
    const otherTime = course({ id: "c", startTime: "18:00:00" });
    // The target's time may come without seconds.
    const plan = planSeasonCopy([same, otherRoom, otherTime], [{ ...same, startTime: "17:00" }]);
    expect(plan.alreadyThere).toEqual([same]);
    expect(plan.copied.map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("copies and flags a course whose instructor is inactive, not one left out", () => {
    const gone = course({ id: "a", instructorActive: false });
    const plan = planSeasonCopy([gone, course({ id: "b", weekday: 2 })], []);
    expect(plan.copied.map((c) => c.id)).toEqual(["a", "b"]);
    expect(plan.check.inactiveInstructor).toEqual([gone]);
    expect(planSeasonCopy([gone], [gone]).check.inactiveInstructor).toEqual([]);
  });

  it("flags a limited period that is not carried over, and every-other-week courses", () => {
    const fromOctober = course({ id: "a", startDate: "2026-10-01" });
    const untilMarch = course({ id: "b", weekday: 2, endDate: "2027-03-31" });
    const biweekly = course({ id: "c", weekday: 4, recurrence: "biweekly" });
    const plan = planSeasonCopy([fromOctober, untilMarch, biweekly], []);
    expect(plan.copied).toHaveLength(3);
    expect(plan.check.periodDropped).toEqual([fromOctober, untilMarch]);
    expect(plan.check.biweekly).toEqual([biweekly]);
  });

  it("flags a course whose room is taken at that time by another discipline of the target", () => {
    const jazz = course({ id: "a" });
    const plan = planSeasonCopy([jazz], [{ ...jazz, disciplineId: "salsa", startTime: "17:00" }]);
    expect(plan.copied).toEqual([jazz]);
    expect(plan.check.roomTaken).toEqual([jazz]);
  });
});
