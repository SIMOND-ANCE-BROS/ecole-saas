import { and, asc, desc, eq, gte, inArray, lte, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { COURSE_LIST_CANDIDATES, onCourseList, oneRowPerStudent } from "../domain/enrollment/lifecycle";
import { courseDatesSql } from "./courses";
import type { Tx } from "./index";
import { alias } from "drizzle-orm/pg-core";
import { displayedName } from "./people";
import {
  billingEntity,
  course,
  discipline,
  enrollment,
  enrollmentCourse,
  instructor,
  person,
  season,
  room,
  site,
} from "./schema";

/** Schedule reads, always within the `withSchool()` transaction (RLS). */

export type Season = { id: string; label: string; startDate: string; endDate: string };

const seasonColumns = { id: season.id, label: season.label, startDate: season.startDate, endDate: season.endDate };

/** Season containing the day (`YYYY-MM-DD`), otherwise the most recent; null if there is none. */
export async function currentSeason(tx: Tx, day: string): Promise<Season | null> {
  const [s] = await tx
    .select(seasonColumns)
    .from(season)
    .orderBy(sql`(${season.startDate} <= ${day} AND ${season.endDate} >= ${day}) DESC`, desc(season.startDate))
    .limit(1);
  return s ?? null;
}

/** Seasons of the school, the most recent first. */
export function schoolSeasons(tx: Tx): Promise<Season[]> {
  return tx.select(seasonColumns).from(season).orderBy(desc(season.startDate));
}

/** The school's season with this id (RLS); null for an unknown or malformed id. */
export async function seasonById(tx: Tx, asked: unknown): Promise<Season | null> {
  const id = z.uuid().safeParse(asked);
  if (!id.success) return null;
  const [s] = await tx.select(seasonColumns).from(season).where(eq(season.id, id.data));
  return s ?? null;
}

/**
 * The season asked for in the URL (`?saison=`) when it is one of the school's
 * (RLS), otherwise the current one (`currentSeason`).
 */
export async function chosenSeason(tx: Tx, asked: unknown, day: string): Promise<Season | null> {
  return (await seasonById(tx, asked)) ?? currentSeason(tx, day);
}

/**
 * Seasons of a person's record (#362): the one shown (`?saison=` when it is one of the
 * school's, otherwise the current one), the current one, and all of them for the picker.
 * Null without any season.
 */
export async function recordSeasons(
  tx: Tx,
  asked: unknown,
  day: string,
): Promise<{ shown: Season; current: Season; seasons: Season[] } | null> {
  const current = await currentSeason(tx, day);
  if (!current) return null;
  return {
    shown: (await seasonById(tx, asked)) ?? current,
    current,
    seasons: await schoolSeasons(tx),
  };
}

/** Season of a course; null for an unknown course. */
export async function seasonOfCourse(tx: Tx, courseId: string): Promise<Season | null> {
  const [s] = await tx
    .select(seasonColumns)
    .from(course)
    .innerJoin(season, eq(season.id, course.seasonId))
    .where(eq(course.id, courseId));
  return s ?? null;
}

/** First season overlapping the days `start`–`end` (`YYYY-MM-DD`, a week); null if none does. */
export async function seasonOverlapping(tx: Tx, start: string, end: string): Promise<Season | null> {
  const [s] = await tx
    .select(seasonColumns)
    .from(season)
    .where(and(lte(season.startDate, end), gte(season.endDate, start)))
    .orderBy(asc(season.startDate))
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
  /** Group, private, competition or workshop: only group courses are ticked by an audience (#295). */
  type: "group" | "private" | "competition" | "workshop";
  ageMin: number | null;
  ageMax: number | null;
  level: string | null;
  maxCapacity: number | null;
  /** Distinct enrolled students (active enrollments). */
  enrolled: number;
  /** Business that sells it (#299) and its short name. */
  billingEntityId: string;
  entity: string;
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
      type: course.type,
      ageMin: course.ageMin,
      ageMax: course.ageMax,
      level: course.level,
      maxCapacity: course.maxCapacity,
      enrolled: effective,
      billingEntityId: course.billingEntityId,
      entity: billingEntity.name,
    })
    .from(course)
    .innerJoin(billingEntity, eq(billingEntity.id, course.billingEntityId))
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
  status: (typeof COURSE_LIST_CANDIDATES)[number];
  /** Day of the drop-out, still to come (#284). */
  droppedOn: string | null;
  enrollmentDate: string;
};

/**
 * Students of the course today (active, on trial, on the waitlist, or dropping out later:
 * `onCourseList`), by last then first name.
 */
export async function enrolledInCourse(tx: Tx, courseId: string, today: string): Promise<Enrolled[]> {
  if (!z.uuid().safeParse(courseId).success) return [];
  const student = alias(person, "student");
  const payer = alias(person, "payer");
  const all = await tx
    .select({
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
      droppedOn: enrollment.droppedOn,
      enrollmentDate: enrollment.enrolledOn,
    })
    .from(enrollmentCourse)
    .innerJoin(enrollment, eq(enrollment.id, enrollmentCourse.enrollmentId))
    .innerJoin(student, eq(student.id, enrollmentCourse.studentId))
    .innerJoin(payer, eq(payer.id, enrollment.payerId))
    .where(and(eq(enrollmentCourse.courseId, courseId), inArray(enrollment.status, [...COURSE_LIST_CANDIDATES])))
    .orderBy(asc(student.lastName), asc(student.firstName), asc(student.id));
  const rows = oneRowPerStudent(
    all.filter((r) => onCourseList(r.status, r.droppedOn, today)),
    (r) => r.studentId,
  );
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
      payer: displayedName({ name: payerName, firstName: payerFirstName, companyName: companyName }),
    }),
  );
}
