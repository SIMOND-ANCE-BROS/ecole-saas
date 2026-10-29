import { describe, expect, it } from "vitest";
import type { PayMode } from "./rate";
import {
  attendanceTaken,
  hasStatement,
  hourlyAmount,
  hoursLabel,
  instructorStatement,
  lessonPay,
  lineRemark,
  monthStatement,
  priceLesson,
  type StatementInstructor,
  type StatementLesson,
} from "./statement";

const MONTH = "2027-10";
const AFTER = "2027-11-15";

const perLesson: StatementInstructor = {
  id: "i1",
  name: "Zoé Test",
  payMode: "per_lesson",
  rateCents: 3000,
  isOwner: false,
};
const hourly: StatementInstructor = { id: "i2", name: "Alix Test", payMode: "hourly", rateCents: 2500, isOwner: false };
const flat: StatementInstructor = {
  id: "i3",
  name: "Marin Test",
  payMode: "monthly_flat",
  rateCents: 80000,
  isOwner: false,
};
const owner: StatementInstructor = {
  id: "i4",
  name: "Bao Test",
  payMode: "per_lesson",
  rateCents: 5000,
  isOwner: true,
};
const BY_ID = new Map([perLesson, hourly, flat, owner].map((i) => [i.id, i]));

const TAKEN = { taken: true, present: 5 };
const NOT_TAKEN = { taken: false, present: 0 };

let n = 0;
/** A lesson of a course of `courseOf`, taught by them unless `instructorId` says otherwise; attendance taken with students by default. */
function lesson(
  courseOf: string,
  date: string,
  more: Partial<Omit<StatementLesson, "course" | "regular">> & {
    rate?: number;
    unit?: PayMode;
    courseId?: string;
  } = {},
): StatementLesson {
  const { rate, unit, courseId, ...rest } = more;
  n += 1;
  const regular = BY_ID.get(courseOf);
  if (!regular) throw new Error(`unknown instructor ${courseOf}`);
  return {
    id: `l${n}`,
    date,
    startTime: "18:00",
    durationMinutes: 60,
    status: "done",
    instructorId: courseOf,
    courseId: courseId ?? `c-${courseOf}`,
    courseLabel: `Cours ${courseId ?? courseOf}`,
    course: {
      instructorId: courseOf,
      instructorRateCents: rate ?? null,
      instructorRatePayMode: rate === undefined ? null : (unit ?? regular.payMode),
    },
    regular: { id: regular.id, payMode: regular.payMode, rateCents: regular.rateCents },
    attendance: TAKEN,
    ...rest,
  };
}

const statementOf = (
  instructor: StatementInstructor,
  lessons: StatementLesson[],
  more: {
    today?: string;
    /** Days of the instructor's own rate changes. */
    rateChanges?: string[];
    closures?: { startDate: string; endDate: string }[];
  } = {},
) =>
  instructorStatement({
    month: MONTH,
    today: more.today ?? AFTER,
    instructor,
    lessons,
    rateChanges: (more.rateChanges ?? []).map((date) => ({ instructorId: instructor.id, date })),
    closures: more.closures ?? [],
  });

describe("lessonPay (« pas de cours, pas de paiement »)", () => {
  const at = (date: string, status: StatementLesson["status"], attendance = TAKEN, today = AFTER) =>
    lessonPay({ date, status, attendance }, MONTH, today);

  it("owes a lesson whose attendance shows students present", () => {
    expect(at("2027-10-05", "done")).toBe("owed");
  });

  it("owes a lesson without attendance (crowded courses), to flag", () => {
    expect(at("2027-10-05", "planned", NOT_TAKEN)).toBe("owed");
  });

  it("does not owe a lesson where nobody came", () => {
    expect(at("2027-10-05", "done", { taken: true, present: 0 })).toBe("nobody_came");
  });

  it("never counts a cancelled lesson", () => {
    expect(at("2027-10-05", "cancelled")).toBe("not_counted");
    expect(at("2027-10-05", "cancelled", NOT_TAKEN)).toBe("not_counted");
  });

  it("counts the first and last day of the calendar month, not the days around it", () => {
    expect(at("2027-10-01", "done")).toBe("owed");
    expect(at("2027-10-31", "done")).toBe("owed");
    expect(at("2027-09-30", "done")).toBe("not_counted");
    expect(at("2027-11-01", "done")).toBe("not_counted");
  });

  it("counts lessons up to today only, today included", () => {
    expect(at("2027-10-14", "planned", NOT_TAKEN, "2027-10-14")).toBe("owed");
    expect(at("2027-10-15", "planned", NOT_TAKEN, "2027-10-14")).toBe("not_counted");
  });
});

