/**
 * Instructor monthly statement (#285), pure: what the school owes each
 * instructor for a month, lesson by lesson, from the lessons taught and the
 * rates (#191, #268). Computed live, nothing stored. Amounts in integer
 * cents, dates `YYYY-MM-DD`, months `YYYY-MM`.
 *
 * The rules of #285, each in one place:
 * - which lessons are owed (Q1, Q5, settled by the school: « pas de cours,
 *   pas de paiement »): `lessonPay`;
 * - a substitute's rate (Q2, settled in #192: the regular teacher's rate):
 *   `priceLesson`;
 * - who gets a statement (owners do not, settled): `hasStatement`;
 * - a pay mode or rate changed (Q3, default, still open): `rateChangedFlag`;
 * - monthly flat pay (Q4, default, unused at the first school): `flatOwed`
 *   and its flags.
 * The statement month is the calendar month: instructors invoice at month end.
 */

import { monthBounds } from "./month";
import { courseRateAllowed, effectiveRate, type PayMode, type RatedCourse, type RatedInstructor } from "./rate";

export type LessonStatus = "planned" | "done" | "cancelled";

/** A lesson of the month, with its course's own instructor and rate. */
export type StatementLesson = {
  id: string;
  /** Actual date: a moved lesson counts in the month it was moved to. */
  date: string;
  /** `HH:MM`, the lesson's own or the course's. */
  startTime: string;
  /** The lesson's own length or the course's. */
  durationMinutes: number;
  status: LessonStatus;
  /** Who teaches it: the course's instructor, or a substitute. */
  instructorId: string;
  courseId: string;
  /** « Jazz Débutant, lundi 18:00 ». */
  courseLabel: string;
  /** The course's own instructor and rate. */
  course: RatedCourse;
  /** The course's own (regular) instructor's pay: what a substitute is paid at. */
  regular: RatedInstructor;
  /** `taken` once attendance was taken (`attendanceTaken`); `present`: students marked present. */
  attendance: { taken: boolean; present: number };
};

export type StatementInstructor = RatedInstructor & {
  name: string;
  /** Runs the school (`instructor.is_owner`): no statement. */
  isOwner: boolean;
};

/** A change of an instructor's pay mode or default rate, or of the own rate of one of their courses: its day in Paris. */
export type RateChange = { instructorId: string; date: string };

/** A closure of the whole school (holidays, days off). */
export type SchoolClosure = { startDate: string; endDate: string };

/** Why a lesson is listed without an amount, « à chiffrer ». */
export type ToPrice = "old_unit" | "flat_course";

export const TO_PRICE_REASONS: Record<ToPrice, string> = {
  old_unit: "tarif du cours saisi dans un ancien mode de rémunération",
  flat_course: "remplacement d’un intervenant au forfait mensuel, sans tarif à la séance",
};

/** « à chiffrer — tarif du cours saisi dans un ancien mode de rémunération ». */
export const toPriceLabel = (reason: ToPrice) => `à chiffrer — ${TO_PRICE_REASONS[reason]}`;

/** Said of a lesson counted although attendance was not taken. */
export const NO_ATTENDANCE = "appel non fait";

export type StatementFlag = "no_attendance" | "rate_changed" | "flat_holidays" | "flat_no_lesson";

export const FLAG_TEXTS: Record<StatementFlag, string> = {
  no_attendance:
    "Appel non fait pour certaines séances : elles sont comptées, mais une séance sans élève présent n’est pas payée. Faites l’appel, ou annulez la séance si personne n’est venu.",
  rate_changed:
    "Un tarif ou le mode de rémunération a changé depuis le début du mois : le relevé est calculé avec les tarifs d’aujourd’hui. Vérifiez les séances d’avant le changement.",
  flat_holidays:
    "Forfait mensuel compté en entier alors que l’école ferme pendant ce mois (vacances, jours fériés) : à confirmer avec l’école.",
  flat_no_lesson: "Aucune séance ce mois-ci : forfait mensuel non compté, à confirmer avec l’école.",
};

