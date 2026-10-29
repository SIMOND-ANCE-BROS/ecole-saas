import { describe, expect, it } from "vitest";
import { lessonDates, courseDates, recurrenceOf, lessonDatesOf, biweeklySwapped } from "./lessons";
import { overlaps } from "./overlap";

describe("lessonDates", () => {
  it("gives every Wednesday of the period, bounds included", () => {
    expect(lessonDates({ start: "2026-09-02", end: "2026-09-30", weekday: 3, closures: [] })).toEqual([
      "2026-09-02",
      "2026-09-09",
      "2026-09-16",
      "2026-09-23",
      "2026-09-30",
    ]);
  });

  it("starts on the first wanted weekday after the start", () => {
    expect(lessonDates({ start: "2026-09-01", end: "2026-09-14", weekday: 1, closures: [] })).toEqual([
      "2026-09-07",
      "2026-09-14",
    ]);
  });

  it("handles Sunday (7)", () => {
    expect(lessonDates({ start: "2026-09-01", end: "2026-09-13", weekday: 7, closures: [] })).toEqual([
      "2026-09-06",
      "2026-09-13",
    ]);
  });

  it("skips closures, bounds included", () => {
    const allSaints = { start: "2026-10-17", end: "2026-11-01" };
    const armistice = { start: "2026-11-11", end: "2026-11-11" };
    expect(
      lessonDates({ start: "2026-10-14", end: "2026-11-18", weekday: 3, closures: [allSaints, armistice] }),
    ).toEqual(["2026-10-14", "2026-11-04", "2026-11-18"]);
  });

  it("crosses the clock change and the new year without shifting", () => {
    expect(lessonDates({ start: "2026-10-20", end: "2026-11-03", weekday: 2, closures: [] })).toEqual([
      "2026-10-20",
      "2026-10-27",
      "2026-11-03",
    ]);
    expect(lessonDates({ start: "2026-12-28", end: "2027-01-12", weekday: 2, closures: [] })).toEqual([
      "2026-12-29",
      "2027-01-05",
      "2027-01-12",
    ]);
  });

  it("gives nothing for an empty or reversed period", () => {
    expect(lessonDates({ start: "2026-10-01", end: "2026-09-01", weekday: 3, closures: [] })).toEqual([]);
  });
});

describe("courseDates (#90)", () => {
  const SEASON = { start: "2026-09-01", end: "2026-10-31" };
  const ALL_SAINTS = [{ start: "2026-10-17", end: "2026-11-01" }];
  const weekly = (weekday: number, startDate: string | null = null, endDate: string | null = null) =>
    ({ type: "weekly", weekday: weekday, startDate: startDate, endDate: endDate }) as const;

  it("weekly: as before, outside closures", () => {
    expect(courseDates(weekly(1), SEASON, ALL_SAINTS)).toEqual(
      lessonDates({ ...SEASON, weekday: 1, closures: ALL_SAINTS }),
    );
  });

  it("limited period: only between the two dates, and within the season", () => {
    expect(courseDates(weekly(3, "2026-09-20", "2026-10-07"), SEASON, [])).toEqual([
      "2026-09-23",
      "2026-09-30",
      "2026-10-07",
    ]);
    expect(courseDates(weekly(3, "2026-08-01", null), SEASON, [])[0]).toBe("2026-09-02");
    expect(courseDates(weekly(3, "2026-10-10", "2026-10-01"), SEASON, [])).toEqual([]);
  });

  it("every other week: alternation set on the first date, not shifted by a closure", () => {
    const fortnight = { type: "biweekly", weekday: 1, startDate: null, endDate: null } as const;
    // Mondays of the season: 7, 14, 21, 28 Sept., 5, 12, 19, 26 Oct.; every other one from the 7th.
    expect(courseDates(fortnight, SEASON, [])).toEqual(["2026-09-07", "2026-09-21", "2026-10-05", "2026-10-19"]);
    // Closure on 19 October: the lesson is skipped, the others keep their week.
    expect(courseDates(fortnight, SEASON, ALL_SAINTS)).toEqual(["2026-09-07", "2026-09-21", "2026-10-05"]);
    expect(courseDates({ ...fortnight, startDate: "2026-09-14" }, SEASON, [])).toEqual([
      "2026-09-14",
      "2026-09-28",
      "2026-10-12",
      "2026-10-26",
    ]);
  });

  it("specific dates: sorted, without duplicates, within the season, even during a closure", () => {
    expect(
      courseDates(
        { type: "dates", dates: ["2026-10-24", "2026-09-12", "2026-10-24", "2027-01-05"] },
        SEASON,
        ALL_SAINTS,
      ),
    ).toEqual(["2026-09-12", "2026-10-24"]);
  });
});