describe("attendanceTaken", () => {
  it("is taken once the sheet is saved or a student is marked", () => {
    expect(attendanceTaken("done", 0)).toBe(true);
    expect(attendanceTaken("planned", 2)).toBe(true);
    expect(attendanceTaken("planned", 0)).toBe(false);
  });
});

describe("hasStatement", () => {
  it("gives no statement to the school's owners", () => {
    expect(hasStatement(owner)).toBe(false);
    expect(hasStatement(perLesson)).toBe(true);
  });
});

describe("hourlyAmount", () => {
  it("prices 1 h 30 at 25,00 €/h at 37,50 €", () => {
    expect(hourlyAmount(2500, 90)).toBe(3750);
  });

  it("rounds to the nearest cent, half a cent up", () => {
    // 25,01 € × 45 / 60 = 18,7575 € → 18,76 €
    expect(hourlyAmount(2501, 45)).toBe(1876);
    // 0,30 € × 5 / 60 = 0,025 € → 0,03 € (exactly half: up)
    expect(hourlyAmount(30, 5)).toBe(3);
    // 0,29 € × 5 / 60 = 0,02416… € → 0,02 €
    expect(hourlyAmount(29, 5)).toBe(2);
  });

  it("stays exact on large amounts (integers only)", () => {
    expect(hourlyAmount(100_000_00, 24 * 60)).toBe(2_400_000_00);
    expect(hourlyAmount(3333, 20)).toBe(1111);
  });

  it("refuses a non-integer rate or length", () => {
    expect(() => hourlyAmount(25.5, 60)).toThrow(TypeError);
    expect(() => hourlyAmount(2500, 1.5)).toThrow(TypeError);
    expect(() => hourlyAmount(-1, 60)).toThrow(TypeError);
  });
});

describe("priceLesson", () => {
  it("prices a lesson by the lesson whatever its length", () => {
    expect(priceLesson(lesson("i1", "2027-10-05", { durationMinutes: 90 }), perLesson)).toEqual({
      substitute: false,
      rateCents: 3000,
      unit: "per_lesson",
      amountCents: 3000,
      toPrice: null,
    });
  });

  it("uses the course's own rate rather than the default one (#191)", () => {
    const l = lesson("i2", "2027-10-05", { rate: 4000, durationMinutes: 45 });
    expect(priceLesson(l, hourly)).toMatchObject({ rateCents: 4000, unit: "hourly", amountCents: 3000, toPrice: null });
  });

  it("keeps a course rate of zero", () => {
    expect(priceLesson(lesson("i1", "2027-10-05", { rate: 0 }), perLesson)).toMatchObject({
      rateCents: 0,
      amountCents: 0,
      toPrice: null,
    });
  });

  it("does not price a course rate typed in another unit (#268)", () => {
    const l = lesson("i1", "2027-10-05", { rate: 4000, unit: "hourly" });
    expect(priceLesson(l, perLesson)).toEqual({
      substitute: false,
      rateCents: null,
      unit: null,
      amountCents: null,
      toPrice: "old_unit",
    });
  });

  it("pays a substitute the regular teacher's default rate, not their own (#192 Q1)", () => {
    // The substitute (25,00 €/h) replaces a teacher paid 30,00 € per lesson.
    const l = lesson("i1", "2027-10-05", { instructorId: "i2", durationMinutes: 90 });
    expect(priceLesson(l, hourly)).toEqual({
      substitute: true,
      rateCents: 3000,
      unit: "per_lesson",
      amountCents: 3000,
      toPrice: null,
    });
  });

  it("pays a substitute the course's own rate when it has one", () => {
    const l = lesson("i2", "2027-10-05", { instructorId: "i1", rate: 4000, durationMinutes: 45 });
    // 40,00 €/h × 45 min, in the regular teacher's unit.
    expect(priceLesson(l, perLesson)).toMatchObject({ rateCents: 4000, unit: "hourly", amountCents: 3000 });
  });

  it("leaves to price a replacement of a monthly flat teacher", () => {
    const l = lesson("i3", "2027-10-05", { instructorId: "i1" });
    expect(priceLesson(l, perLesson)).toMatchObject({ substitute: true, amountCents: null, toPrice: "flat_course" });
  });

  it("shows a monthly flat instructor's own lesson for information, without an amount", () => {
    expect(priceLesson(lesson("i3", "2027-10-05"), flat)).toEqual({
      substitute: false,
      rateCents: null,
      unit: null,
      amountCents: null,
      toPrice: null,
    });
  });
});

