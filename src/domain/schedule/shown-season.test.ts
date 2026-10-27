import { describe, expect, it } from "vitest";
import { shownSeason } from "./shown-season";

const s2026 = { id: "s2026", startDate: "2026-09-01", endDate: "2027-06-30" };
const s2027 = { id: "s2027", startDate: "2027-09-01", endDate: "2028-06-30" };

describe("shownSeason", () => {
  it("keeps the chosen season without a week, or with an invalid one (null)", () => {
    expect(shownSeason(s2026, null, null)).toEqual({ season: s2026, moved: false, outside: false });
  });

  it("keeps the chosen season for a week inside it, or straddling its start or end", () => {
    expect(shownSeason(s2026, "2026-11-02", s2026).season).toBe(s2026);
    // 31 Aug – 6 Sep 2026: the season starts on the Tuesday.
    expect(shownSeason(s2026, "2026-08-31", s2026)).toEqual({ season: s2026, moved: false, outside: false });
    // 28 Jun – 4 Jul 2027: the season ends on the Wednesday.
    expect(shownSeason(s2026, "2027-06-28", s2026).moved).toBe(false);
  });

  it("moves to the season of a week that belongs to another one", () => {
    expect(shownSeason(s2026, "2027-09-06", s2027)).toEqual({ season: s2027, moved: true, outside: false });
    expect(shownSeason(s2027, "2026-11-02", s2026)).toEqual({ season: s2026, moved: true, outside: false });
  });

  it("keeps the chosen season with a notice for a week in no season (summer gap)", () => {
    expect(shownSeason(s2026, "2027-07-19", null)).toEqual({ season: s2026, moved: false, outside: true });
  });

  it("has nothing to show without a season", () => {
    expect(shownSeason(null, "2027-07-19", null)).toEqual({ season: null, moved: false, outside: false });
  });
});
