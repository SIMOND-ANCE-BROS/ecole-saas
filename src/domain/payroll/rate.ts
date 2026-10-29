/** Instructor pay rates (#191), pure. Amounts in integer cents. */

export type PayMode = "hourly" | "per_lesson" | "monthly_flat";

export type RatedCourse = {
  instructorId: string;
  /** Specific rate for this course; null: their default rate. */
  instructorRateCents: number | null;
  /** Unit of that rate (#268): the pay mode it was typed in; null exactly when there is no rate. */
  instructorRatePayMode: PayMode | null;
};

export type RatedInstructor = { id: string; payMode: PayMode; rateCents: number };

/** A course may carry its own rate only for an instructor paid by the hour or by the lesson (monthly flat: #192). */
export const courseRateAllowed = (payMode: PayMode) => payMode !== "monthly_flat";

/**
 * Whether a course rate typed in `unit` is a rate of an instructor now paid
 * in `payMode` (#268): only in the same unit. A rate of an older pay mode,
 * kept in a past season (#192 Q5), is history: never read in the new unit.
 */
export const rateInCurrentUnit = (unit: PayMode | null, payMode: PayMode) =>
  unit === payMode && courseRateAllowed(payMode);

/**
 * Whether a course rate of this season blocks a change of the instructor's
 * pay mode (#192 Q5). Such a rate is in the unit of the old pay mode: the
 * current and future seasons (ending today or later, in Paris) count, past
 * seasons keep their rates untouched as history and no longer block.
 * Recommended rule, pending the school's validation.
 */
export const seasonBlocksPayModeChange = (seasonEndDate: string, today: string) => seasonEndDate >= today;

/**
 * Rate of the course's own instructor for this course: its specific rate when
 * set, else the instructor's default rate, in the unit of their pay mode
 * (per hour or per lesson).
 *
 * Returns null when there is no rate per course to give:
 * - for a monthly flat instructor, whose pay does not depend on courses;
 * - when the course's rate was typed in another unit than the instructor's
 *   current pay mode (#268): neither that rate nor the default one is assumed;
 * - for any other instructor than the course's (a replacement): which rate a
 *   replacement is paid is an open question (#192), not decided here.
 */
export function effectiveRate(course: RatedCourse, instructor: RatedInstructor): number | null {
  if (instructor.id !== course.instructorId || !courseRateAllowed(instructor.payMode)) return null;
  if (course.instructorRateCents === null) return instructor.rateCents;
  return rateInCurrentUnit(course.instructorRatePayMode, instructor.payMode) ? course.instructorRateCents : null;
}

/**
 * Unit of the rate a course keeps after a save (#268); the server decides it,
 * never trusting the form to know the instructor's current pay mode.
 * - no rate: none;
 * - the stored rate kept (not sent): its own unit;
 * - an amount sent in the unit the form showed (`shownUnit`):
 *   - the current pay mode: that one, even for the stored amount (converted
 *     on purpose);
 *   - an older pay mode: kept only for the stored amount in that same unit
 *     (an untouched rate sent back); any other amount was typed in a unit the
 *     instructor is no longer paid in (a stale form): refused (null);
 *   - not said: the current pay mode, except for the stored amount of the same
 *     instructor in another unit, which keeps its own.
 */
export function rateUnitAfterSave(save: {
  /** Rate kept by `rateAfterUpdate` (or the one typed for a new course). */
  cents: number | null;
  sent: number | null | undefined;
  shownUnit: PayMode | undefined;
  stored: { cents: number; payMode: PayMode } | null;
  sameInstructor: boolean;
  /** The instructor's current pay mode. */
  payMode: PayMode;
}): { unit: PayMode | null } | null {
  const { cents, sent, shownUnit, stored, sameInstructor, payMode } = save;
  if (cents === null) return { unit: null };
  if (sent === undefined) return { unit: sameInstructor && stored ? stored.payMode : payMode };
  const resent = sameInstructor && stored !== null && stored.cents === sent ? stored : null;
  if (shownUnit === payMode) return { unit: payMode };
  if (shownUnit === undefined) return { unit: resent ? resent.payMode : payMode };
  return resent && resent.payMode === shownUnit ? { unit: resent.payMode } : null;
}

/**
 * Rate the course keeps after an update (#191). A rate belongs to the
 * instructor it was typed for (`typedFor`):
 * - not sent (field not offered): the stored rate with the same instructor,
 *   none with a new one;
 * - sent for the course's new instructor: kept, even if it equals the old
 *   one's amount;
 * - sent for anybody else after a change of instructor (a stale form): dropped.
 */
export function rateAfterUpdate(change: {
  sent: number | null | undefined;
  typedFor: string | undefined;
  stored: number | null;
  oldInstructor: string;
  newInstructor: string;
}): number | null {
  const { sent, typedFor, stored, oldInstructor, newInstructor } = change;
  const sameInstructor = oldInstructor === newInstructor;
  if (sent === undefined) return sameInstructor ? stored : null;
  if (sameInstructor) return sent;
  return typedFor === newInstructor ? sent : null;
}