/** The same, in a few words for the month's list. */
export const FLAG_SHORT: Record<StatementFlag, string> = {
  no_attendance: NO_ATTENDANCE,
  rate_changed: "tarif modifié depuis le début du mois",
  flat_holidays: "forfait d’un mois avec vacances",
  flat_no_lesson: "forfait non compté",
};

export type StatementLine = {
  lessonId: string;
  date: string;
  startTime: string;
  minutes: number;
  /** Taught as a substitute for the course's own instructor. */
  substitute: boolean;
  /** Counted although attendance was not taken: to check. */
  noAttendance: boolean;
  /** Rate applied; null: none. */
  rateCents: number | null;
  /** Unit of that rate: the pay mode it is paid in (the regular teacher's, for a substitute). */
  unit: PayMode | null;
  /** Null: not priced, either « à chiffrer » (`toPrice`) or paid by the monthly flat. */
  amountCents: number | null;
  toPrice: ToPrice | null;
};

export type CourseLines = {
  courseId: string;
  courseLabel: string;
  lines: StatementLine[];
  minutes: number;
  /** Sum of the priced lines. */
  amountCents: number;
};

export type InstructorStatement = {
  instructorId: string;
  name: string;
  payMode: PayMode;
  /** Current rate, in the unit of the pay mode (per hour, lesson or month). */
  rateCents: number;
  /** By course label, lines by date and time. */
  courses: CourseLines[];
  lessonCount: number;
  minutes: number;
  /** Sum of the priced lines. */
  linesCents: number;
  /** Monthly flat amount counted for the month; null: none (not paid so, or not owed). */
  flatCents: number | null;
  /** Amount due: priced lines plus the monthly flat; lessons « à chiffrer » are not in it. */
  totalCents: number;
  /** Lessons listed « à chiffrer », left out of the total. */
  toPriceCount: number;
  /** Lessons counted although attendance was not taken. */
  noAttendanceCount: number;
  /** Lessons not paid: attendance taken with nobody present. */
  nobodyCameCount: number;
  flags: StatementFlag[];
};

export type MonthStatement = {
  month: string;
  first: string;
  last: string;
  /** Today falls in the month: only the lessons up to today count. */
  inProgress: boolean;
  /** The month is after today: no lesson counts yet. */
  notStarted: boolean;
  /** Instructors with at least one lesson counted, by name. */
  statements: InstructorStatement[];
  lessonCount: number;
  minutes: number;
  totalCents: number;
  toPriceCount: number;
};

/** Attendance was taken: a sheet saved (the lesson becomes « effectuée ») or a student marked. */
export const attendanceTaken = (status: LessonStatus, marked: number) => status === "done" || marked > 0;

/**
 * Whether a lesson is owed for the month (#285 Q1 and Q5, settled by the
 * school: « pas de cours, pas de paiement »). Only lessons dated in the
 * month, up to today, count:
 * - a cancelled lesson is not owed (`not_counted`);
 * - a lesson whose attendance was taken with nobody present is not owed
 *   (`nobody_came`);
 * - any other lesson is owed, attendance taken or not: it is not taken in
 *   crowded courses, so a lesson without it is counted and flagged
 *   « appel non fait ».
 */
export function lessonPay(
  l: Pick<StatementLesson, "date" | "status" | "attendance">,
  month: string,
  today: string,
): "owed" | "nobody_came" | "not_counted" {
  const { first, last } = monthBounds(month);
  if (l.status === "cancelled" || l.date < first || l.date > last || l.date > today) return "not_counted";
  return l.attendance.taken && l.attendance.present === 0 ? "nobody_came" : "owed";
}

/** Owners run the school and invoice nothing to it: they get no statement (settled by the school). */
export const hasStatement = (i: Pick<StatementInstructor, "isOwner">) => !i.isOwner;

/**
 * Pay for one lesson of an hourly instructor: rate × minutes ÷ 60, rounded
 * to the nearest cent, half a cent up, in integers (no floating-point).
 * Each lesson is rounded on its own and the total is the sum of the lines,
 * so that the statement adds up as shown.
 */
export function hourlyAmount(rateCents: number, minutes: number): number {
  if (!Number.isInteger(rateCents) || !Number.isInteger(minutes) || rateCents < 0 || minutes < 0)
    throw new TypeError("Taux et durée doivent être des entiers positifs");
  return Math.floor((rateCents * minutes + 30) / 60);
}

