import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { course, season } from "./schema";

/**
 * Lock order of the schedule (#406, #411, #413, #415): the one place it is written down, next to
 * the payment writes' (`payment-locks.ts`).
 *
 * One order for every transaction that touches a season's courses and lessons:
 *
 *   1. the season, `FOR NO KEY UPDATE` (`lockSeason`, `lockSeasonOfCourse`, `lockSeasonOfLesson`;
 *      `FOR UPDATE` when its own row changes: `updateSeason`, `copySeason`, quarters, rules);
 *   2. the courses, ordered by id, in one statement (`lockCourses`, `lockCoursesOfSeason`,
 *      `lockCoursesOfEnrollment`), or the single course of the write (`lockCourse`,
 *      `lockCourseOfLesson`); `FOR NO KEY UPDATE`, `FOR UPDATE` only in `updateCourse` and
 *      `setCourseRate`;
 *   3. the lessons, then attendance and lesson-pack usages; the course row's own update or delete
 *      comes last, under the lock of step 2.
 *
 * A transaction may start at a later step (attendance locks no season), never go back: once it
 * holds a course, it never asks for a season. Only a transaction holding the season may lock
 * further courses in a later statement (a course edit's sync locks the season's courses after
 * its own): every transaction locking more than one course therefore holds the season first, so
 * two of them never hold courses at once. `syncLessons` locks the season, then every course of
 * it; so every transaction that ends in a sync, locks several courses, or deletes a course a
 * closure may name, locks the season before its first course:
 *
 *   - the course form: `lockCourse` (the course's season, then the course `FOR UPDATE`), or
 *     `lockSeason` for a new course, then `updateCourse` or `createCourse`, then the sync;
 *   - `moveCourse` and `deleteCourse` (the course's season, then the course), `moveLesson` (the
 *     lesson's season, then its course); then the sync after a move;
 *   - a closure: `addClosure` locks its season `FOR NO KEY UPDATE` before inserting its courses
 *     (`closure_course`, whose foreign key takes `KEY SHARE` on them), `deleteClosure` locks the
 *     closure's season before deleting it (`lockSeasonOfClosure`); then the sync;
 *   - `cancelEnrollment`: its payer and the enrollment (`payment-locks.ts`), then its season, then
 *     its courses by id (`lockCoursesOfEnrollment`). Without the season it could hold a course of
 *     a lower id that a course edit's sync then asks for, while waiting for the edited course;
 *   - `updateSeason`, `copySeason`: the season `FOR UPDATE`, then the courses they create, then
 *     the sync.
 *
 * Before #415 the course form, `moveCourse` and `moveLesson` held their course, then waited for
 * the season, while a closure's sync held the season and waited for that course (40P01). So did
 * `deleteCourse` against a closure of that course being added (its `KEY SHARE` on the course held
 * the course row's `DELETE`), and the sync's further statement for a course a lesson restored
 * meanwhile added, against `cancelEnrollment` locking the same courses by id.
 *
 * Writers of a single course that never sync nor ask for a season afterwards may skip step 1:
 * attendance, counts, `cancelLesson`, workshop sign-ups and `setCourseRate` (the course
 * `FOR UPDATE`, then its instructor `FOR SHARE`). A sync or a course edit holding the season waits
 * for them, and they wait for nothing it holds.
 *
 * `changeRoom` updates its room row before the seasons it syncs (`syncRoomSeasons`, by season id):
 * course writers take only `KEY SHARE` on a room (foreign keys), which that update lets through.
 * It is the one transaction syncing several seasons, so it locks a season after another season's
 * courses: safe, as it takes the seasons by id and every other writer stays within one season.
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
 * Why no deadlock: once a course is held, none of them asks for a season, a payer, an enrollment
 * or a sign-up lock it did not take before. The other writers of a course take it before its
 * lessons too: `updateCourse` and `setCourseRate` (`FOR UPDATE`, then its instructor and lessons);
 * `moveCourse`, `moveLesson` and `deleteCourse` (`FOR NO KEY UPDATE`, then the lessons they stamp
 * or delete, then the course row's update or delete). These three never take the course
 * `FOR UPDATE`: an enrollment being saved takes `KEY SHARE` on it. Every `update(course)` comes
 * after such a lock (grep before adding one). Creating an enrollment takes `FOR KEY SHARE` on its
 * courses (`saveEnrollment`), then on its season (quarters): the one going back to step 1, safe
 * because `KEY SHARE` waits only for a `FOR UPDATE` (a course or season edit), whose holder never
 * asks for a lock that `KEY SHARE` blocks; `FOR NO KEY UPDATE` lets it through, so it never waits
 * for an attendance being saved nor for a sync. Attendance and an enrollment's courses take
 * `KEY SHARE` on the students through their foreign keys, which a payer lock in
 * `FOR NO KEY UPDATE` lets through.
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
 * Regenerating lessons (#413, #415): `syncLessons` locks its season, then every course of the
 * season in one statement, ordered by id (`lockCoursesOfSeason`), then reads the courses, the
 * lessons and what they carry. A count, an attendance or a cancellation in progress holds its
 * course and commits first: a lesson counted or with attendance is then kept, as one committed
 * before (#225), instead of the delete failing on the usage's or the attendance's foreign key
 * (23503). One that starts later waits for the sync, then finds the lesson gone. A course deleted
 * before the sync got its lock is not read at all: none of its lessons is created again. Writers
 * of attendance, counts and cancellations never ask for a season, so they never deadlock with a
 * sync.
 *
 * Writes of a single lesson row that check nothing across the course (`restoreLesson`,
 * `changeInstructor`) lock only that row, and never wait on a course afterwards. The sync reads
 * the lessons once, after all its locks: a lesson restored before that read is planned restored,
 * one restored after it is planned on what was read, as before #415.
 *
 * Not covered here: a drop-out dated before lessons with attendance (#406, N3), which waits for a
 * business rule.
 *
 * Always within `withSchool()` (RLS): a row of another school is neither seen nor locked.
 */

