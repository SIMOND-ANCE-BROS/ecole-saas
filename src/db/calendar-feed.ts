import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { CalendarLesson } from "../domain/schedule/ical";
import type { Tx } from "./index";
import { effectiveDuration, effectiveTime } from "./lessons";
import { course, discipline, school, instructor, room, lesson, site } from "./schema";

/**
 * An instructor's subscription to their lessons (iCal). The token is shown
 * only once, when created; only its hash is kept. Always within the
 * `withSchool()` transaction: the school comes from the subscription URL, the
 * token is its secret.
 */

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates (or replaces) the token; the old link stops working immediately. null if the instructor does not exist. */
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

/** Creation date of the current link, or null if there is none. */
export async function calendarState(tx: Tx, instructorId: string): Promise<Date | null> {
  if (!z.uuid().safeParse(instructorId).success) return null;
  const [i] = await tx
    .select({ createdAt: instructor.calendarTokenCreatedAt })
    .from(instructor)
    .where(eq(instructor.id, instructorId));
  return i?.createdAt ?? null;
}

/** Active instructor for the given token (instructor's personal page); null otherwise. */
export async function tokenInstructor(
  tx: Tx,
  token: string,
): Promise<{ id: string; firstName: string; school: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [i] = await tx
    .select({ id: instructor.id, firstName: instructor.firstName, school: school.name })
    .from(instructor)
    .innerJoin(school, eq(school.id, instructor.schoolId))
    // An instructor who has left (inactive) receives nothing any more, even with an old link.
    .where(and(eq(instructor.calendarTokenHash, hash(token)), eq(instructor.active, true)));
  return i ?? null;
}

/**
 * Lessons of the instructor for the given token, from `since` on, including their
 * replacements; null if the token is unknown or revoked. No student
 * data: course title and place only.
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
      cancelled: l.status === "cancelled",
    })),
  };
}
