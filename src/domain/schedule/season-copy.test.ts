import { describe, expect, it } from "vitest";
import { COPIED_COLUMNS, planSeasonCopy, type CopiedCourse } from "./season-copy";

const course = (over: Partial<CopiedCourse> & { id: string }) => ({
  recurrence: "weekly" as const,
  disciplineId: "jazz",
  roomId: "salle-1",
  weekday: 1,
  startTime: "17:00:00",
  instructorActive: true,
  ...over,
});

describe("planSeasonCopy", () => {
  it("copies the regular courses into an empty season", () => {
    const weekly = course({ id: "a" });
    const biweekly = course({ id: "b", recurrence: "biweekly", weekday: 3 });
    expect(planSeasonCopy([weekly, biweekly], [])).toEqual({
      copied: [weekly, biweekly],
      oneOff: [],
      alreadyThere: [],
      inactiveInstructor: [],
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

  it("copies a course whose instructor is inactive, and flags it", () => {
    const gone = course({ id: "a", instructorActive: false });
    const plan = planSeasonCopy([gone, course({ id: "b", weekday: 2 })], []);
    expect(plan.copied.map((c) => c.id)).toEqual(["a", "b"]);
    expect(plan.inactiveInstructor).toEqual([gone]);
  });

  it("does not flag an inactive instructor whose course is not copied", () => {
    const gone = course({ id: "a", instructorActive: false });
    expect(planSeasonCopy([gone], [gone]).inactiveInstructor).toEqual([]);
  });
});

describe("COPIED_COLUMNS", () => {
  it("copies everything except the season and the dates", () => {
    expect(COPIED_COLUMNS).not.toContain("seasonId");
    expect(COPIED_COLUMNS).not.toContain("startDate");
    expect(COPIED_COLUMNS).not.toContain("endDate");
    expect(COPIED_COLUMNS).toEqual(expect.arrayContaining(["instructorId", "roomId", "weekday", "startTime"]));
  });
});