/** A season, `FOR NO KEY UPDATE`: step 1, before any course of it. */
export async function lockSeason(tx: Tx, seasonId: string): Promise<void> {
  await tx.select({ id: season.id }).from(season).where(eq(season.id, seasonId)).for("no key update");
}

/** The season of a course, `FOR NO KEY UPDATE`, before the course itself (a course never changes season). */
export async function lockSeasonOfCourse(tx: Tx, courseId: string): Promise<void> {
  await tx
    .select({ id: season.id })
    .from(season)
    .where(sql`${season.id} = (SELECT c.season_id FROM course c WHERE c.id = ${courseId})`)
    .for("no key update");
}

/** The season of a lesson's course, `FOR NO KEY UPDATE`, before that course. */
export async function lockSeasonOfLesson(tx: Tx, lessonId: string): Promise<void> {
  await tx
    .select({ id: season.id })
    .from(season)
    .where(
      sql`${season.id} = (SELECT c.season_id FROM lesson l JOIN course c ON c.id = l.course_id WHERE l.id = ${lessonId})`,
    )
    .for("no key update");
}

/** The season of a closure, `FOR NO KEY UPDATE`, before deleting it (`deleteClosure`). */
export async function lockSeasonOfClosure(tx: Tx, closureId: string): Promise<void> {
  await tx
    .select({ id: season.id })
    .from(season)
    .where(sql`${season.id} = (SELECT f.season_id FROM closure f WHERE f.id = ${closureId})`)
    .for("no key update");
}

/** Every course of a season, `FOR NO KEY UPDATE`, ordered by id, in one statement (`syncLessons`). */
export async function lockCoursesOfSeason(tx: Tx, seasonId: string): Promise<void> {
  await tx
    .select({ id: course.id })
    .from(course)
    .where(eq(course.seasonId, seasonId))
    .orderBy(asc(course.id))
    .for("no key update");
}

/** These courses, `FOR NO KEY UPDATE`, ordered by id, in one statement; returns those that still exist. */
export async function lockCourses(tx: Tx, courseIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(courseIds)];
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: course.id })
    .from(course)
    .where(inArray(course.id, ids))
    .orderBy(asc(course.id))
    .for("no key update");
  return rows.map((r) => r.id);
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
