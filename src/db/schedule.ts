import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { courseDatesSql } from "./courses";
import type { Tx } from "./index";
import { alias } from "drizzle-orm/pg-core";
import { nomAffiche } from "./people";
import { course, discipline, enrollment, enrollmentCourse, instructor, person, season, room, site } from "./schema";

/** Schedule reads, always within the `withSchool()` transaction (RLS). */

export type Season = { id: string; label: string; startDate: string; endDate: string };

/** Season containing the day (`YYYY-MM-DD`), otherwise the most recent; null if there is none. */
export async function currentSeason(tx: Tx, day: string): Promise<Season | null> {
  const [s] = await tx
    .select({ id: season.id, label: season.label, startDate: season.startDate, endDate: season.endDate })
    .from(season)
    .orderBy(sql`(${season.startDate} <= ${day} AND ${season.endDate} >= ${day}) DESC`, desc(season.startDate))
    .limit(1);
  return s ?? null;
}

export type ScheduleCourse = {
  id: string;
  /** 1 = Monday … 7 = Sunday; null for a workshop. */
  weekday: number | null;
  /** `HH:MM` */
  startTime: string;
  durationMinutes: number;
  disciplineId: string;
  discipline: string;
  roomId: string;
  room: string;
  siteId: string;
  /** Recurrence (#90); `dates`: one-off course, without a day. */
  recurrence: "weekly" | "biweekly" | "dates";
  startDate: string | null;
  endDate: string | null;
  dates: string[];
  site: string;
  instructorId: string;
  /** « Prénom Nom » */
  instructor: string;
  ageMin: number | null;
  ageMax: number | null;
  level: string | null;
  maxCapacity: number | null;
  /** Distinct enrolled students (active enrollments). */
  enrolled: number;
};

/**
 * Headcount of a course, written with the table names: in a `select`, Drizzle
 * does not write the table name before `course.id`, which would be ambiguous here.
 */
const effective = sql<number>`(
  SELECT count(DISTINCT ic.student_id)::int
  FROM enrollment_course ic
  JOIN enrollment i ON i.id = ic.enrollment_id AND i.status = 'active'
  WHERE ic.course_id = ${course}.${sql.identifier("id")}
)`;

/** Courses of a season, by day then by time. */
export function seasonCourses(tx: Tx, seasonId: string): Promise<ScheduleCourse[]> {
  return readScheduleCourse(tx, eq(course.seasonId, seasonId));
}

/** A schedule course, or null if it does not exist in the current school. */
export async function scheduleCourse(tx: Tx, id: string): Promise<ScheduleCourse | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [c] = await readScheduleCourse(tx, eq(course.id, id));
  return c ?? null;
}

async function readScheduleCourse(tx: Tx, filter: SQL): Promise<ScheduleCourse[]> {
  const rows = await tx
    .select({
      id: course.id,
      weekday: course.weekday,
      startTime: course.startTime,
      durationMinutes: course.durationMinutes,
      disciplineId: course.disciplineId,
      discipline: discipline.name,
      roomId: course.roomId,
      room: room.name,
      siteId: site.id,
      site: site.name,
      recurrence: course.recurrence,
      startDate: course.startDate,
      endDate: course.endDate,
      dates: courseDatesSql,
      instructorId: course.instructorId,
      firstName: instructor.firstName,
      name: instructor.lastName,
      ageMin: course.ageMin,
      ageMax: course.ageMax,
      level: course.level,
      maxCapacity: course.maxCapacity,
      enrolled: effective,
    })
    .from(course)
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(room, eq(room.id, course.roomId))
    .innerJoin(site, eq(site.id, room.siteId))
    .innerJoin(instructor, eq(instructor.id, course.instructorId))
    .where(filter)
    .orderBy(sql`${course.weekday} NULLS LAST`, asc(course.startTime), asc(discipline.name));

  return rows.map(({ firstName: firstName, name: name, startTime: startTime, ...c }) => ({
    ...c,
    startTime: startTime.slice(0, 5),
    instructor: `${firstName} ${name}`,
  }));
}

export type Enrolled = {
  studentId: string;
  firstName: string;
  name: string;
  birthDate: string | null;
  payerId: string;
  /** Payer's name (company name for a professional). */
  payer: string;
  telephone: string | null;
  email: string | null;
  status: "active" | "trial" | "waitlist";
  enrollmentDate: string;
};

/** Students of the course during the year (active, on trial, on the waitlist), by last then first name. */
export async function enrolledInCourse(tx: Tx, courseId: string): Promise<Enrolled[]> {
  if (!z.uuid().safeParse(courseId).success) return [];
  const student = alias(person, "student");
  const payer = alias(person, "payer");
  const rows = await tx
    .selectDistinctOn([student.lastName, student.firstName, student.id], {
      studentId: student.id,
      firstName: student.firstName,
      name: student.lastName,
      birthDate: student.birthDate,
      payerId: payer.id,
      payerName: payer.lastName,
      payerFirstName: payer.firstName,
      companyName: payer.companyName,
      // Student's phone, otherwise their payer's (a child often has none).
      telephone: sql<string | null>`coalesce(${student.phone}, ${payer.phone})`,
      email: sql<string | null>`coalesce(${student.email}, ${payer.email})`,
      status: sql<Enrolled["status"]>`${enrollment.status}`,
      enrollmentDate: enrollment.enrolledOn,
    })
    .from(enrollmentCourse)
    .innerJoin(enrollment, eq(enrollment.id, enrollmentCourse.enrollmentId))
    .innerJoin(student, eq(student.id, enrollmentCourse.studentId))
    .innerJoin(payer, eq(payer.id, enrollment.payerId))
    .where(and(eq(enrollmentCourse.courseId, courseId), inArray(enrollment.status, ["active", "trial", "waitlist"])))
    .orderBy(asc(student.lastName), asc(student.firstName), asc(student.id), sql`${enrollment.status} = 'active' DESC`);
  return rows.map(
    ({
      payerName: payerName,
      payerFirstName: payerFirstName,
      companyName: companyName,
      firstName: firstName,
      ...l
    }) => ({
      ...l,
      firstName: firstName ?? "",
      payer: nomAffiche({ name: payerName, firstName: payerFirstName, companyName: companyName }),
    }),
  );
}
