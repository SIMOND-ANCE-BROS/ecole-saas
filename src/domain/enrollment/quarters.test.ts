import { describe, expect, it } from "vitest";
import {
  coveredQuarters,
  defaultQuarters,
  quarterlyDues,
  quarterMonths,
  quartersOutside,
  quartersRefusal,
  quarterEnrollmentRefusal,
  seasonDueCents,
  type SeasonQuarter,
} from "./quarters";

const SEASON = { startDate: "2027-09-01", endDate: "2028-06-30" };
const QUARTERS: SeasonQuarter[] = [
  { id: "q1", label: "1er trimestre", startDate: "2027-10-01", endDate: "2027-12-31" },
  { id: "q2", label: "2e trimestre", startDate: "2028-01-01", endDate: "2028-03-31" },
  { id: "q3", label: "3e trimestre", startDate: "2028-04-01", endDate: "2028-06-30" },
];
const ids = (qs: readonly { id: string }[]) => qs.map((q) => q.id);

describe("defaultQuarters", () => {
  it("three quarters of three months ending with the season: September is not counted", () => {
    expect(defaultQuarters(SEASON)).toEqual(QUARTERS.map(({ id: _id, ...q }) => q));
  });

  it("a season ending mid-month (gala) ends its last quarter that day", () => {
    expect(defaultQuarters({ startDate: "2027-09-06", endDate: "2028-06-27" }).at(-1)).toEqual({
      label: "3e trimestre",
      startDate: "2028-04-01",
      endDate: "2028-06-27",
    });
  });

  it("a season starting after the first quarter's first day clips it to its start", () => {
    expect(defaultQuarters({ startDate: "2027-10-11", endDate: "2028-06-30" })[0]).toEqual({
      label: "1er trimestre",
      startDate: "2027-10-11",
      endDate: "2027-12-31",
    });
  });

  it("a short season keeps only the quarters inside it, numbered from the first", () => {
    expect(defaultQuarters({ startDate: "2028-01-15", endDate: "2028-06-30" })).toEqual([
      { label: "1er trimestre", startDate: "2028-01-15", endDate: "2028-03-31" },
      { label: "2e trimestre", startDate: "2028-04-01", endDate: "2028-06-30" },
    ]);
  });

  it("every default passes the quarters' own checks", () => {
    expect(quartersRefusal(defaultQuarters(SEASON), SEASON)).toBeNull();
  });
});

describe("coveredQuarters (#291 Q1 default: the current quarter counts in full)", () => {
  it("enrolled in September (before the first quarter): the three quarters", () => {
    expect(ids(coveredQuarters(QUARTERS, "2027-09-15"))).toEqual(["q1", "q2", "q3"]);
  });

  it("enrolled for the next season in June: the three quarters", () => {
    expect(ids(coveredQuarters(QUARTERS, "2027-06-20"))).toEqual(["q1", "q2", "q3"]);
  });

  it("enrolled on the first day of a quarter: that quarter and the next ones", () => {
    expect(ids(coveredQuarters(QUARTERS, "2028-01-01"))).toEqual(["q2", "q3"]);
  });

  it("enrolled in the middle of a quarter: that quarter counts in full", () => {
    expect(ids(coveredQuarters(QUARTERS, "2027-11-15"))).toEqual(["q1", "q2", "q3"]);
  });

  it("enrolled on the last day of a quarter: that quarter still counts", () => {
    expect(ids(coveredQuarters(QUARTERS, "2027-12-31"))).toEqual(["q1", "q2", "q3"]);
  });

  it("enrolled after the last quarter started: the last quarter only", () => {
    expect(ids(coveredQuarters(QUARTERS, "2028-05-02"))).toEqual(["q3"]);
  });

  it("enrolled after the last quarter ended: none", () => {
    expect(coveredQuarters(QUARTERS, "2028-07-01")).toEqual([]);
  });

  it("quarters given in any order come back in date order", () => {
    expect(ids(coveredQuarters([QUARTERS[2], QUARTERS[0], QUARTERS[1]], "2027-09-01"))).toEqual(["q1", "q2", "q3"]);
  });
});

describe("quarterEnrollmentRefusal", () => {
  it("a season without quarters cannot take a quarterly enrollment", () => {
    expect(quarterEnrollmentRefusal([], "2027-09-15")).toMatch(/Paramètres › Saisons/);
  });

  it("no quarter left in the season: refused", () => {
    expect(quarterEnrollmentRefusal(QUARTERS, "2028-07-01")).toMatch(/Plus aucun trimestre/);
  });

  it("at least one quarter left: accepted", () => {
    expect(quarterEnrollmentRefusal(QUARTERS, "2028-06-30")).toBeNull();
  });
});

