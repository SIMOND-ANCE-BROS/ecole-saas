/** Instructor pay rates (#191), pure. Amounts in integer cents. */

export type PayMode = "hourly" | "per_lesson" | "monthly_flat";

export type RatedCourse = {
  instructorId: string;
  /** Specific rate for this course, in the unit of the instructor's pay mode; null: their default rate. */
  instructorRateCents: number | null;
};

export type RatedInstructor = { id: string; payMode: PayMode; rateCents: number };

/** A course may carry its own rate only for an instructor paid by the hour or by the lesson (monthly flat: #192). */
export const courseRateAllowed = (payMode: PayMode) => payMode !== "monthly_flat";

/**
 * Rate of the course's own instructor for this course: its specific rate when
 * set, else the instructor's default rate, in the unit of their pay mode
 * (per hour or per lesson).
 *
 * Returns null when there is no rate per course to give:
 * - for a monthly flat instructor, whose pay does not depend on courses;
 * - for any other instructor than the course's (a replacement): which rate a
 *   replacement is paid is an open question (#192), not decided here.
 */
export function effectiveRate(course: RatedCourse, instructor: RatedInstructor): number | null {
  if (instructor.id !== course.instructorId || !courseRateAllowed(instructor.payMode)) return null;
  return course.instructorRateCents ?? instructor.rateCents;
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
