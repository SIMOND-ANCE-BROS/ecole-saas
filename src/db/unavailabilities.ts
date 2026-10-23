import { and, asc, eq, gt, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { conflicts, type Unavailability, lessonInterval, freeSubstitutes } from "../domain/schedule/availability";
import { lessonDates } from "../domain/schedule/lessons";
import type { Tx } from "./index";
import { effectiveDuration, effectiveTime } from "./lessons";
import { course, discipline, closure, unavailability, instructor, season, lesson } from "./schema";

/**
 * Indisponibilités des intervenants, conflits avec les séances et remplaçants
 * libres. Toujours avec la transaction d'`withSchool()` (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;
export type Result = { ok: true; id: string } | { ok: false; message: string };

export type UnavailabilityItem = {
  id: string;
  start: Date;
  end: Date;
  source: "saisie" | "google" | "microsoft";
  label: string | null;
};

/** Indisponibilités d'un intervenant qui ne sont pas terminées à `depuis`, par début. */
export function listUnavailabilities(tx: Tx, instructorId: string, since: Date): Promise<UnavailabilityItem[]> {
  if (!isUuid(instructorId)) return Promise.resolve([]);
  return tx
    .select({
      id: unavailability.id,
      start: unavailability.startsAt,
      end: unavailability.endsAt,
      source: unavailability.source,
      label: unavailability.label,
    })
    .from(unavailability)
    .where(and(eq(unavailability.instructorId, instructorId), gt(unavailability.endsAt, since)))
    .orderBy(asc(unavailability.startsAt));
}

/** Indisponibilité saisie par la direction. */
export async function addUnavailability(
  tx: Tx,
  instructorId: string,
  saisie: { start: Date; end: Date; label: string | null },
): Promise<Result> {
  if (!isUuid(instructorId)) return { ok: false, message: "Intervenant introuvable." };
  if (!(saisie.end > saisie.start)) return { ok: false, message: "La fin doit suivre le début." };
  const [i] = await tx.select({ id: instructor.id }).from(instructor).where(eq(instructor.id, instructorId));
  if (!i) return { ok: false, message: "Intervenant introuvable." };
  const [{ id }] = await tx
    .insert(unavailability)
    .values({
      startsAt: saisie.start,
      endsAt: saisie.end,
      label: saisie.label?.trim() || null,
      instructorId: instructorId,
      source: "saisie",
      schoolId: CURRENT_SCHOOL,
    })
    .returning({ id: unavailability.id });
  return { ok: true, id };
}

/** Retire une indisponibilité saisie ; celles d'un agenda reviennent à la synchronisation suivante. */
export async function deleteUnavailability(tx: Tx, id: string): Promise<Result> {
  const refusal = { ok: false as const, message: "Cette indisponibilité n’existe plus ou vient d’un agenda." };
  if (!isUuid(id)) return refusal;
  const rows = await tx
    .delete(unavailability)
    .where(and(eq(unavailability.id, id), eq(unavailability.source, "saisie")))
    .returning({ id: unavailability.id });
  return rows.length === 1 ? { ok: true, id } : refusal;
}

/**
 * Remplace les plages lues dans l'agenda d'un intervenant sur une fenêtre de
 * temps (synchronisation) ; les indisponibilités saisies ne sont pas touchées.
 */
export async function replaceCalendarUnavailabilities(
  tx: Tx,
  instructorId: string,
  source: "google" | "microsoft",
  window: { start: Date; end: Date },
  ranges: { start: Date; end: Date }[],
): Promise<number> {
  await tx
    .delete(unavailability)
    .where(
      and(
        eq(unavailability.instructorId, instructorId),
        ne(unavailability.source, "saisie"),
        lt(unavailability.startsAt, window.end),
        gt(unavailability.endsAt, window.start),
      ),
    );
  const valid = ranges.filter((p) => p.end > p.start);
  if (valid.length > 0) {
    await tx.insert(unavailability).values(
      valid.map((p) => ({
        startsAt: p.start,
        endsAt: p.end,
        instructorId: instructorId,
        source: source,
        schoolId: CURRENT_SCHOOL,
      })),
    );
  }
  return valid.length;
}

/** Indisponibilités (de tous ou de certains intervenants) qui touchent une période. */
async function unavailabilitiesBetween(
  tx: Tx,
  start: Date,
  end: Date,
  instructorIds?: string[],
): Promise<Unavailability[]> {
  if (instructorIds && instructorIds.length === 0) return [];
  return tx
    .select({ instructorId: unavailability.instructorId, start: unavailability.startsAt, end: unavailability.endsAt })
    .from(unavailability)
    .where(
      and(
        lt(unavailability.startsAt, end),
        gt(unavailability.endsAt, start),
        instructorIds ? inArray(unavailability.instructorId, instructorIds) : undefined,
      ),
    );
}

const DAY = 86_400_000;
/** Période large (un jour de marge de chaque côté) couvrant des dates `YYYY-MM-DD` triées. */
const period = (dates: string[]) => ({
  start: new Date(Date.parse(dates[0]) - DAY),
  end: new Date(Date.parse(dates[dates.length - 1]) + 2 * DAY),
});

/**
 * Dates à venir où un créneau hebdomadaire tomberait pendant une
 * indisponibilité de l'intervenant (formulaire de cours, avant enregistrement).
 */
export async function slotConflicts(
  tx: Tx,
  saisie: { seasonId: string; instructorId: string; weekday: number; startTime: string; durationMinutes: number },
  today: string,
): Promise<string[]> {
  if (!isUuid(saisie.seasonId) || !isUuid(saisie.instructorId)) return [];
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(saisie.startTime) || !(saisie.durationMinutes > 0)) return [];
  if (!Number.isInteger(saisie.weekday) || saisie.weekday < 1 || saisie.weekday > 7) return [];
  const [s] = await tx
    .select({ start: season.startDate, end: season.endDate })
    .from(season)
    .where(eq(season.id, saisie.seasonId));
  if (!s) return [];
  const closures = await tx
    .select({ start: closure.startDate, end: closure.endDate })
    .from(closure)
    .where(eq(closure.seasonId, saisie.seasonId));
  const dates = lessonDates({
    start: s.start > today ? s.start : today,
    end: s.end,
    weekday: saisie.weekday,
    closures,
  });
  if (dates.length === 0) return [];
  const { start: start, end: end } = period(dates);
  const unavailabilities = await unavailabilitiesBetween(tx, start, end, [saisie.instructorId]);
  const lessons = dates.map((date) => ({
    id: date,
    date,
    startTime: saisie.startTime,
    durationMinutes: saisie.durationMinutes,
    instructorId: saisie.instructorId,
  }));
  return conflicts(lessons, unavailabilities).map((c) => c.lessonId);
}

