import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { courseDatesSql } from "./courses";
import type { Tx } from "./index";
import { alias } from "drizzle-orm/pg-core";
import { nomAffiche } from "./people";
import { course, discipline, enrollment, enrollmentCourse, instructor, person, season, room, site } from "./schema";

/** Lectures du planning, toujours avec la transaction d'`avecEcole()` (RLS). */

export type Season = { id: string; label: string; startDate: string; endDate: string };

/** Saison qui contient le jour (`YYYY-MM-DD`), sinon la plus récente ; null s'il n'y en a aucune. */
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
  /** 1 = lundi … 7 = dimanche ; null pour un stage. */
  weekday: number | null;
  /** `HH:MM` */
  startTime: string;
  durationMinutes: number;
  disciplineId: string;
  discipline: string;
  roomId: string;
  room: string;
  siteId: string;
  /** Récurrence (#90) ; `dates` : cours ponctuel, sans jour. */
  recurrence: "hebdomadaire" | "quinzaine" | "dates";
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
  /** Danseurs distincts inscrits (inscriptions actives). */
  enrolled: number;
};

/**
 * Effectif d'un cours, écrit avec les noms de tables : dans un `select`, Drizzle
 * n'écrit pas le nom de table devant `cours.id`, qui serait ambigu ici.
 */
const effective = sql<number>`(
  SELECT count(DISTINCT ic.student_id)::int
  FROM enrollment_course ic
  JOIN enrollment i ON i.id = ic.enrollment_id AND i.status = 'active'
  WHERE ic.course_id = ${course}.${sql.identifier("id")}
)`;

/** Cours d'une saison, par jour puis par heure. */
export function seasonCourses(tx: Tx, seasonId: string): Promise<ScheduleCourse[]> {
  return readScheduleCourse(tx, eq(course.seasonId, seasonId));
}

/** Un cours du planning, ou null s'il n'existe pas dans l'école courante. */
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
  /** Nom du payeur (raison sociale pour un professionnel). */
  payer: string;
  telephone: string | null;
  email: string | null;
  status: "active" | "essai" | "liste_attente";
  enrollmentDate: string;
};

/** Danseurs du cours en cours d'année (actifs, à l'essai, en liste d'attente), par nom puis prénom. */
export async function enrolledInCourse(tx: Tx, courseId: string): Promise<Enrolled[]> {
  if (!z.uuid().safeParse(courseId).success) return [];
  const student = alias(person, "danseur");
  const payer = alias(person, "payeur");
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
      // Téléphone du danseur, sinon celui de son payeur (un enfant n'en a souvent pas).
      telephone: sql<string | null>`coalesce(${student.phone}, ${payer.phone})`,
      email: sql<string | null>`coalesce(${student.email}, ${payer.email})`,
      status: sql<Enrolled["status"]>`${enrollment.status}`,
      enrollmentDate: enrollment.enrolledOn,
    })
    .from(enrollmentCourse)
    .innerJoin(enrollment, eq(enrollment.id, enrollmentCourse.enrollmentId))
    .innerJoin(student, eq(student.id, enrollmentCourse.studentId))
    .innerJoin(payer, eq(payer.id, enrollment.payerId))
    .where(
      and(eq(enrollmentCourse.courseId, courseId), inArray(enrollment.status, ["active", "essai", "liste_attente"])),
    )
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
