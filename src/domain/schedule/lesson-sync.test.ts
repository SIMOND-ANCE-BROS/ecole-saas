import { describe, expect, it } from "vitest";
import type { ScopedClosure } from "./closure-scope";
import {
  planLessonSync,
  seasonLessons,
  type ExistingLesson,
  type SuspendedLesson,
  type SyncedCourse,
} from "./lesson-sync";

const SEASON = { start: "2026-09-01", end: "2026-11-30" };
const TODAY = "2026-11-02"; // a Monday
const T1 = "t1";
const T2 = "t2";
const SUB = "sub";
const jazz: SyncedCourse = {
  id: "jazz",
  instructorId: T1,
  siteId: "centre",
  recurrence: { type: "weekly", weekday: 4, startDate: null, endDate: null },
};
const closed = (start: string, end: string, scope: ScopedClosure["scope"] = { kind: "school" }): ScopedClosure => ({
  period: { start, end },
  scope,
});

/** A planned lesson of `jazz` on its usual slot. */
const lessonOn = (date: string, own: Partial<ExistingLesson> = {}): ExistingLesson => ({
  id: `l-${date}`,
  courseId: "jazz",
  reference: date,
  date,
  plannedDate: null,
  startTime: null,
  durationMinutes: null,
  instructorId: T1,
  courseInstructorId: T1,
  status: "planned",
  attendanceSheet: false,
  packUsage: false,
  ...own,
});
const keptOn = (referenceDate: string, own: Partial<SuspendedLesson> = {}): SuspendedLesson => ({
  courseId: "jazz",
  referenceDate,
  date: referenceDate,
  plannedDate: null,
  startTime: null,
  durationMinutes: null,
  instructorId: null,
  ...own,
});

function plan(opts: {
  courses?: SyncedCourse[];
  closures?: ScopedClosure[];
  existing?: ExistingLesson[];
  suspended?: SuspendedLesson[];
  start?: string;
  active?: string[];
  report?: { start: string; end: string };
}) {
  const start = opts.start ?? TODAY;
  const { expected, meets, closed } = seasonLessons(opts.courses ?? [jazz], SEASON, opts.closures ?? [], start);
  return planLessonSync({
    start,
    today: TODAY,
    season: SEASON,
    expected,
    meets,
    closed,
    existing: opts.existing ?? [],
    suspended: opts.suspended ?? [],
    activeInstructors: new Set(opts.active ?? [T1, T2, SUB]),
    report: opts.report,
  });
}

const THURSDAYS = ["2026-11-05", "2026-11-12", "2026-11-19", "2026-11-26"];

