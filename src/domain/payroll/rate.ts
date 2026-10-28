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
 * set, else the instructor's default rate, in the unit of their pay mode.
 *
 * Returns null for any other instructor (a replacement): which rate a
 * replacement is paid is an open question (#192), not decided here.
 */
export function effectiveRate(course: RatedCourse, instructor: RatedInstructor): number | null {
  if (instructor.id !== course.instructorId) return null;
  if (course.instructorRateCents !== null && courseRateAllowed(instructor.payMode)) return course.instructorRateCents;
  return instructor.rateCents;
}
