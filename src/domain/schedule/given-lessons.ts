/**
 * Lessons already given keep what they were given with (#310): when a course
 * changes hands, time or length, its past lessons keep the main instructor,
 * time and length they had, so that a later statement pays them as given
 * (a substitute at the regular teacher's rate, an hourly teacher for the
 * length taught). Upcoming lessons follow the course. Pure.
 */

export type CourseSlotAndInstructor = { instructorId: string; startTime: string; durationMinutes: number };

/** `HH:MM`, whether the time came with seconds or not. */
const hhmm = (t: string) => t.slice(0, 5);

/** What the lessons already given must keep before the course takes `after`. */
export function givenLessonsKeep(
  before: CourseSlotAndInstructor,
  after: CourseSlotAndInstructor,
): { instructor: boolean; slot: boolean } {
  return {
    instructor: before.instructorId !== after.instructorId,
    slot: hhmm(before.startTime) !== hhmm(after.startTime) || before.durationMinutes !== after.durationMinutes,
  };
}
