import { describe, expect, it } from "vitest";
import { coursesBySeason } from "./followed-courses";

// Most recent season first, as `readPerson` lists them.
const next = { id: "jazz-28", seasonId: "s28", season: "2027-2028" };
const current = { id: "jazz-27", seasonId: "s27", season: "2026-2027" };
const old = { id: "jazz-26", seasonId: "s26", season: "2025-2026" };
const courses = [next, current, old];

describe("coursesBySeason (#362)", () => {
  it("puts the season shown on top, later and older seasons below (June re-enrollment)", () => {
    expect(coursesBySeason(courses, { id: "s27", label: "2026-2027" })).toEqual({
      label: "2026-2027",
      shown: [current],
      others: [next, old],
    });
  });

  it("names the season shown even when the student has no course in it", () => {
    expect(coursesBySeason([old], { id: "s27", label: "2026-2027" })).toEqual({
      label: "2026-2027",
      shown: [],
      others: [old],
    });
  });

  it("falls back to the most recent season without a season shown", () => {
    expect(coursesBySeason(courses, null)).toEqual({ label: "2027-2028", shown: [next], others: [current, old] });
    expect(coursesBySeason([], null)).toEqual({ label: undefined, shown: [], others: [] });
  });
});
