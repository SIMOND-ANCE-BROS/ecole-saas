import { STATUS_PRIORITY, type EnrollmentStatus } from "./statuses";

/**
 * Lifecycle of an enrollment (#284): which status changes are allowed, which
 * actions the front desk is offered, and who appears on attendance sheets and
 * course lists. Pure functions, no database.
 *
 * The rules still to be confirmed by the school (#284, « Open questions ») each
 * live in one place, with their recommended default:
 * 1. What is owed for a dropped or trial enrollment: `DUE_STATUSES` (`src/domain/payments/balance.ts`, #99).
 * 2. A status change never re-prices another saved enrollment: `discountImpacts` (`./impacts.ts`) only reports it.
 * 3. Only active enrollments count as siblings: `SIBLING_STATUSES` below.
 * 4. The price is recomputed at confirmation: `confirmationPrice` below.
 * 5. A full course is a warning, not a hard limit (enrollment form, to come with the status at creation).
 * 6. A trial never expires on its own: no automatic change exists; confirm or drop by hand.
 */

/** Allowed changes of status. Dropped and ended are final; cancelling a mistake is not a change of status. */
const TRANSITIONS: Record<EnrollmentStatus, readonly EnrollmentStatus[]> = {
  trial: ["active", "dropped"],
  waitlist: ["active", "dropped"],
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
  return "Ce changement de statut n’est pas possible.";
}

/** What the front desk can do with a saved enrollment. */
export type EnrollmentActions = { confirm: boolean; drop: boolean; cancel: boolean };

/**
 * Actions offered on a saved enrollment. Cancelling (a mistake) removes it, so
 * it is never offered once an invoice line refers to it: a credit note is then
 * the only way back (CLAUDE.md §5).
 */
export function enrollmentActions(status: EnrollmentStatus, invoiced: boolean): EnrollmentActions {
  return { confirm: canChange(status, "active"), drop: canChange(status, "dropped"), cancel: !invoiced };
}

/** Q3 (#284): statuses counted as siblings by the tariff engine, for the payer's other enrollments. */
export const SIBLING_STATUSES = ["active"] as const satisfies readonly EnrollmentStatus[];

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

/** Why a drop-out date is refused (it must fall within the enrollment's season); null when accepted. */
export function dropDateRefusal(droppedOn: string, season: { startDate: string; endDate: string }): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(droppedOn)) return "Indiquez la date de l’abandon.";
  if (droppedOn < season.startDate || droppedOn > season.endDate)
    return "La date de l’abandon doit être comprise dans la saison de l’inscription.";
  return null;
}

/** A price as stored on an enrollment, in cents. */
export type SavedPrice = { grossPriceCents: number; discountCents: number };

/** Q4 (#284): the price saved when a trial or waitlist enrollment is confirmed. Default: the one recomputed now. */
export const confirmationPrice = (_atTrial: SavedPrice, recomputed: SavedPrice): SavedPrice => recomputed;

/**
 * One row per student, in the order given, when a student has several enrollments in the
 * same course: the most favourable status is kept (`STATUS_PRIORITY`: active before trial…).
 */
export function oneRowPerStudent<T extends { status: EnrollmentStatus }>(
  rows: readonly T[],
  studentOf: (row: T) => string,
): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const kept = best.get(studentOf(r));
    if (!kept || STATUS_PRIORITY.indexOf(r.status) < STATUS_PRIORITY.indexOf(kept.status)) best.set(studentOf(r), r);
  }
  const chosen = new Set(best.values());
  return rows.filter((r) => chosen.has(r));
}