describe("instructorStatement", () => {
  it("counts 6 lessons at 30,00 € as 180,00 €", () => {
    const days = ["01", "05", "08", "12", "15", "19"].map((d) => lesson("i1", `2027-10-${d}`));
    const s = statementOf(perLesson, days);
    expect(s.lessonCount).toBe(6);
    expect(s.minutes).toBe(360);
    expect(s.totalCents).toBe(18000);
    expect(s.toPriceCount).toBe(0);
    expect(s.flags).toEqual([]);
  });

  it("leaves out cancelled lessons, lessons nobody came to, and other instructors' lessons", () => {
    const s = statementOf(perLesson, [
      lesson("i1", "2027-10-05"),
      lesson("i1", "2027-10-12", { status: "cancelled" }),
      lesson("i1", "2027-10-19", { attendance: { taken: true, present: 0 } }),
      lesson("i2", "2027-10-12"),
    ]);
    expect(s.lessonCount).toBe(1);
    expect(s.totalCents).toBe(3000);
    expect(s.nobodyCameCount).toBe(1);
  });

  it("counts a lesson without attendance and flags it « appel non fait »", () => {
    const s = statementOf(perLesson, [
      lesson("i1", "2027-10-05"),
      lesson("i1", "2027-10-12", { status: "planned", attendance: NOT_TAKEN }),
    ]);
    expect(s.lessonCount).toBe(2);
    expect(s.totalCents).toBe(6000);
    expect(s.noAttendanceCount).toBe(1);
    expect(s.flags).toEqual(["no_attendance"]);
    expect(s.courses[0].lines.map((l) => l.noAttendance)).toEqual([false, true]);
  });

  it("counts a lesson moved to another month in the month of its actual date", () => {
    const moved = lesson("i1", "2027-11-02", { courseId: "c1" });
    const intoOctober = lesson("i1", "2027-10-29", { courseId: "c1" });
    const s = statementOf(perLesson, [moved, intoOctober], { today: "2027-12-01" });
    expect(s.courses[0].lines.map((l) => l.date)).toEqual(["2027-10-29"]);
    const november = instructorStatement({
      month: "2027-11",
      today: "2027-12-01",
      instructor: perLesson,
      lessons: [moved, intoOctober],
      rateChanges: [],
      closures: [],
    });
    expect(november.lessonCount).toBe(1);
    expect(november.courses[0].lines[0].date).toBe("2027-11-02");
  });

  it("mixes per-course and default rates, grouped by course with subtotals", () => {
    const s = statementOf(hourly, [
      lesson("i2", "2027-10-04", { courseId: "a", durationMinutes: 90 }),
      lesson("i2", "2027-10-11", { courseId: "a", durationMinutes: 90 }),
      lesson("i2", "2027-10-06", { courseId: "b", rate: 3000, durationMinutes: 60 }),
    ]);
    expect(s.courses.map((c) => [c.courseId, c.lines.length, c.minutes, c.amountCents])).toEqual([
      ["a", 2, 180, 7500],
      ["b", 1, 60, 3000],
    ]);
    expect(s.totalCents).toBe(10500);
  });

  it("sorts lines by date then time within a course", () => {
    const s = statementOf(perLesson, [
      lesson("i1", "2027-10-12", { courseId: "a" }),
      lesson("i1", "2027-10-05", { courseId: "a", startTime: "19:00" }),
      lesson("i1", "2027-10-05", { courseId: "a", startTime: "09:30" }),
    ]);
    expect(s.courses[0].lines.map((l) => `${l.date} ${l.startTime}`)).toEqual([
      "2027-10-05 09:30",
      "2027-10-05 19:00",
      "2027-10-12 18:00",
    ]);
  });

  it("sums lines rounded one by one: the total adds up as shown (cents left over)", () => {
    // 25,01 €/h × 45 min = 18,7575 € → 18,76 € per lesson; three lessons: 56,28 €, not 56,27 €.
    const rate = { ...hourly, rateCents: 2501 };
    const s = statementOf(
      rate,
      ["04", "11", "18"].map((d) => ({ ...lesson("i2", `2027-10-${d}`, { durationMinutes: 45 }), regular: rate })),
    );
    expect(s.courses[0].lines.map((l) => l.amountCents)).toEqual([1876, 1876, 1876]);
    expect(s.totalCents).toBe(5628);
    expect(Number.isInteger(s.totalCents)).toBe(true);
  });

  it("puts a substitute's lesson on the substitute's statement, at the regular teacher's rate", () => {
    const replaced = lesson("i1", "2027-10-12", { instructorId: "i2", durationMinutes: 90 });
    const regular = statementOf(perLesson, [lesson("i1", "2027-10-05"), replaced]);
    expect(regular.lessonCount).toBe(1);
    expect(regular.totalCents).toBe(3000);
    const substitute = statementOf(hourly, [lesson("i2", "2027-10-06", { durationMinutes: 60 }), replaced]);
    expect(substitute.lessonCount).toBe(2);
    expect(substitute.toPriceCount).toBe(0);
    // 25,00 € (own lesson, 1 h) + 30,00 € (replacement, the regular teacher's rate per lesson).
    expect(substitute.totalCents).toBe(5500);
    const line = substitute.courses.flatMap((c) => c.lines).find((l) => l.lessonId === replaced.id);
    expect(line).toMatchObject({ substitute: true, rateCents: 3000, unit: "per_lesson", amountCents: 3000 });
  });

  it("lists a lesson whose course rate is in an old unit to price, out of the total", () => {
    const s = statementOf(perLesson, [
      lesson("i1", "2027-10-05"),
      lesson("i1", "2027-10-06", { courseId: "old", rate: 4000, unit: "hourly" }),
    ]);
    expect(s.toPriceCount).toBe(1);
    expect(s.totalCents).toBe(3000);
  });

  it("counts the monthly flat amount and shows the lessons for information", () => {
    const s = statementOf(flat, [lesson("i3", "2027-10-05"), lesson("i3", "2027-10-12")]);
    expect(s.lessonCount).toBe(2);
    expect(s.linesCents).toBe(0);
    expect(s.flatCents).toBe(80000);
    expect(s.totalCents).toBe(80000);
    expect(s.toPriceCount).toBe(0);
    expect(s.flags).toEqual([]);
  });

  it("adds a monthly flat instructor's replacement, at the regular teacher's rate, to the flat amount", () => {
    const s = statementOf(flat, [lesson("i3", "2027-10-05"), lesson("i1", "2027-10-06", { instructorId: "i3" })]);
    expect(s.totalCents).toBe(83000);
    expect(s.toPriceCount).toBe(0);
  });

  it("flags the monthly flat amount of a month with a school closure (open question 4)", () => {
    const s = statementOf(flat, [lesson("i3", "2027-10-05")], {
      closures: [{ startDate: "2027-10-23", endDate: "2027-11-07" }],
    });
    expect(s.flatCents).toBe(80000);
    expect(s.flags).toEqual(["flat_holidays"]);
  });

  it("does not flag a closure outside the month", () => {
    const s = statementOf(flat, [lesson("i3", "2027-10-05")], {
      closures: [{ startDate: "2027-11-01", endDate: "2027-11-07" }],
    });
    expect(s.flags).toEqual([]);
  });

  it("counts no monthly flat amount for a month without lessons, flagged (July, August)", () => {
    const s = statementOf(flat, [lesson("i3", "2027-10-05", { status: "cancelled" })]);
    expect(s.flatCents).toBeNull();
    expect(s.totalCents).toBe(0);
    expect(s.flags).toEqual(["flat_no_lesson"]);
  });

  it("does not call a month not started yet a month without lessons", () => {
    expect(statementOf(flat, [lesson("i3", "2027-10-05")], { today: "2027-09-20" }).flags).toEqual([]);
  });

  it("flags a pay mode or rate changed since the start of the month (open question 3)", () => {
    expect(statementOf(perLesson, [lesson("i1", "2027-10-05")], { rateChanges: ["2027-10-15"] }).flags).toEqual([
      "rate_changed",
    ]);
    // Changed later: the October lessons were taught at the old rate too.
    expect(statementOf(perLesson, [lesson("i1", "2027-10-05")], { rateChanges: ["2027-11-03"] }).flags).toEqual([
      "rate_changed",
    ]);
    expect(statementOf(perLesson, [lesson("i1", "2027-10-05")], { rateChanges: ["2027-09-30"] }).flags).toEqual([]);
  });

  it("flags a substitute's statement when the regular teacher's rate changed, not for others' changes", () => {
    const replaced = lesson("i1", "2027-10-12", { instructorId: "i2" });
    const changes = [{ instructorId: "i1", date: "2027-10-20" }];
    const of = (lessons: StatementLesson[]) =>
      instructorStatement({
        month: MONTH,
        today: AFTER,
        instructor: hourly,
        lessons,
        rateChanges: changes,
        closures: [],
      });
    expect(of([lesson("i2", "2027-10-05"), replaced]).flags).toEqual(["rate_changed"]);
    expect(of([lesson("i2", "2027-10-05")]).flags).toEqual([]);
  });

  it("counts nothing for a month not started yet", () => {
    const s = statementOf(perLesson, [lesson("i1", "2027-10-05")], { today: "2027-09-20" });
    expect(s.lessonCount).toBe(0);
    expect(s.totalCents).toBe(0);
  });
});