/**
 * Price of a lesson for the instructor who taught it (#191, #268).
 * A substitute is paid the regular teacher's rate for the course (#192 Q1,
 * settled): the course's own rate, else the regular teacher's default rate,
 * in the regular teacher's unit, whatever the substitute's own rate. A
 * regular teacher paid a monthly flat has no rate per lesson: such a
 * replacement is « à chiffrer ». A course rate typed in another unit than
 * the current pay mode is not read in the new one (#268). A monthly flat
 * instructor's own lessons are shown for information (the flat pays them).
 */
export function priceLesson(
  l: StatementLesson,
  i: RatedInstructor,
): Pick<StatementLine, "substitute" | "rateCents" | "unit" | "amountCents" | "toPrice"> {
  const substitute = l.instructorId !== l.course.instructorId;
  const payer = substitute ? l.regular : i;
  const none = { substitute, rateCents: null, unit: null, amountCents: null };
  if (!courseRateAllowed(payer.payMode)) return { ...none, toPrice: substitute ? "flat_course" : null };
  const rate = effectiveRate(l.course, payer);
  if (rate === null) return { ...none, toPrice: "old_unit" };
  const amountCents = payer.payMode === "hourly" ? hourlyAmount(rate, l.durationMinutes) : rate;
  return { substitute, rateCents: rate, unit: payer.payMode, amountCents, toPrice: null };
}

/**
 * Open question 4 (default): a monthly flat instructor is owed the flat
 * amount for every month with at least one lesson taught; none otherwise
 * (July, August), flagged for confirmation either way when in doubt.
 */
export const flatOwed = (i: RatedInstructor, lessonCount: number): number | null =>
  i.payMode === "monthly_flat" && lessonCount > 0 ? i.rateCents : null;

/**
 * Open question 3 (default): the statement uses today's rates; it is flagged
 * when the pay mode or a rate of an instructor `whose` rates it uses (theirs,
 * and the regular teachers of the lessons they replaced) changed since the
 * first day of the month, since lessons before the change may have been owed
 * at another rate. Freezing a validated statement (follow-up) settles history.
 */
export const rateChangedFlag = (changes: readonly RateChange[], whose: ReadonlySet<string>, month: string) =>
  changes.some((c) => whose.has(c.instructorId) && c.date >= monthBounds(month).first);

const byDateAndTime = (a: StatementLine, b: StatementLine) =>
  a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime);

/**
 * Statement of one instructor for the month: the lessons they taught
 * (`lessons` may hold others', left out), grouped by course.
 * `rateChanges` are the school's (only those of the instructors whose rates
 * the statement uses matter), `closures` the school's.
 */
