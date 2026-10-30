import { describe, expect, it } from "vitest";
import {
  alreadyTaken,
  DUPLICATE_POLICY,
  duplicateRefusal,
  oneRowPerCourseAndStatus,
  TAKEN_STATUSES,
  type TakenCourse,
} from "./duplicates";

const ZOE = "student-zoe";
const ZACK = "student-zack";
const JAZZ = "course-jazz";
const CONTEMPORARY = "course-contemporary";

describe("courses a student already takes in the season", () => {
  it("finds a chosen course the student is enrolled in", () => {
    const taken: TakenCourse[] = [{ studentId: ZOE, courseId: JAZZ, status: "active" }];
    expect(alreadyTaken([ZOE], [JAZZ, CONTEMPORARY], taken)).toEqual([
      { studentId: ZOE, courseId: JAZZ, status: "active" },
    ]);
  });

  it("ignores the same course taken by another student, and another course of the student", () => {
    const taken: TakenCourse[] = [
      { studentId: ZACK, courseId: JAZZ, status: "active" },
      { studentId: ZOE, courseId: CONTEMPORARY, status: "active" },
    ];
    expect(alreadyTaken([ZOE], [JAZZ], taken)).toEqual([]);
  });

  it("counts a trial or waitlist enrollment, not a dropped or ended one (#284)", () => {
    const taken: TakenCourse[] = [
      { studentId: ZOE, courseId: JAZZ, status: "trial" },
      { studentId: ZOE, courseId: CONTEMPORARY, status: "waitlist" },
      { studentId: ZACK, courseId: JAZZ, status: "dropped" },
      { studentId: ZACK, courseId: CONTEMPORARY, status: "ended" },
    ];
    expect(alreadyTaken([ZOE, ZACK], [JAZZ, CONTEMPORARY], taken)).toEqual([
      { studentId: ZOE, courseId: JAZZ, status: "trial" },
      { studentId: ZOE, courseId: CONTEMPORARY, status: "waitlist" },
    ]);
    expect(TAKEN_STATUSES).toEqual(["active", "trial", "waitlist"]);
  });

  it("returns a student's course once, with the status that matters most, when already taken twice", () => {
    const taken: TakenCourse[] = [
      { studentId: ZOE, courseId: JAZZ, status: "waitlist" },
      { studentId: ZOE, courseId: JAZZ, status: "active" },
    ];
    expect(alreadyTaken([ZOE], [JAZZ], taken)).toEqual([{ studentId: ZOE, courseId: JAZZ, status: "active" }]);
  });

  it("checks both dancers of a couple", () => {
    const taken: TakenCourse[] = [{ studentId: ZACK, courseId: JAZZ, status: "active" }];
    expect(alreadyTaken([ZOE, ZACK], [JAZZ], taken)).toEqual([{ studentId: ZACK, courseId: JAZZ, status: "active" }]);
  });
});

describe("saving with a course already taken", () => {
  it("warns by default: saving asks for a confirmation, never refuses (#347, open question)", () => {
    expect(DUPLICATE_POLICY).toBe("warn");
    expect(duplicateRefusal(1, false)).toMatch(/Inscrire quand même/);
    expect(duplicateRefusal(1, true)).toBeNull();
  });

  it("refuses even a confirmed entry when the school chooses to refuse", () => {
    expect(duplicateRefusal(1, true, "refuse")).toMatch(/retirez-le/);
    expect(duplicateRefusal(0, false, "refuse")).toBeNull();
  });

  it("lets an enrollment without any course already taken through", () => {
    expect(duplicateRefusal(0, false)).toBeNull();
  });
});

describe("courses of a student's record", () => {
  it("lists a course once per status, in the order given", () => {
    const rows = [
      { id: JAZZ, status: "active" as const, note: 1 },
      { id: CONTEMPORARY, status: "active" as const, note: 2 },
      { id: JAZZ, status: "active" as const, note: 3 },
      { id: JAZZ, status: "dropped" as const, note: 4 },
    ];
    expect(oneRowPerCourseAndStatus(rows).map((r) => r.note)).toEqual([1, 2, 4]);
  });
});