/** Séances prévues d'un cours, à partir d'aujourd'hui, dont l'intervenant est indisponible. */
export async function conflictingLessons(tx: Tx, courseId: string, today: string): Promise<Set<string>> {
  if (!isUuid(courseId)) return new Set();
  const rows = await tx
    .select({
      id: lesson.id,
      date: lesson.date,
      startTime: effectiveTime,
      durationMinutes: effectiveDuration,
      instructorId: lesson.instructorId,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .where(and(eq(lesson.courseId, courseId), gte(lesson.date, today), eq(lesson.status, "prevue")))
    .orderBy(asc(lesson.date));
  if (rows.length === 0) return new Set();
  const lessons = rows.map((l) => ({ ...l, startTime: l.startTime.slice(0, 5) }));
  const { start: start, end: end } = period(lessons.map((s) => s.date));
  const unavailabilities = await unavailabilitiesBetween(tx, start, end, [
    ...new Set(lessons.map((s) => s.instructorId)),
  ]);
  return new Set(conflicts(lessons, unavailabilities).map((c) => c.lessonId));
}

export type Substitute = {
  id: string;
  name: string;
  free: boolean;
  pattern: "indisponible" | "autre séance" | null;
  taught: boolean;
};

/**
 * Pour une séance : son intervenant est-il indisponible, et quels intervenants
 * actifs pourraient la reprendre (libres d'abord, la discipline en tête).
 */
export async function lessonAvailabilities(
  tx: Tx,
  lessonId: string,
): Promise<{ unavailable: boolean; substitutes: Substitute[] } | null> {
  if (!isUuid(lessonId)) return null;
  const [s] = await tx
    .select({
      id: lesson.id,
      date: lesson.date,
      startTime: effectiveTime,
      durationMinutes: effectiveDuration,
      instructorId: lesson.instructorId,
      discipline: discipline.name,
      seasonId: course.seasonId,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .where(eq(lesson.id, lessonId));
  if (!s) return null;
  const target = { ...s, startTime: s.startTime.slice(0, 5) };
  const [start, end] = lessonInterval(target);

  const active = await tx
    .select({
      id: instructor.id,
      firstName: instructor.firstName,
      name: instructor.lastName,
      disciplines: sql<string[]>`coalesce((
        SELECT array_agg(DISTINCT d.name) FROM course c JOIN discipline d ON d.id = c.discipline_id
        WHERE c.instructor_id = ${instructor}.${sql.identifier("id")} AND c.season_id = ${s.seasonId}
      ), '{}')`,
    })
    .from(instructor)
    .where(eq(instructor.active, true))
    .orderBy(asc(instructor.firstName), asc(instructor.lastName));

  const sameDay = await tx
    .select({
      id: lesson.id,
      date: lesson.date,
      startTime: effectiveTime,
      durationMinutes: effectiveDuration,
      instructorId: lesson.instructorId,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .where(and(eq(lesson.date, s.date), ne(lesson.status, "annulee")));
  const unavailabilities = await unavailabilitiesBetween(tx, new Date(start), new Date(end));

  const names = new Map(active.map((a) => [a.id, `${a.firstName} ${a.name}`]));
  const classes = freeSubstitutes(
    target,
    active.map((a) => ({ id: a.id, disciplines: a.disciplines })),
    sameDay.map((m) => ({ ...m, startTime: m.startTime.slice(0, 5) })),
    unavailabilities,
  );
  return {
    unavailable: conflicts([target], unavailabilities).length > 0,
    substitutes: classes.map((r) => ({ ...r, name: names.get(r.id) ?? "" })),
  };
}