describe("lineRemark", () => {
  it("says what a line is besides its amount", () => {
    const s = statementOf(perLesson, [
      lesson("i1", "2027-10-05"),
      lesson("i2", "2027-10-06", { instructorId: "i1", attendance: NOT_TAKEN }),
      lesson("i1", "2027-10-07", { courseId: "old", rate: 4000, unit: "hourly" }),
    ]);
    const lines = s.courses.flatMap((c) => c.lines);
    expect(lines.map((l) => lineRemark(l, s.payMode))).toEqual([
      null,
      "remplacement, au tarif du cours, appel non fait",
      "à chiffrer — tarif du cours saisi dans un ancien mode de rémunération",
    ]);
    const f = statementOf(flat, [lesson("i3", "2027-10-05")]);
    expect(lineRemark(f.courses[0].lines[0], "monthly_flat")).toBe("compris dans le forfait mensuel");
  });
});

describe("monthStatement", () => {
  const lessons = [
    lesson("i1", "2027-10-05"),
    lesson("i1", "2027-10-20"),
    lesson("i2", "2027-10-06", { durationMinutes: 90 }),
    lesson("i1", "2027-10-07", { instructorId: "i2" }),
    lesson("i3", "2027-10-08", { status: "cancelled" }),
    lesson("i4", "2027-10-09"),
    // An owner replacing someone: no statement for them either.
    lesson("i2", "2027-10-10", { instructorId: "i4" }),
  ];
  const input = {
    month: MONTH,
    instructors: [perLesson, hourly, flat, owner],
    lessons,
    rateChanges: [{ instructorId: "i2", date: "2027-10-10" }],
    closures: [],
  };

  it("lists the instructors who taught, owners aside, by name, with the month's totals", () => {
    const m = monthStatement({ ...input, today: AFTER });
    expect(m.statements.map((s) => s.name)).toEqual(["Alix Test", "Zoé Test"]);
    expect(m.lessonCount).toBe(4);
    expect(m.minutes).toBe(270);
    expect(m.totalCents).toBe(6000 + 3750 + 3000);
    expect(m.toPriceCount).toBe(0);
    expect(m.inProgress).toBe(false);
    expect(m.notStarted).toBe(false);
  });

  it("gives each instructor their own rate changes only", () => {
    const m = monthStatement({ ...input, today: AFTER });
    expect(m.statements.find((s) => s.instructorId === "i2")?.flags).toEqual(["rate_changed"]);
    expect(m.statements.find((s) => s.instructorId === "i1")?.flags).toEqual([]);
  });

  it("counts a month in progress up to today", () => {
    const m = monthStatement({ ...input, today: "2027-10-06" });
    expect(m.inProgress).toBe(true);
    expect(m.lessonCount).toBe(2);
    expect(m.statements.map((s) => s.name)).toEqual(["Alix Test", "Zoé Test"]);
  });

  it("is empty for a month not started yet", () => {
    const m = monthStatement({ ...input, today: "2027-09-01" });
    expect(m.notStarted).toBe(true);
    expect(m.statements).toEqual([]);
    expect(m.totalCents).toBe(0);
  });
});

describe("hoursLabel", () => {
  it("writes hours and minutes the French way", () => {
    expect(hoursLabel(45)).toBe("45 min");
    expect(hoursLabel(60)).toBe("1 h");
    expect(hoursLabel(90)).toBe("1 h 30");
    expect(hoursLabel(605)).toBe("10 h 05");
    expect(hoursLabel(0)).toBe("0 min");
  });
});
