import { describe, expect, it } from "vitest";
import { closedCourseLabel, closuresOf, covers, type ScopedClosure } from "./closure-scope";
import { lessonDatesOf, meetsOn } from "./lessons";

const SITE_A = "site-a";
const SITE_B = "site-b";
const JAZZ = "course-jazz";
const BALLET = "course-ballet";

describe("covers (#200)", () => {
  it("covers every course for a school-wide closure, even one being created", () => {
    expect(covers({ kind: "school" }, { id: JAZZ, siteId: SITE_A })).toBe(true);
    expect(covers({ kind: "school" }, {})).toBe(true);
  });

  it("covers only the courses held on a chosen site", () => {
    const scope = { kind: "sites", siteIds: [SITE_A] } as const;
    expect(covers(scope, { id: JAZZ, siteId: SITE_A })).toBe(true);
    expect(covers(scope, { id: BALLET, siteId: SITE_B })).toBe(false);
    // A course whose room is not known yet is not assumed to be there.
    expect(covers(scope, { id: JAZZ })).toBe(false);
  });

  it("covers only the chosen courses, whatever their site", () => {
    const scope = { kind: "courses", courseIds: [JAZZ] } as const;
    expect(covers(scope, { id: JAZZ, siteId: SITE_B })).toBe(true);
    expect(covers(scope, { id: BALLET, siteId: SITE_A })).toBe(false);
    // A course being created cannot have been chosen.
    expect(covers(scope, { siteId: SITE_A })).toBe(false);
  });

  it("covers nothing once every chosen site or course is gone", () => {
    expect(covers({ kind: "sites", siteIds: [] }, { id: JAZZ, siteId: SITE_A })).toBe(false);
    expect(covers({ kind: "courses", courseIds: [] }, { id: JAZZ, siteId: SITE_A })).toBe(false);
  });
});

describe("meetsOn (#200)", () => {
  const season = { start: "2026-09-01", end: "2027-06-30" };
  const course = { recurrence: "biweekly" as const, weekday: 4, startDate: "2026-11-05", endDate: null, dates: [] };
  it("tells the days a course meets, every other week and one-off dates included", () => {
    expect(meetsOn(course, season, "2026-11-05")).toBe(true);
    expect(meetsOn(course, season, "2026-11-12")).toBe(false);
    expect(meetsOn(course, season, "2026-11-06")).toBe(false);
    const workshop = { ...course, recurrence: "dates" as const, weekday: null, dates: ["2026-11-12"] };
    expect(meetsOn(workshop, season, "2026-11-12")).toBe(true);
  });
});

describe("closedCourseLabel (#200)", () => {
  it("names the course by discipline, level, day, time and room", () => {
    const c = { discipline: "Jazz", level: "débutant", weekday: 2, startTime: "18:00", room: "Salle 1" };
    expect(closedCourseLabel(c)).toBe("Jazz débutant – mardi 18:00 – Salle 1");
    expect(closedCourseLabel({ ...c, level: null, weekday: null })).toBe("Jazz – dates précises 18:00 – Salle 1");
  });
});

describe("closuresOf (#200)", () => {
  const holidays: ScopedClosure = { period: { start: "2026-10-17", end: "2026-11-01" }, scope: { kind: "school" } };
  const siteClosed: ScopedClosure = {
    period: { start: "2026-11-12", end: "2026-11-12" },
    scope: { kind: "sites", siteIds: [SITE_B] },
  };
  const gala: ScopedClosure = {
    period: { start: "2027-06-16", end: "2027-06-16" },
    scope: { kind: "courses", courseIds: [JAZZ] },
  };
  const all = [holidays, siteClosed, gala];

  it("keeps the school-wide closures and the ones aimed at the course", () => {
    expect(closuresOf(all, { id: JAZZ, siteId: SITE_A })).toEqual({ school: [holidays.period], scoped: [gala.period] });
    expect(closuresOf(all, { id: BALLET, siteId: SITE_B })).toEqual({
      school: [holidays.period],
      scoped: [siteClosed.period],
    });
    expect(closuresOf(all, {})).toEqual({ school: [holidays.period], scoped: [] });
  });

  it("removes a lesson only for the courses a partial closure covers", () => {
    const calendar = { period: { start: "2026-09-01", end: "2027-06-30" }, closures: all, from: "2026-11-01" };
    // Thursday 12 November 2026: site B is closed.
    const thursday = { recurrence: "weekly" as const, weekday: 4, startDate: null, endDate: "2026-11-19", dates: [] };
    expect(lessonDatesOf({ ...thursday, id: BALLET, siteId: SITE_B }, calendar)).toEqual(["2026-11-05", "2026-11-19"]);
    expect(lessonDatesOf({ ...thursday, id: JAZZ, siteId: SITE_A }, calendar)).toEqual([
      "2026-11-05",
      "2026-11-12",
      "2026-11-19",
    ]);
  });

  it("keeps a workshop during the holidays, but not on its closed site nor when it is named (owner, 2026-10-28)", () => {
    const calendar = { period: { start: "2026-09-01", end: "2027-06-30" }, closures: all, from: "2026-09-01" };
    // 20 October: holidays; 12 November: site B closed; 16 June: the jazz gala.
    const workshop = {
      recurrence: "dates" as const,
      weekday: null,
      startDate: null,
      endDate: null,
      dates: ["2026-10-20", "2026-11-12", "2027-06-16"],
    };
    expect(lessonDatesOf({ ...workshop, id: BALLET, siteId: SITE_A }, calendar)).toEqual(workshop.dates);
    expect(lessonDatesOf({ ...workshop, id: BALLET, siteId: SITE_B }, calendar)).toEqual(["2026-10-20", "2027-06-16"]);
    expect(lessonDatesOf({ ...workshop, id: JAZZ, siteId: SITE_A }, calendar)).toEqual(["2026-10-20", "2026-11-12"]);
  });
});