describe("lessons removed by a closure (#206)", () => {
  it("keeps aside only what a lesson has of its own", () => {
    const p = plan({
      closures: [closed("2026-11-12", "2026-11-26")],
      existing: [
        lessonOn("2026-11-05"),
        lessonOn("2026-11-12", { instructorId: SUB }),
        lessonOn("2026-11-19", { date: "2026-11-20", plannedDate: "2026-11-19", startTime: "19:00:00" }),
        lessonOn("2026-11-26"),
      ],
    });
    expect(p.remove).toEqual(["l-2026-11-12", "l-2026-11-19", "l-2026-11-26"]);
    expect(p.setAside).toEqual([
      keptOn("2026-11-12", { instructorId: SUB }),
      keptOn("2026-11-19", { date: "2026-11-20", plannedDate: "2026-11-19", startTime: "19:00:00" }),
    ]);
    expect(p.insert).toEqual([]);
  });

  it("keeps no instructor when the lesson had the course's own", () => {
    const p = plan({
      closures: [closed("2026-11-12", "2026-11-12")],
      existing: [lessonOn("2026-11-12", { startTime: "19:00:00", durationMinutes: 45 })],
    });
    expect(p.setAside).toEqual([keptOn("2026-11-12", { startTime: "19:00:00", durationMinutes: 45 })]);
  });

  it("gives back the substitute, the own time and the new date, then forgets them", () => {
    const p = plan({
      existing: [lessonOn("2026-11-05"), lessonOn("2026-11-26")],
      suspended: [
        keptOn("2026-11-12", { instructorId: SUB }),
        keptOn("2026-11-19", {
          date: "2026-11-20",
          plannedDate: "2026-11-19",
          startTime: "19:00:00",
          durationMinutes: 45,
        }),
      ],
    });
    expect(p.insert).toEqual([
      {
        courseId: "jazz",
        date: "2026-11-12",
        plannedDate: null,
        startTime: null,
        durationMinutes: null,
        instructorId: SUB,
      },
      {
        courseId: "jazz",
        date: "2026-11-20",
        plannedDate: "2026-11-19",
        startTime: "19:00:00",
        durationMinutes: 45,
        instructorId: T1,
      },
    ]);
    expect(p.forget).toEqual([
      { courseId: "jazz", referenceDate: "2026-11-12" },
      { courseId: "jazz", referenceDate: "2026-11-19" },
    ]);
  });

  it("gives the lesson to the course's main instructor of today, not the one before the closure", () => {
    const p = plan({
      courses: [{ ...jazz, instructorId: T2 }],
      existing: THURSDAYS.filter((d) => d !== "2026-11-12").map((d) =>
        lessonOn(d, { instructorId: T2, courseInstructorId: T2 }),
      ),
      suspended: [keptOn("2026-11-12", { startTime: "19:00:00" })],
    });
    expect(p.insert).toEqual([
      {
        courseId: "jazz",
        date: "2026-11-12",
        plannedDate: null,
        startTime: "19:00:00",
        durationMinutes: null,
        instructorId: T2,
      },
    ]);
  });

  it("does not give back a substitute who is no longer active", () => {
    const p = plan({
      existing: THURSDAYS.filter((d) => d !== "2026-11-12").map((d) => lessonOn(d)),
      suspended: [keptOn("2026-11-12", { instructorId: SUB })],
      active: [T1],
    });
    expect(p.insert).toMatchObject([{ date: "2026-11-12", instructorId: T1 }]);
  });

  it("falls back to the plain lesson when its new date was taken meanwhile", () => {
    const p = plan({
      existing: [
        ...["2026-11-05", "2026-11-12", "2026-11-26"].map((d) => lessonOn(d)),
        // Another lesson of the course, moved onto Friday 20/11 while 19/11 was closed.
        lessonOn("2026-11-12", { id: "other", date: "2026-11-20", plannedDate: "2026-11-12" }),
      ].filter((l) => l.id !== "l-2026-11-12"),
      suspended: [
        keptOn("2026-11-19", {
          date: "2026-11-20",
          plannedDate: "2026-11-19",
          startTime: "19:00:00",
          instructorId: SUB,
        }),
      ],
    });
    expect(p.insert).toEqual([
      {
        courseId: "jazz",
        date: "2026-11-19",
        plannedDate: null,
        startTime: null,
        durationMinutes: null,
        instructorId: SUB,
      },
    ]);
    expect(p.forget).toEqual([{ courseId: "jazz", referenceDate: "2026-11-19" }]);
  });

  it("a date freed by a removed lesson can be given back", () => {
    const p = plan({
      closures: [closed("2026-11-26", "2026-11-26")],
      existing: [
        lessonOn("2026-11-05"),
        lessonOn("2026-11-12"),
        // Moved from 26/11 (now closed) onto 20/11: removed, so 20/11 is free again.
        lessonOn("2026-11-26", { id: "moved", date: "2026-11-20", plannedDate: "2026-11-26" }),
      ],
      suspended: [keptOn("2026-11-19", { date: "2026-11-20", plannedDate: "2026-11-19" })],
    });
    expect(p.remove).toEqual(["moved"]);
    expect(p.insert).toMatchObject([{ date: "2026-11-20", plannedDate: "2026-11-19" }]);
  });

  it("forgets what is past, a day the course no longer meets on, and a lesson already there", () => {
    const p = plan({
      existing: THURSDAYS.map((d) => lessonOn(d)),
      suspended: [
        keptOn("2026-10-29", { instructorId: SUB }), // before today
        keptOn("2026-11-13", { instructorId: SUB }), // a Friday: the course meets on Thursdays
        keptOn("2026-11-19", { instructorId: SUB }), // its lesson is back already
      ],
    });
    expect(p.forget.map((k) => k.referenceDate)).toEqual(["2026-10-29", "2026-11-13", "2026-11-19"]);
    expect(p.insert).toEqual([]);
  });

  it("leaves alone what lies before `since`", () => {
    const p = plan({
      start: "2026-11-19",
      closures: [closed("2026-11-12", "2026-11-26")],
      existing: THURSDAYS.map((d) => lessonOn(d, { instructorId: SUB })),
      suspended: [keptOn("2026-11-05", { instructorId: SUB })],
    });
    expect(p.remove).toEqual(["l-2026-11-19", "l-2026-11-26"]);
    expect(p.setAside.map((k) => k.referenceDate)).toEqual(["2026-11-19", "2026-11-26"]);
    // 05/11 is after today but before `since`: neither forgotten nor given back.
    expect(p.forget).toEqual([]);
  });

  it("keeps aside only on the weeks a biweekly course meets", () => {
    const biweekly: SyncedCourse = {
      ...jazz,
      recurrence: { type: "biweekly", weekday: 4, startDate: null, endDate: null },
    };
    const { expected, meets } = seasonLessons([biweekly], SEASON, [], TODAY);
    const weeks = expected.map((a) => a.date);
    expect(weeks).toHaveLength(2);
    const p = plan({
      courses: [biweekly],
      closures: [closed("2026-11-01", "2026-11-30")],
      existing: weeks.map((d) => lessonOn(d, { instructorId: SUB })),
    });
    expect(p.setAside.map((k) => k.referenceDate)).toEqual(weeks);
    // A week off for the course is not one it meets on.
    expect(meets.has("jazz 2026-11-12") !== meets.has("jazz 2026-11-05")).toBe(true);
  });

  it("follows the scope of the closure: sites and courses", () => {
    const ballet: SyncedCourse = { ...jazz, id: "ballet", siteId: "annexe" };
    const balletOn = (date: string) => ({
      ...lessonOn(date, { instructorId: SUB }),
      id: `b-${date}`,
      courseId: "ballet",
    });
    const existing = [lessonOn("2026-11-12", { instructorId: SUB }), balletOn("2026-11-12")];
    const bySite = plan({
      courses: [jazz, ballet],
      closures: [closed("2026-11-12", "2026-11-12", { kind: "sites", siteIds: ["annexe"] })],
      existing,
    });
    expect(bySite.remove).toEqual(["b-2026-11-12"]);
    expect(bySite.setAside).toMatchObject([{ courseId: "ballet", instructorId: SUB }]);
    const byCourse = plan({
      courses: [jazz, ballet],
      closures: [closed("2026-11-12", "2026-11-12", { kind: "courses", courseIds: ["jazz"] })],
      existing,
    });
    expect(byCourse.remove).toEqual(["l-2026-11-12"]);
    expect(byCourse.setAside).toMatchObject([{ courseId: "jazz", instructorId: SUB }]);
  });

  it("does not keep aside a lesson the course no longer meets on (course changed, not closed)", () => {
    const p = plan({
      courses: [{ ...jazz, recurrence: { type: "weekly", weekday: 5, startDate: null, endDate: null } }],
      existing: [lessonOn("2026-11-12", { instructorId: SUB })],
    });
    expect(p.remove).toEqual(["l-2026-11-12"]);
    expect(p.setAside).toEqual([]);
  });

  it("never removes nor keeps aside a lesson whose attendance is taken, cancelled or done", () => {
    const p = plan({
      closures: [closed("2026-11-12", "2026-11-26")],
      existing: [
        lessonOn("2026-11-12", { instructorId: SUB, attendanceSheet: true }),
        lessonOn("2026-11-19", { instructorId: SUB, status: "cancelled" }),
        lessonOn("2026-11-26", { instructorId: SUB, status: "done" }),
      ],
    });
    expect(p.remove).toEqual([]);
    expect(p.setAside).toEqual([]);
  });

  it("keeps as is a lesson a lesson pack was counted on, and says so (#225)", () => {
    const p = plan({
      closures: [closed("2026-11-12", "2026-11-19")],
      existing: [
        lessonOn("2026-11-12", { instructorId: SUB, packUsage: true }),
        lessonOn("2026-11-19", { instructorId: SUB }),
      ],
    });
    expect(p.remove).toEqual(["l-2026-11-19"]);
    expect(p.keptForPack).toEqual(["l-2026-11-12"]);
    // Kept, not removed: nothing is set aside for it, and it is not created again.
    expect(p.setAside.map((k) => k.referenceDate)).toEqual(["2026-11-19"]);
    expect(p.insert.map((a) => a.date)).toEqual(["2026-11-05", "2026-11-26"]);
  });

  it("keeps but does not report a pack lesson moved alone off the closed day", () => {
    // Moved from 12/11 to 13/11: the closure of 12/11 takes its reference date, not the day it is on.
    const moved = lessonOn("2026-11-12", {
      id: "moved",
      date: "2026-11-13",
      plannedDate: "2026-11-12",
      packUsage: true,
    });
    const p = plan({ closures: [closed("2026-11-12", "2026-11-12")], existing: [moved] });
    expect(p.remove).toEqual([]);
    expect(p.keptForPack).toEqual([]);
  });

  it("keeps but does not report a pack lesson left on its old day by a weekday change", () => {
    const friday: SyncedCourse = {
      ...jazz,
      recurrence: { type: "weekly", weekday: 5, startDate: null, endDate: null },
    };
    const p = plan({ courses: [friday], existing: [lessonOn("2026-11-12", { packUsage: true })] });
    expect(p.remove).toEqual([]);
    expect(p.keptForPack).toEqual([]);
    expect(p.insert.map((a) => a.date)).toContain("2026-11-13");
  });

  it("reports only the pack lessons on the dates of the closure just added", () => {
    const p = plan({
      closures: [closed("2026-11-12", "2026-11-12"), closed("2026-11-26", "2026-11-26")],
      existing: [lessonOn("2026-11-12", { packUsage: true }), lessonOn("2026-11-26", { packUsage: true })],
      report: { start: "2026-11-26", end: "2026-11-26" },
    });
    expect(p.remove).toEqual([]);
    expect(p.keptForPack).toEqual(["l-2026-11-26"]);
  });

  it("reports no pack lesson when the lesson with pack usage stays wanted", () => {
    const p = plan({ existing: [lessonOn("2026-11-12", { packUsage: true })] });
    expect(p.keptForPack).toEqual([]);
    expect(p.remove).toEqual([]);
  });

  it("forgets what was kept aside once a pack lesson is back on its reference date", () => {
    // Kept aside before, then a lesson with pack usage on the same reference date: nothing to give back.
    const p = plan({
      existing: [lessonOn("2026-11-12", { packUsage: true })],
      suspended: [keptOn("2026-11-12", { instructorId: SUB })],
    });
    expect(p.forget).toEqual([{ courseId: "jazz", referenceDate: "2026-11-12" }]);
    expect(p.insert.map((a) => a.date)).not.toContain("2026-11-12");
  });

  it("judges a moved lesson on its original date, and keeps its new date aside", () => {
    // Moved from 19/11 to 13/11: the closure of 19/11 removes it, one of 13/11 would not.
    const moved = lessonOn("2026-11-19", { date: "2026-11-13", plannedDate: "2026-11-19" });
    expect(plan({ closures: [closed("2026-11-13", "2026-11-13")], existing: [moved] }).remove).toEqual([]);
    const p = plan({ closures: [closed("2026-11-19", "2026-11-19")], existing: [moved] });
    expect(p.remove).toEqual(["l-2026-11-19"]);
    expect(p.setAside).toEqual([keptOn("2026-11-19", { date: "2026-11-13", plannedDate: "2026-11-19" })]);
  });

  it("a one-off course keeps its dates under a school-wide closure, loses them under a course closure", () => {
    const stage: SyncedCourse = { ...jazz, id: "stage", recurrence: { type: "dates", dates: ["2026-11-14"] } };
    const lesson = { ...lessonOn("2026-11-14", { instructorId: SUB }), id: "s-14", courseId: "stage" };
    const school = plan({ courses: [stage], closures: [closed("2026-11-14", "2026-11-14")], existing: [lesson] });
    expect(school.remove).toEqual([]);
    const course = plan({
      courses: [stage],
      closures: [closed("2026-11-14", "2026-11-14", { kind: "courses", courseIds: ["stage"] })],
      existing: [lesson],
    });
    expect(course.remove).toEqual(["s-14"]);
    expect(course.setAside).toMatchObject([{ courseId: "stage", referenceDate: "2026-11-14", instructorId: SUB }]);
  });

  it("does not give a lesson back onto a new date that is closed now", () => {
    const p = plan({
      // 20/11 closed; 19/11 open again.
      closures: [closed("2026-11-20", "2026-11-20")],
      existing: ["2026-11-05", "2026-11-12", "2026-11-26"].map((d) => lessonOn(d)),
      suspended: [
        keptOn("2026-11-19", {
          date: "2026-11-20",
          plannedDate: "2026-11-19",
          startTime: "19:00:00",
          instructorId: SUB,
        }),
      ],
    });
    expect(p.insert).toEqual([
      {
        courseId: "jazz",
        date: "2026-11-19",
        plannedDate: null,
        startTime: null,
        durationMinutes: null,
        instructorId: SUB,
      },
    ]);
    expect(p.forget).toEqual([{ courseId: "jazz", referenceDate: "2026-11-19" }]);
  });

  it("keeps one row per course and reference date", () => {
    const p = plan({
      closures: [closed("2026-11-12", "2026-11-12")],
      existing: [
        // Moved from 12/11 to 13/11, and another lesson moved onto 12/11 itself: both reference 12/11.
        lessonOn("2026-11-12", { id: "a", date: "2026-11-13", plannedDate: "2026-11-12" }),
        lessonOn("2026-11-12", { id: "b", startTime: "20:00:00" }),
      ],
    });
    expect(p.remove).toEqual(["a", "b"]);
    expect(p.setAside).toHaveLength(1);
  });
});