describe("recurrenceOf", () => {
  const stored = { weekday: 3, startDate: null, endDate: "2026-12-31", dates: [] };
  it("reads a regular course and its period", () => {
    expect(recurrenceOf({ ...stored, recurrence: "biweekly" })).toEqual({
      type: "biweekly",
      weekday: 3,
      startDate: null,
      endDate: "2026-12-31",
    });
  });
  it("reads a course on specific dates", () => {
    expect(recurrenceOf({ ...stored, recurrence: "dates", weekday: null, dates: ["2026-10-24"] })).toEqual({
      type: "dates",
      dates: ["2026-10-24"],
    });
  });
  it("has no recurrence for a regular course without a day", () => {
    expect(recurrenceOf({ ...stored, recurrence: "weekly", weekday: null })).toBeNull();
  });
});

describe("lessonDatesOf (#96)", () => {
  const calendar = {
    period: { start: "2026-09-01", end: "2027-06-30" },
    closures: [{ period: { start: "2026-10-17", end: "2026-11-01" }, scope: { kind: "school" as const } }],
    from: "2026-09-01",
  };
  const biweekly = (startDate: string) => ({
    recurrence: "biweekly" as const,
    weekday: 3,
    startDate,
    endDate: null,
    dates: [],
  });
  const at = (lessonDates: string[] | undefined) => ({
    weekday: 3,
    startTime: "17:00",
    durationMinutes: 60,
    lessonDates,
  });

  it("gives two alternate fortnights no shared date, across a closure too", () => {
    const a = lessonDatesOf(biweekly("2026-09-02"), calendar);
    const b = lessonDatesOf(biweekly("2026-09-09"), calendar);
    expect(a?.slice(0, 2)).toEqual(["2026-09-02", "2026-09-16"]);
    expect(b?.slice(0, 2)).toEqual(["2026-09-09", "2026-09-23"]);
    expect(overlaps(at(a), at(b))).toBe(false);
  });

  it("leaves out dates before `from`: a course already over no longer clashes", () => {
    const ended = { ...biweekly("2026-09-02"), recurrence: "weekly" as const, endDate: "2026-10-14" };
    const weekly = { ...ended, endDate: null };
    const later = { ...calendar, from: "2026-11-15" };
    expect(lessonDatesOf(ended, later)).toEqual([]);
    expect(overlaps(at(lessonDatesOf(ended, later)), at(lessonDatesOf(weekly, later)))).toBe(false);
    expect(overlaps(at(lessonDatesOf(ended, calendar)), at(lessonDatesOf(weekly, calendar)))).toBe(true);
  });
});

describe("biweeklySwapped (#270)", () => {
  // A Thursday course, every other week; the season starts on Tuesday 1 September 2026.
  const before = { start: "2026-09-01", end: "2027-06-30" };
  const biweekly = { type: "biweekly" as const, weekday: 4, startDate: null, endDate: null };
  const from = (start: string) => ({ start, end: "2027-06-30" });

  it("swaps the weeks when the first Thursday moves by an odd number of weeks", () => {
    expect(biweeklySwapped(biweekly, before, from("2026-09-08"))).toBe(true);
    expect(biweeklySwapped(biweekly, before, from("2026-08-25"))).toBe(true);
  });

  it("keeps them when it moves by an even number of weeks, or not at all", () => {
    expect(biweeklySwapped(biweekly, before, from("2026-09-15"))).toBe(false);
    // Tuesday → Wednesday: the first Thursday is still the 3rd.
    expect(biweeklySwapped(biweekly, before, from("2026-09-02"))).toBe(false);
    // The end only: nothing moves.
    expect(biweeklySwapped(biweekly, before, { start: "2026-09-01", end: "2027-05-31" })).toBe(false);
  });

  it("ignores a weekly course, and one with its own start after both season starts", () => {
    expect(biweeklySwapped({ ...biweekly, type: "weekly" }, before, from("2026-09-08"))).toBe(false);
    expect(biweeklySwapped({ ...biweekly, startDate: "2026-10-01" }, before, from("2026-09-08"))).toBe(false);
    // Its own start falls before the new season start: the season's start rules again.
    expect(biweeklySwapped({ ...biweekly, startDate: "2026-09-03" }, before, from("2026-09-08"))).toBe(true);
  });
});
