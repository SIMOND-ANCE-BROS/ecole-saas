import { describe, expect, it } from "vitest";
import { copiedCount, copyLink, newCourseTitle, seasonParam, withSeason } from "./season-link";

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

describe("copyLink", () => {
  const s26 = { id: "s26", label: "2026-2027", startDate: "2026-09-01" };
  const s27 = { id: "s27", label: "2027-2028", startDate: "2027-09-01" };
  const s28 = { id: "s28", label: "2028-2029", startDate: "2028-09-01" };

  it("offers to copy a season with courses into the next empty one", () => {
    expect(copyLink(s26, [s26, s27, s28], new Map([["s26", 15]]), "s26")).toEqual({
      href: "/planning/copier?depuis=s26&saison=s27",
      label: "Copier vers 2027-2028",
    });
  });

  it("fills the season shown when it is empty, or when no later season is empty", () => {
    expect(copyLink(s27, [s26, s27], new Map([["s26", 15]]), "s26")).toEqual({
      href: "/planning/copier?saison=s27",
      label: "Copier un planning",
    });
    expect(
      copyLink(
        s26,
        [s26, s27],
        new Map([
          ["s26", 15],
          ["s27", 3],
        ]),
        "s26",
      ),
    ).toEqual({
      href: "/planning/copier",
      label: "Copier un planning",
    });
  });

  it("never points back to an earlier empty season", () => {
    expect(copyLink(s27, [s26, s27], new Map([["s27", 4]]), "s27").label).toBe("Copier un planning");
  });
});

describe("copiedCount", () => {
  it("confirms a count up to the season's courses only", () => {
    expect(copiedCount("15", 15)).toBe(15);
    expect(copiedCount("16", 15)).toBe(0);
    expect(copiedCount("0", 15)).toBe(0);
    expect(copiedCount("1e3", 2000)).toBe(0);
    expect(copiedCount("-1", 15)).toBe(0);
    expect(copiedCount(["3"], 15)).toBe(0);
    expect(copiedCount(undefined, 15)).toBe(0);
  });
});
