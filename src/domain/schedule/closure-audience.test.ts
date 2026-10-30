import { describe, expect, it } from "vitest";
import { audienceOf, meetsDuring, pickByAudience, type AudienceCourse } from "./closure-audience";

const group = (id: string, ageMin: number | null, ageMax: number | null): AudienceCourse => ({
  id,
  type: "group",
  ageMin,
  ageMax,
});

describe("audienceOf (#295)", () => {
  it("tells children's and teens' courses by an age range ending before 18", () => {
    expect(audienceOf(group("eveil", 4, 6))).toBe("children");
    expect(audienceOf(group("jazz-ado", 12, 17))).toBe("children");
    expect(audienceOf(group("jazz-enfant", null, 10))).toBe("children");
  });

  it("tells adults' courses by an age range starting at 18", () => {
    expect(audienceOf(group("jazz-adulte", 18, null))).toBe("adults");
    expect(audienceOf(group("jazz-adulte-18", 18, 18))).toBe("adults");
    expect(audienceOf(group("classique-adulte", 25, 99))).toBe("adults");
  });

  it("leaves to management a course for all ages or straddling 18", () => {
    // No age range: open to everybody, which side is not guessed.
    expect(audienceOf(group("tous-ages", null, null))).toBe("undecided");
    // Teens and adults together (« 15 ans et + »).
    expect(audienceOf(group("ado-adulte", 15, null))).toBe("undecided");
    // A range including 18 has adults in it.
    expect(audienceOf(group("ado-18", 14, 18))).toBe("undecided");
    expect(audienceOf(group("enfant-min", 8, null))).toBe("undecided");
  });

  it("never sorts private lessons, competition training or workshops by audience", () => {
    expect(audienceOf({ id: "particulier", type: "private", ageMin: 18, ageMax: null })).toBeNull();
    expect(audienceOf({ id: "competition", type: "competition", ageMin: 10, ageMax: 15 })).toBeNull();
    expect(audienceOf({ id: "stage", type: "workshop", ageMin: null, ageMax: null })).toBeNull();
  });
});

describe("pickByAudience (#295)", () => {
  const courses: AudienceCourse[] = [
    group("eveil", 4, 6),
    group("jazz-ado", 12, 17),
    group("jazz-adulte", 18, null),
    group("tous-ages", null, null),
    group("ado-adulte", 15, null),
    { id: "particulier", type: "private", ageMin: null, ageMax: null },
    { id: "competition", type: "competition", ageMin: 10, ageMax: 15 },
  ];

  it("ticks the children's and teens' group courses, and lists the undecided ones apart", () => {
    expect(pickByAudience(courses, "children")).toEqual({
      courseIds: ["eveil", "jazz-ado"],
      undecidedIds: ["tous-ages", "ado-adulte"],
    });
  });

  it("ticks the adults' group courses, and lists the same undecided ones apart", () => {
    expect(pickByAudience(courses, "adults")).toEqual({
      courseIds: ["jazz-adulte"],
      undecidedIds: ["tous-ages", "ado-adulte"],
    });
  });

  it("ticks every group course for « tous », with nothing left to decide", () => {
    expect(pickByAudience(courses, "all")).toEqual({
      courseIds: ["eveil", "jazz-ado", "jazz-adulte", "tous-ages", "ado-adulte"],
      undecidedIds: [],
    });
  });

  it("never ticks private lessons or competition training, whatever the audience", () => {
    for (const audience of ["children", "adults", "all"] as const) {
      const { courseIds, undecidedIds } = pickByAudience(courses, audience);
      expect([...courseIds, ...undecidedIds]).not.toContain("particulier");
      expect([...courseIds, ...undecidedIds]).not.toContain("competition");
    }
  });

  it("ticks nothing in a season without courses of that audience", () => {
    expect(pickByAudience([group("eveil", 4, 6)], "adults")).toEqual({ courseIds: [], undecidedIds: [] });
  });
});

describe("meetsDuring (#295)", () => {
  const season = { start: "2027-09-01", end: "2028-06-30" };
  // Fictitious autumn holidays, Saturday to Sunday.
  const holidays = { start: "2027-10-23", end: "2027-11-07" };
  const weekly = { recurrence: "weekly" as const, weekday: 2, startDate: null, endDate: null, dates: [] };

  it("keeps a weekly course meeting during the holidays", () => {
    expect(meetsDuring(weekly, season, holidays)).toBe(true);
  });

  it("leaves out a course that ended before or starts after the holidays", () => {
    expect(meetsDuring({ ...weekly, endDate: "2027-10-15" }, season, holidays)).toBe(false);
    expect(meetsDuring({ ...weekly, startDate: "2027-11-09" }, season, holidays)).toBe(false);
  });

  it("leaves out a course whose day does not fall in a one-day closure", () => {
    // 2027-11-11 is a Thursday; the course is on Tuesdays.
    expect(meetsDuring(weekly, season, { start: "2027-11-11", end: "2027-11-11" })).toBe(false);
    expect(meetsDuring({ ...weekly, weekday: 4 }, season, { start: "2027-11-11", end: "2027-11-11" })).toBe(true);
  });

  it("follows the alternation of an every-other-week course", () => {
    // Wednesdays from 2027-09-01: 1st, 15th, 29th of September, 13th and 27th of October…
    const biweekly = { ...weekly, recurrence: "biweekly" as const, weekday: 3 };
    expect(meetsDuring(biweekly, season, { start: "2027-10-25", end: "2027-10-31" })).toBe(true);
    expect(meetsDuring(biweekly, season, { start: "2027-10-18", end: "2027-10-24" })).toBe(false);
  });

  it("keeps a course on specific dates only when one of them falls in the period", () => {
    const dated = {
      recurrence: "dates" as const,
      weekday: null,
      startDate: null,
      endDate: null,
      dates: ["2027-10-27"],
    };
    expect(meetsDuring(dated, season, holidays)).toBe(true);
    expect(meetsDuring({ ...dated, dates: ["2027-12-01"] }, season, holidays)).toBe(false);
  });
});