describe("seasonDueCents", () => {
  it("quarterly: the quarter's net price × the quarters covered (issue example: 110,00 € × 2)", () => {
    expect(seasonDueCents({ period: "quarter", netPriceCents: 11_000, quarterCount: 2 })).toBe(22_000);
  });

  it("quarterly over the whole season: three quarters", () => {
    expect(seasonDueCents({ period: "quarter", netPriceCents: 11_000, quarterCount: 3 })).toBe(33_000);
  });

  it("the siblings discount is already in the quarter's net price: taken off each quarter (#291 Q3 default)", () => {
    // 110,00 € − 10 % = 99,00 € per quarter.
    expect(seasonDueCents({ period: "quarter", netPriceCents: 9_900, quarterCount: 3 })).toBe(29_700);
  });

  it("odd cents are never split: each quarter owes the same whole cents", () => {
    expect(seasonDueCents({ period: "quarter", netPriceCents: 3_333, quarterCount: 3 })).toBe(9_999);
  });

  it("yearly and drop-in: the net price once, whatever the quarters", () => {
    expect(seasonDueCents({ period: "year", netPriceCents: 30_000, quarterCount: 3 })).toBe(30_000);
    expect(seasonDueCents({ period: "single", netPriceCents: 1_500, quarterCount: 0 })).toBe(1_500);
  });
});

describe("quarterlyDues (#291 Q2 default: each quarter due at its own cashing)", () => {
  it("issue example: enrolled on 2028-01-10 at 110,00 € → January (enrollment day) and April", () => {
    expect(quarterlyDues(coveredQuarters(QUARTERS, "2028-01-10"), 11_000, "2028-01-10")).toEqual([
      { quarterId: "q2", label: "2e trimestre", dueOn: "2028-01-10", amountCents: 11_000 },
      { quarterId: "q3", label: "3e trimestre", dueOn: "2028-04-01", amountCents: 11_000 },
    ]);
  });

  it("enrolled in September: one due per quarter, on its first day; the sum is the season due", () => {
    const dues = quarterlyDues(coveredQuarters(QUARTERS, "2027-09-15"), 11_000, "2027-09-15");
    expect(dues.map((d) => d.dueOn)).toEqual(["2027-10-01", "2028-01-01", "2028-04-01"]);
    expect(dues.reduce((s, d) => s + d.amountCents, 0)).toBe(
      seasonDueCents({ period: "quarter", netPriceCents: 11_000, quarterCount: 3 }),
    );
  });

  it("a free quarter (0 €) and a one-cent price stay whole cents per quarter", () => {
    expect(quarterlyDues(QUARTERS, 0, "2027-09-15").map((d) => d.amountCents)).toEqual([0, 0, 0]);
    expect(quarterlyDues(QUARTERS, 1, "2027-09-15").map((d) => d.amountCents)).toEqual([1, 1, 1]);
  });

  it("refuses a price that is not whole cents", () => {
    expect(() => quarterlyDues(QUARTERS, 110.5, "2027-09-15")).toThrow(TypeError);
  });
});

describe("quartersRefusal", () => {
  const q = (label: string, startDate: string, endDate: string) => ({ label, startDate, endDate });

  it("no quarter at all is allowed (a school without quarterly packages)", () => {
    expect(quartersRefusal([], SEASON)).toBeNull();
  });

  it("refuses a quarter ending before it starts", () => {
    expect(quartersRefusal([q("T1", "2027-12-31", "2027-10-01")], SEASON)).toBe(
      "Le trimestre « T1 » finit avant de commencer.",
    );
  });

  it("refuses a quarter outside the season", () => {
    expect(quartersRefusal([q("T3", "2028-04-01", "2028-07-15")], SEASON)).toBe(
      "Le trimestre « T3 » sort de la saison (du 01/09/2027 au 30/06/2028).",
    );
  });

  it("refuses two quarters overlapping, even by one day", () => {
    expect(quartersRefusal([q("T2", "2027-12-31", "2028-03-31"), q("T1", "2027-10-01", "2027-12-31")], SEASON)).toBe(
      "Les trimestres « T1 » et « T2 » se chevauchent.",
    );
  });

  it("refuses two quarters with the same label", () => {
    expect(quartersRefusal([q("T1", "2027-10-01", "2027-12-31"), q("t1 ", "2028-01-01", "2028-03-31")], SEASON)).toBe(
      "Deux trimestres s’appellent « t1 ».",
    );
  });

  it("accepts a gap between quarters (September and holidays left out)", () => {
    expect(
      quartersRefusal([q("A", "2027-10-01", "2027-12-20"), q("B", "2028-01-05", "2028-03-31")], SEASON),
    ).toBeNull();
  });
});

describe("quarterMonths", () => {
  it("names the months a quarter spans, in French", () => {
    expect(QUARTERS.map(quarterMonths)).toEqual(["oct.–déc.", "janv.–mars", "avr.–juin"]);
    expect(quarterMonths({ startDate: "2028-01-05", endDate: "2028-01-31" })).toBe("janv.");
  });
});

describe("quartersOutside", () => {
  it("names the quarters new season dates would leave outside", () => {
    expect(quartersOutside(QUARTERS, { startDate: "2027-09-01", endDate: "2028-06-15" }).map((x) => x.id)).toEqual([
      "q3",
    ]);
    expect(quartersOutside(QUARTERS, SEASON)).toEqual([]);
  });
});