export function instructorStatement(input: {
  month: string;
  today: string;
  instructor: StatementInstructor;
  lessons: readonly StatementLesson[];
  rateChanges: readonly RateChange[];
  closures: readonly SchoolClosure[];
}): InstructorStatement {
  const { month, today, instructor: i, lessons, rateChanges, closures } = input;
  const { first, last } = monthBounds(month);
  const groups = new Map<string, CourseLines>();
  const whose = new Set([i.id]);
  let nobodyCameCount = 0;
  for (const l of lessons) {
    if (l.instructorId !== i.id) continue;
    const pay = lessonPay(l, month, today);
    if (pay === "nobody_came") nobodyCameCount += 1;
    if (pay !== "owed") continue;
    const line: StatementLine = {
      lessonId: l.id,
      date: l.date,
      startTime: l.startTime,
      minutes: l.durationMinutes,
      noAttendance: !l.attendance.taken,
      ...priceLesson(l, i),
    };
    whose.add(l.course.instructorId);
    const g = groups.get(l.courseId) ?? {
      courseId: l.courseId,
      courseLabel: l.courseLabel,
      lines: [],
      minutes: 0,
      amountCents: 0,
    };
    g.lines.push(line);
    g.minutes += line.minutes;
    g.amountCents += line.amountCents ?? 0;
    groups.set(l.courseId, g);
  }
  const courses = [...groups.values()]
    .map((g) => ({ ...g, lines: g.lines.toSorted(byDateAndTime) }))
    .sort((a, b) => a.courseLabel.localeCompare(b.courseLabel, "fr") || a.courseId.localeCompare(b.courseId));
  const lines = courses.flatMap((g) => g.lines);
  const lessonCount = lines.length;
  const linesCents = courses.reduce((s, g) => s + g.amountCents, 0);
  const flatCents = flatOwed(i, lessonCount);
  const noAttendanceCount = lines.filter((l) => l.noAttendance).length;
  const flags: StatementFlag[] = [];
  if (noAttendanceCount > 0) flags.push("no_attendance");
  if (rateChangedFlag(rateChanges, whose, month)) flags.push("rate_changed");
  if (flatCents !== null && closures.some((c) => c.startDate <= last && c.endDate >= first))
    flags.push("flat_holidays");
  // A month not started yet is not « without lessons ».
  if (i.payMode === "monthly_flat" && lessonCount === 0 && first <= today) flags.push("flat_no_lesson");
  return {
    instructorId: i.id,
    name: i.name,
    payMode: i.payMode,
    rateCents: i.rateCents,
    courses,
    lessonCount,
    minutes: lines.reduce((s, l) => s + l.minutes, 0),
    linesCents,
    flatCents,
    totalCents: linesCents + (flatCents ?? 0),
    toPriceCount: lines.filter((l) => l.toPrice !== null).length,
    noAttendanceCount,
    nobodyCameCount,
    flags,
  };
}

/** Whether today falls in the month (lessons count up to today), or before it (none counts yet). */
export function monthState(month: string, today: string): { inProgress: boolean; notStarted: boolean } {
  const { first, last } = monthBounds(month);
  return { inProgress: first <= today && today <= last, notStarted: today < first };
}

/** Statements of every instructor who taught in the month (owners aside), and the month's totals. */
export function monthStatement(input: {
  month: string;
  today: string;
  instructors: readonly StatementInstructor[];
  lessons: readonly StatementLesson[];
  rateChanges: readonly RateChange[];
  closures: readonly SchoolClosure[];
}): MonthStatement {
  const { month, today, instructors, lessons, rateChanges, closures } = input;
  const { first, last } = monthBounds(month);
  const statements = instructors
    .filter(hasStatement)
    .map((i) =>
      instructorStatement({
        month,
        today,
        instructor: i,
        lessons,
        rateChanges,
        closures,
      }),
    )
    .filter((s) => s.lessonCount > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "fr") || a.instructorId.localeCompare(b.instructorId));
  const sum = (f: (s: InstructorStatement) => number) => statements.reduce((t, s) => t + f(s), 0);
  return {
    month,
    first,
    last,
    ...monthState(month, today),
    statements,
    lessonCount: sum((s) => s.lessonCount),
    minutes: sum((s) => s.minutes),
    totalCents: sum((s) => s.totalCents),
    toPriceCount: sum((s) => s.toPriceCount),
  };
}

/** Note of a substitute's lesson: paid at the regular teacher's rate for the course. */
export const SUBSTITUTE = "remplacement, au tarif du cours";

/** Note of a monthly flat instructor's own lesson: paid by the flat amount. */
export const IN_FLAT = "compris dans le forfait mensuel";

/**
 * What a line says besides its amount, for the page and the export:
 * « remplacement, au tarif du cours », « à chiffrer — … », « compris dans le
 * forfait mensuel », « appel non fait »; null: nothing.
 */
export function lineRemark(l: StatementLine, payMode: PayMode): string | null {
  const parts = [
    ...(l.substitute ? [SUBSTITUTE] : []),
    ...(l.toPrice ? [toPriceLabel(l.toPrice)] : []),
    ...(!l.substitute && !l.toPrice && payMode === "monthly_flat" ? [IN_FLAT] : []),
    ...(l.noAttendance ? [NO_ATTENDANCE] : []),
  ];
  return parts.length > 0 ? parts.join(", ") : null;
}

/** « 1 h 30 », « 45 min », « 12 h ». */
export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}
