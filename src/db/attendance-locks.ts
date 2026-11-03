import { asc, inArray, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { course } from "./schema";

/**
 * Lock order around attendance (#406): the one place it is written down, next to the payment
 * writes' (`payment-locks.ts`).
 *
 * Attendance of a student on a lesson only makes sense while an enrollment or a workshop sign-up
 * puts them on that lesson's sheet (`onAttendanceSheet`); statements count it (`attendanceCount`).
 * Three writes each check the other side, then write:
 *
 * - `saveAttendance` reads the sheet, then saves attendance for whoever is on it;
 * - `cancelEnrollment` refuses once attendance was taken that no other enrollment nor sign-up
 *   covers (`attendedSql`), then deletes the enrollment's courses;
 * - `cancelWorkshopSignup` refuses once attendance was taken that no enrollment covers, then
 *   deletes the sign-up.
 *
 * Each check reads rows another of them writes. Without a common lock, two of them could each
 * pass on what the other was removing, and attendance would outlive every row that put its
 * student on the sheet. Their common row is the course: the lesson's, the enrollment's, the
 * sign-up's. Each locks it `FOR NO KEY UPDATE` (`lockCourses`), then reads what it checks in a
 * statement of its own, which sees what the writer before committed:
 *
 *   - `saveAttendance`: the lesson's course (`lockCourseOfLesson`), then the sheet, then the
 *     attendance rows and the lesson;
 *   - `cancelEnrollment`: the payer and the enrollment (`readSaved`, see `payment-locks.ts`),
 *     then every course of the enrollment in one statement, ordered by id
 *     (`lockCoursesOfEnrollment`), then its unsent drafts (`discardDrafts`);
 *   - `cancelWorkshopSignup`: the workshop's course, then the sign-up `FOR UPDATE`;
 *   - `signUpForWorkshop` already locked the workshop's course first, the same way, before reading
 *     its sign-ups.
 *
 * Why no deadlock: once a course is held, none of them asks for a payer, an enrollment or a
 * sign-up lock it did not take before. The other writers of a course take it before its lessons
 * too: `updateCourse` and `setCourseRate` (`FOR UPDATE`, then its instructor and lessons);
 * `moveCourse`, `moveLesson` and `deleteCourse` (`FOR NO KEY UPDATE`, then the lessons they stamp
 * or delete, then the course row's update or delete). These three never take the course
 * `FOR UPDATE` first: another transaction's `syncLessons` inserting lessons takes `KEY SHARE` on
 * it. Every `update(course)` comes after such a lock (grep before adding one). Creating an
 * enrollment takes `FOR KEY SHARE` on its courses (`saveEnrollment`), so it never waits for an
 * attendance being saved. Attendance and an enrollment's courses take `KEY SHARE` on the
 * students through their foreign keys, which a payer lock in `FOR NO KEY UPDATE` lets through.
 *
 * Lesson packs (#411) follow the same order:
 *
 *   - `countLesson`: the pack (`FOR NO KEY UPDATE`), then the lesson's course `FOR NO KEY UPDATE`,
 *     then the lesson. Not `KEY SHARE` on the course: `FOR NO KEY UPDATE` lets it through, so the
 *     count would reach the lesson `deleteCourse` had just deleted and wait for it, while the
 *     course row's `DELETE` (`FOR UPDATE`) waited for the count's `KEY SHARE` (40P01). Holding
 *     the course the same way as the deletion, the count waits for it, then finds no lesson; or
 *     the deletion waits for the count, then sees its usage and refuses. No writer holding a
 *     course asks for a pack afterwards, so the pack before the course is safe;
 *   - `cancelLesson`: the lesson's course (`lockCourseOfLesson`), then it reads the attendance
 *     sheet, locks the lesson and reads its usages;
 *   - `uncountLesson` only deletes a usage: it locks neither the lesson nor its course. A refusal of
 *     `cancelLesson` or `entityLock` may then name a usage just undone: the user retries.
 *
 * Writes of a single lesson row that check nothing across the course (`restoreLesson`,
 * `changeInstructor`) lock only that row, and never wait on a course afterwards.
 *
 * Not covered here: a drop-out dated before lessons with attendance (#406, N3), which waits for a
 * business rule; `syncLessons`, which deletes lessons without locking their courses (#413).
 *
 * Always within `withSchool()` (RLS): a row of another school is neither seen nor locked.
 */

/** These courses, `FOR NO KEY UPDATE`, ordered by id, in one statement. */
export async function lockCourses(tx: Tx, courseIds: readonly string[]): Promise<void> {
  const ids = [...new Set(courseIds)];
  if (ids.length === 0) return;
  await tx
    .select({ id: course.id })
    .from(course)
    .where(inArray(course.id, ids))
    .orderBy(asc(course.id))
    .for("no key update");
}

/** The course of a lesson (`saveAttendance`). */
export async function lockCourseOfLesson(tx: Tx, lessonId: string): Promise<void> {
  await tx
    .select({ id: course.id })
    .from(course)
    .where(sql`${course.id} = (SELECT l.course_id FROM lesson l WHERE l.id = ${lessonId})`)
    .for("no key update");
}

/** Every course of an enrollment, ordered by id, in one statement (`cancelEnrollment`). */
export async function lockCoursesOfEnrollment(tx: Tx, enrollmentId: string): Promise<void> {
  await tx
    .select({ id: course.id })
    .from(course)
    .where(sql`${course.id} IN (SELECT c.course_id FROM enrollment_course c WHERE c.enrollment_id = ${enrollmentId})`)
    .orderBy(asc(course.id))
    .for("no key update");
}
