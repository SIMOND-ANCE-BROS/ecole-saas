import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { monthBounds } from "../domain/payroll/month";
import {
  attendanceTaken,
  type RateChange,
  type SchoolClosure,
  type StatementInstructor,
  type StatementLesson,
} from "../domain/payroll/statement";
import { DAY_NAMES } from "../domain/schedule/days";
import type { Tx } from "./index";
import { effectiveDuration } from "./lessons";
import { auditLog, closure, course, discipline, instructor, lesson } from "./schema";

/**
 * What instructor statements are computed from (#285), read live, always
 * within the `withSchool()` transaction (RLS): nothing is stored.
 */

/** Everything a month's statements need; `instructorId` narrows the instructors and lessons to one instructor. */
export type StatementData = {
  instructors: StatementInstructor[];
  lessons: StatementLesson[];
  /** The school's, since the first of the month: a substitute is paid at the regular teacher's rate. */
  rateChanges: RateChange[];
  closures: SchoolClosure[];
};

/** The course's own (regular) instructor, beside the one teaching the lesson. */
const regular = alias(instructor, "regular");

const lessonTime = sql<string>`to_char(coalesce(${lesson.startTime}, ${course.startTime}), 'HH24:MI')`;
const courseTime = sql<string>`to_char(${course.startTime}, 'HH24:MI')`;
const attendanceCount = (present?: true) => sql<number>`(
  SELECT count(*)::int FROM attendance a
  WHERE a.lesson_id = ${lesson}.${sql.identifier("id")}${present ? sql` AND a.present` : sql``})`;

/** « Jazz Débutant, lundi 18:00 »: the course's name and usual slot, to tell two courses apart. */
const courseLabel = (c: { discipline: string; level: string | null; weekday: number | null; time: string }) =>
  `${c.discipline}${c.level ? ` ${c.level}` : ""}${c.weekday ? `, ${DAY_NAMES[c.weekday]} ${c.time}` : ""}`;

/** The day in Paris of an audit entry, and entries since the first day of the month (Paris). */
const parisDay = sql<string>`(${auditLog.at} AT TIME ZONE 'Europe/Paris')::date::text`;
const since = (first: string) => sql`${auditLog.at} >= (${first}::date::timestamp AT TIME ZONE 'Europe/Paris')`;

export async function statementData(tx: Tx, month: string, instructorId?: string): Promise<StatementData> {
  const { first, last } = monthBounds(month);
  const one = instructorId !== undefined;
  const none: StatementData = { instructors: [], lessons: [], rateChanges: [], closures: [] };
  if (one && !z.uuid().safeParse(instructorId).success) return none;

  const instructors = await tx
    .select({
      id: instructor.id,
      firstName: instructor.firstName,
      lastName: instructor.lastName,
      payMode: instructor.payMode,
      rateCents: instructor.rateCents,
      isOwner: instructor.isOwner,
    })
    .from(instructor)
    .where(one ? eq(instructor.id, instructorId) : undefined)
    .orderBy(asc(instructor.lastName), asc(instructor.firstName));
  // Unknown here, or another school's (RLS).
  if (one && instructors.length === 0) return none;

  const lessonRows = await tx
    .select({
      id: lesson.id,
      date: lesson.date,
      startTime: lessonTime,
      durationMinutes: effectiveDuration,
      status: lesson.status,
      instructorId: lesson.instructorId,
      courseId: course.id,
      discipline: discipline.name,
      level: course.level,
      weekday: course.weekday,
      time: courseTime,
      courseInstructorId: course.instructorId,
      instructorRateCents: course.instructorRateCents,
      instructorRatePayMode: course.instructorRatePayMode,
      regularPayMode: regular.payMode,
      regularRateCents: regular.rateCents,
      marked: attendanceCount(),
      present: attendanceCount(true),
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(regular, eq(regular.id, course.instructorId))
    .where(
      and(gte(lesson.date, first), lte(lesson.date, last), one ? eq(lesson.instructorId, instructorId) : undefined),
    );

  // Changes of an instructor's pay mode or rate, and of a course's own rate (its instructor before and after).
  const instructorChanges = await tx
    .select({ instructorId: sql<string>`${auditLog.rowId}::text`, date: parisDay })
    .from(auditLog)
    .where(and(eq(auditLog.targetTable, "instructor"), since(first)));
  const courseInstructor = sql<string | null>`jsonb_array_elements_text(jsonb_build_array(
    ${auditLog.before}->>'instructorId', ${auditLog.after}->>'instructorId'))`;
  const courseChanges = await tx
    .select({ instructorId: courseInstructor, date: parisDay })
    .from(auditLog)
    .where(and(eq(auditLog.targetTable, "course"), since(first)));

  const closures = await tx
    .select({ startDate: closure.startDate, endDate: closure.endDate })
    .from(closure)
    .where(and(eq(closure.scope, "school"), lte(closure.startDate, last), gte(closure.endDate, first)));

  return {
    instructors: instructors.map((i) => ({
      id: i.id,
      name: `${i.firstName} ${i.lastName}`,
      payMode: i.payMode,
      rateCents: i.rateCents,
      isOwner: i.isOwner,
    })),
    lessons: lessonRows.map((l) => ({
      id: l.id,
      date: l.date,
      startTime: l.startTime,
      durationMinutes: l.durationMinutes,
      status: l.status,
      instructorId: l.instructorId,
      courseId: l.courseId,
      courseLabel: courseLabel(l),
      course: {
        instructorId: l.courseInstructorId,
        instructorRateCents: l.instructorRateCents,
        instructorRatePayMode: l.instructorRatePayMode,
      },
      regular: { id: l.courseInstructorId, payMode: l.regularPayMode, rateCents: l.regularRateCents },
      attendance: { taken: attendanceTaken(l.status, l.marked), present: l.present },
    })),
    // Once per instructor and day: a course entry names the same instructor before and after.
    rateChanges: [
      ...new Map(
        [...instructorChanges, ...courseChanges]
          .filter((c): c is RateChange => c.instructorId !== null)
          .map((c) => [`${c.instructorId} ${c.date}`, c]),
      ).values(),
    ],
    closures,
  };
}
