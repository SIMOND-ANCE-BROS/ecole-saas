import { AGE_OF_MAJORITY } from "../people/age";
import type { EnrollmentStatus } from "./statuses";

/**
 * Lifecycle of an enrollment (#284): which status changes are allowed, which
 * actions the front desk is offered, and who appears on attendance sheets and
 * course lists. Pure functions, no database.
 *
 * The rules still to be confirmed by the school (#284, « Open questions ») each
 * live in one place, with their recommended default:
 * 1. What is owed for a dropped or trial enrollment: `DUE_STATUSES` (`src/domain/payments/balance.ts`, #99).
 *    The school's rules (2026-10-29): a paid quarter or year not attended is neither carried over
 *    nor refunded, so a drop-out stays due; a trial or waitlist enrollment is not due.
 * 2. A status change never re-prices another saved enrollment: `discountImpacts` (`./impacts.ts`) only reports it.
 * 3. Only active enrollments count as siblings: `SIBLING_STATUSES` below.
 * 4. The price is recomputed at confirmation: `confirmationPrice` below.
 * 5. A full course is a warning, not a hard limit: `fullCourseAdvice` below. The school limits
 *    children's courses only (answers on #284, 2026-10-29): adult courses are never « full ».
 * 6. A trial never expires on its own: no automatic change exists; confirm or drop by hand.
 */

/** Statuses an enrollment can be created with, the default first (#284). */
export const INITIAL_STATUSES = ["active", "trial", "waitlist"] as const satisfies readonly EnrollmentStatus[];
export type InitialStatus = (typeof INITIAL_STATUSES)[number];

/**
 * Allowed changes of status. Dropped and ended are final; cancelling a mistake is not a
 * change of status. A family giving up the waitlist never attended: its enrollment is
 * cancelled, not dropped (a drop-out stays due and appears on the sheets up to its date).
 */
const TRANSITIONS: Record<EnrollmentStatus, readonly EnrollmentStatus[]> = {
  trial: ["active", "dropped"],
  waitlist: ["active"],
  active: ["dropped"],
  dropped: [],
  ended: [],
};

/** Whether an enrollment may go from `from` to `to`. */
export const canChange = (from: EnrollmentStatus, to: EnrollmentStatus): boolean => TRANSITIONS[from].includes(to);

/** Why a change of status is refused, in French for the front desk; null when allowed. */
export function transitionRefusal(from: EnrollmentStatus, to: EnrollmentStatus): string | null {
  if (canChange(from, to)) return null;
  if (from === to && to === "active") return "Cette inscription est déjà confirmée.";
  if (from === to && to === "dropped") return "L’abandon de cette inscription est déjà enregistré.";
  if (from === "dropped") return "Cette inscription est abandonnée : elle ne peut plus changer de statut.";
  if (from === "ended") return "Cette inscription est terminée : elle ne peut plus changer de statut.";
  if (from === "waitlist" && to === "dropped")
    return "Une inscription en attente n’a jamais été suivie : annulez-la plutôt.";
  return "Ce changement de statut n’est pas possible.";
}

/** What the front desk can do with a saved enrollment. */
export type EnrollmentActions = { confirm: boolean; drop: boolean; cancel: boolean };

/** What blocks cancelling an enrollment entered by mistake. */
export type CancelBlockers = {
  /** An invoice line refers to it: a credit note is the only way back (CLAUDE.md §5). */
  invoiced: boolean;
  /** Attendance was taken for it, no other enrollment of the student covering the course: a drop-out happened. */
  attended: boolean;
};

/** Why an enrollment cannot be cancelled, in French; null when it can. */
export function cancelRefusal({ invoiced, attended }: CancelBlockers): string | null {
  if (invoiced) return "Cette inscription est facturée : passez par un avoir.";
  if (attended) return "Des présences sont déjà relevées pour cette inscription : enregistrez plutôt un abandon.";
  return null;
}

/** Actions offered on a saved enrollment. */
export function enrollmentActions(status: EnrollmentStatus, blockers: CancelBlockers): EnrollmentActions {
  return {
    confirm: canChange(status, "active"),
    drop: canChange(status, "dropped"),
    cancel: cancelRefusal(blockers) === null,
  };
}

/** Q3 (#284): statuses counted as siblings by the tariff engine, for the payer's other enrollments. */
export const SIBLING_STATUSES = ["active"] as const satisfies readonly EnrollmentStatus[];

/** Whether an enrollment with this status counts as a sibling for the payer's others (Q3). */
export const countsAsSibling = (status: EnrollmentStatus): boolean =>
  (SIBLING_STATUSES as readonly EnrollmentStatus[]).includes(status);