describe("lessons outside the season's dates (#270)", () => {
  it("keeps a lesson moved from a date the season no longer has to one it still has", () => {
    // The season ends on 30 November: the 3 December lesson was moved to Friday 27 November.
    const moved = lessonOn("2026-11-27", { id: "moved", reference: "2026-12-03", plannedDate: "2026-12-03" });
    const p = plan({ existing: [...THURSDAYS.map((d) => lessonOn(d)), moved] });
    expect(p.remove).toEqual([]);
    expect(p.insert).toEqual([]);
  });

  it("removes one moved outside the season too, and a plain lesson after its end", () => {
    const movedOut = lessonOn("2026-12-04", { id: "out", reference: "2026-12-03", plannedDate: "2026-12-03" });
    const after = lessonOn("2026-12-10", { id: "after" });
    expect(plan({ existing: [...THURSDAYS.map((d) => lessonOn(d)), movedOut, after] }).remove).toEqual([
      "out",
      "after",
    ]);
  });

  it("removes the upcoming planned lessons before the season's start", () => {
    // Today 2 November, the season now starting on 10 November: the 5 November lesson is stale.
    const p = planLessonSync({
      start: TODAY,
      today: TODAY,
      season: { start: "2026-11-10", end: "2026-11-30" },
      ...seasonLessons([jazz], { start: "2026-11-10", end: "2026-11-30" }, [], TODAY),
      existing: THURSDAYS.map((d) => lessonOn(d)),
      suspended: [],
      activeInstructors: new Set([T1]),
    });
    expect(p.remove).toEqual(["l-2026-11-05"]);
  });
});
