import { describe, expect, it } from "vitest";
import { newCourseTitle, seasonParam, withSeason } from "./season-link";

describe("withSeason", () => {
  it("keeps the usual address for the current season", () => {
    expect(withSeason("/planning?vue=type", undefined)).toBe("/planning?vue=type");
  });

  it("adds the season as the first or a further parameter", () => {
    expect(withSeason("/planning", "s1")).toBe("/planning?saison=s1");
    expect(withSeason("/planning?semaine=2027-09-06", "s1")).toBe("/planning?semaine=2027-09-06&saison=s1");
  });

  it("encodes the season id", () => {
    expect(withSeason("/planning", "a&b=c")).toBe("/planning?saison=a%26b%3Dc");
  });
});

describe("seasonParam", () => {
  it("is undefined for the current season and the id otherwise", () => {
    expect(seasonParam("s1", "s1")).toBeUndefined();
    expect(seasonParam("s2", "s1")).toBe("s2");
    expect(seasonParam("s2", undefined)).toBe("s2");
  });
});

describe("newCourseTitle", () => {
  it("names the season only when it is not the current one", () => {
    expect(newCourseTitle("2027-2028", false)).toBe("Nouveau cours – saison 2027-2028");
    expect(newCourseTitle("2026-2027", true)).toBe("Nouveau cours");
    expect(newCourseTitle(undefined, false)).toBe("Nouveau cours");
  });
});
