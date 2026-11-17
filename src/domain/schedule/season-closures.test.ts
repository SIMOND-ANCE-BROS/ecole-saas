import { describe, expect, it } from "vitest";
import { closuresOutside, isOutsideSeason, seasonClosuresRefusal } from "./season-closures";

const SEASON = { startDate: "2026-08-25", endDate: "2027-07-05" };
const RENTREE = { label: "Zz Rentrée", startDate: "2026-08-25", endDate: "2026-08-25" };
const NOEL = { label: "Zz Noël", startDate: "2026-12-19", endDate: "2027-01-04" };
const GALA = { label: "Zz Gala", startDate: "2027-06-28", endDate: "2027-07-05" };

describe("isOutsideSeason", () => {
  it("keeps a closure on the very bounds inside", () => {
    expect(isOutsideSeason({ startDate: SEASON.startDate, endDate: SEASON.endDate }, SEASON)).toBe(false);
    expect(isOutsideSeason({ startDate: SEASON.startDate, endDate: SEASON.startDate }, SEASON)).toBe(false);
    expect(isOutsideSeason({ startDate: SEASON.endDate, endDate: SEASON.endDate }, SEASON)).toBe(false);
  });

  it("puts out a closure starting the day before or ending the day after", () => {
    expect(isOutsideSeason({ startDate: "2026-08-24", endDate: "2026-08-30" }, SEASON)).toBe(true);
    expect(isOutsideSeason({ startDate: "2027-07-01", endDate: "2027-07-06" }, SEASON)).toBe(true);
  });

  it("puts out a closure wholly before or after the season", () => {
    expect(isOutsideSeason({ startDate: "2026-07-01", endDate: "2026-07-02" }, SEASON)).toBe(true);
    expect(isOutsideSeason({ startDate: "2027-08-01", endDate: "2027-08-01" }, SEASON)).toBe(true);
  });
});

describe("closuresOutside", () => {
  it("lists nothing when the new dates keep every closure", () => {
    expect(closuresOutside([GALA, NOEL, RENTREE], SEASON)).toEqual([]);
  });

  it("lists the closures a shortened season leaves out, by start date then label", () => {
    const shortened = { startDate: "2026-08-26", endDate: "2027-07-04" };
    const twin = { label: "Zz Brevet", startDate: GALA.startDate, endDate: "2027-07-10" };
    expect(closuresOutside([GALA, NOEL, twin, RENTREE], shortened)).toEqual([RENTREE, twin, GALA]);
  });
});

describe("seasonClosuresRefusal", () => {
  it("accepts dates keeping every closure, or a season without closures", () => {
    expect(seasonClosuresRefusal([RENTREE, NOEL, GALA], SEASON)).toBeNull();
    expect(seasonClosuresRefusal([], { startDate: "2026-09-01", endDate: "2026-09-02" })).toBeNull();
  });

  it("names one closure with its single day", () => {
    expect(seasonClosuresRefusal([RENTREE, NOEL], { ...SEASON, startDate: "2026-08-26" })).toBe(
      "Cette fermeture sortirait de la saison : Zz Rentrée (le 25/08/2026). Supprimez-la dans Planning › Fermetures, puis recréez-la avec les bonnes dates.",
    );
  });

  it("names every closure outside with its dates, in the plural", () => {
    expect(seasonClosuresRefusal([GALA, NOEL, RENTREE], { startDate: "2026-08-26", endDate: "2027-07-04" })).toBe(
      "Ces fermetures sortiraient de la saison : Zz Rentrée (le 25/08/2026), Zz Gala (du 28/06/2027 au 05/07/2027). Supprimez-les dans Planning › Fermetures, puis recréez-les avec les bonnes dates.",
    );
  });

  it("refuses a closure left only partly inside: it is never clipped", () => {
    expect(seasonClosuresRefusal([NOEL], { startDate: SEASON.startDate, endDate: "2026-12-31" })).toBe(
      "Cette fermeture sortirait de la saison : Zz Noël (du 19/12/2026 au 04/01/2027). Supprimez-la dans Planning › Fermetures, puis recréez-la avec les bonnes dates.",
    );
  });
});
