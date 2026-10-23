import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { CalendarLesson } from "../domain/schedule/ical";
import type { Tx } from "./index";
import { effectiveDuration, effectiveTime } from "./lessons";
import { course, discipline, school, instructor, room, lesson, site } from "./schema";

/**
 * Abonnement d'un intervenant à ses séances (iCal). Le jeton n'est montré
 * qu'une fois, à sa création ; seule son empreinte est gardée. Toujours avec la
 * transaction d'`avecEcole()` : l'école vient de l'adresse d'abonnement, le
 * jeton en est le secret.
 */

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Crée (ou remplace) le jeton ; l'ancien lien cesse aussitôt de fonctionner. null si l'intervenant n'existe pas. */
export async function createCalendarToken(tx: Tx, instructorId: string): Promise<string | null> {
  if (!z.uuid().safeParse(instructorId).success) return null;
  const token = randomBytes(32).toString("base64url");
  const rows = await tx
    .update(instructor)
    .set({ calendarTokenHash: hash(token), calendarTokenCreatedAt: sql`now()` })
    .where(eq(instructor.id, instructorId))
    .returning({ id: instructor.id });
  return rows.length === 1 ? token : null;
}

export async function revokeCalendarToken(tx: Tx, instructorId: string): Promise<boolean> {
  if (!z.uuid().safeParse(instructorId).success) return false;
  const rows = await tx
    .update(instructor)
    .set({ calendarTokenHash: null, calendarTokenCreatedAt: null })
    .where(eq(instructor.id, instructorId))
    .returning({ id: instructor.id });
  return rows.length === 1;
}

/** Date de création du lien en cours, ou null s'il n'y en a pas. */
export async function calendarState(tx: Tx, instructorId: string): Promise<Date | null> {
  if (!z.uuid().safeParse(instructorId).success) return null;
  const [i] = await tx
    .select({ createdAt: instructor.calendarTokenCreatedAt })
    .from(instructor)
    .where(eq(instructor.id, instructorId));
  return i?.createdAt ?? null;
}

/** Intervenant actif au jeton donné (page personnelle de l'intervenant) ; null sinon. */
export async function tokenInstructor(
  tx: Tx,
  token: string,
): Promise<{ id: string; firstName: string; school: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [i] = await tx
    .select({ id: instructor.id, firstName: instructor.firstName, school: school.name })
    .from(instructor)
    .innerJoin(school, eq(school.id, instructor.schoolId))
    // Un intervenant parti (inactif) ne reçoit plus rien, même avec un ancien lien.
    .where(and(eq(instructor.calendarTokenHash, hash(token)), eq(instructor.active, true)));
  return i ?? null;
}

/**
 * Séances de l'intervenant au jeton donné, à partir de `depuis`, y compris ses
 * remplacements ; null si le jeton est inconnu ou révoqué. Aucune donnée
 * d'élève : titre du cours et lieu seulement.
 */
export async function readCalendar(
  tx: Tx,
  token: string,
  since: string,
): Promise<{ name: string; lessons: CalendarLesson[] } | null> {
  const i = await tokenInstructor(tx, token);
  if (!i) return null;

  const rows = await tx
    .select({
      id: lesson.id,
      date: lesson.date,
      status: lesson.status,
      startTime: effectiveTime,
      durationMinutes: effectiveDuration,
      discipline: discipline.name,
      level: course.level,
      room: room.name,
      site: site.name,
      address: site.address,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(room, eq(room.id, course.roomId))
    .innerJoin(site, eq(site.id, room.siteId))
    .where(and(eq(lesson.instructorId, i.id), gte(lesson.date, since)))
    .orderBy(asc(lesson.date), effectiveTime);

  return {
    name: `Cours de ${i.firstName}, ${i.school}`,
    lessons: rows.map((l) => ({
      id: l.id,
      date: l.date,
      startTime: l.startTime.slice(0, 5),
      durationMinutes: l.durationMinutes,
      title: l.level ? `${l.discipline} ${l.level}` : l.discipline,
      place: `${l.room}, ${l.site}, ${l.address}`,
      annulee: l.status === "annulee",
    })),
  };
}