/** Statuses on an attendance sheet whatever the date: never the waitlist. */
const ATTENDING = ["active", "trial"] as const satisfies readonly EnrollmentStatus[];

/** Statuses that may appear on an attendance sheet, depending on the date for a drop-out. */
export const ATTENDANCE_CANDIDATES = [...ATTENDING, "dropped"] as const satisfies readonly EnrollmentStatus[];

/**
 * Whether a student appears on the attendance sheet of a lesson on `lessonDate`:
 * active or on trial; dropped, up to the day of the drop included, so the lessons
 * before keep their attendance. A drop-out without a date (written before #284)
 * appears on no sheet, as before.
 */
export function onAttendanceSheet(status: EnrollmentStatus, droppedOn: string | null, lessonDate: string): boolean {
  if ((ATTENDING as readonly EnrollmentStatus[]).includes(status)) return true;
  return status === "dropped" && droppedOn !== null && lessonDate <= droppedOn;
}

/** Statuses that may appear on a course's list of students. */
export const COURSE_LIST_CANDIDATES = [
  ...ATTENDANCE_CANDIDATES,
  "waitlist",
] as const satisfies readonly EnrollmentStatus[];

/**
 * Whether a student appears on a course's list today: as on today's attendance
 * sheet, plus the waitlist (shown apart, to call them when a place frees up).
 */
export const onCourseList = (status: EnrollmentStatus, droppedOn: string | null, today: string): boolean =>
  status === "waitlist" || onAttendanceSheet(status, droppedOn, today);

/** First and last day a drop-out may be dated: from the enrollment (or the season start, if later) to the season end. */
export const dropDateBounds = (enrolledOn: string, season: { startDate: string; endDate: string }) => ({
  min: enrolledOn > season.startDate ? enrolledOn : season.startDate,
  max: season.endDate,
});

/** Why a drop-out date is refused; null when accepted. */
export function dropDateRefusal(droppedOn: string, bounds: { min: string; max: string }): string | null {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(droppedOn)) return "Indiquez la date de l’abandon.";
  if (droppedOn > bounds.max) return "La date de l’abandon doit être comprise dans la saison de l’inscription.";
  if (droppedOn < bounds.min)
    return "La date de l’abandon ne peut pas précéder l’inscription ni le début de la saison.";
  return null;
}

/** A price as stored on an enrollment, in cents. */
export type SavedPrice = { grossPriceCents: number; discountCents: number };

/** Q4 (#284): the price saved when a trial or waitlist enrollment is confirmed. Default: the one recomputed now. */
export const confirmationPrice = (_atTrial: SavedPrice, recomputed: SavedPrice): SavedPrice => recomputed;

/** Which row of a student is shown on a sheet or a list: an attending one before the waitlist. */
const LIST_PRIORITY: readonly EnrollmentStatus[] = ["active", "trial", "dropped", "waitlist", "ended"];

/**
 * One row per student, in the order given, when a student has several enrollments in the
 * same course on a sheet or list (rows already filtered to who is shown that day): an
 * attending row is kept before the waitlist (`LIST_PRIORITY`).
 */
export function oneRowPerStudent<T extends { status: EnrollmentStatus }>(
  rows: readonly T[],
  studentOf: (row: T) => string,
): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const kept = best.get(studentOf(r));
    if (!kept || LIST_PRIORITY.indexOf(r.status) < LIST_PRIORITY.indexOf(kept.status)) best.set(studentOf(r), r);
  }
  const chosen = new Set(best.values());
  return rows.filter((r) => chosen.has(r));
}

/** A course as `fullCourseAdvice` reads it: its headcount (active enrollments), capacity and age band. */
export type CourseLoad = { enrolled: number; maxCapacity: number | null; ageMax: number | null };

/** A children's course: its age band ends before the age of majority (course data, never a name). */
export const isChildrenCourse = (c: { ageMax: number | null }): boolean =>
  c.ageMax !== null && c.ageMax < AGE_OF_MAJORITY;

/** Whether a children's course is full: its active enrollments reach its capacity. */
export const isFull = (c: CourseLoad): boolean =>
  isChildrenCourse(c) && c.maxCapacity !== null && c.enrolled >= c.maxCapacity;

/** What to tell the front desk about the courses chosen for a new enrollment. */
export type FullCourseAdvice = "none" | "suggest_waitlist";

/**
 * Q5 (#284): a full children's course is a warning that proposes the waitlist, never a
 * hard limit: saving as « Inscrit » stays possible. Adult courses are never full (the
 * school limits children's courses only). Nothing to suggest for a trial or a waitlist.
 */
export function fullCourseAdvice(status: InitialStatus, courses: readonly CourseLoad[]): FullCourseAdvice {
  return status === "active" && courses.some(isFull) ? "suggest_waitlist" : "none";
}
