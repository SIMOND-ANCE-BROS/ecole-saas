import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { courseDates, type Recurrence } from "../domain/schedule/lessons";
import type { Tx } from "./index";
import {
  course,
  courseDate,
  discipline,
  closure,
  enrollment,
  enrollmentCourse,
  instructor,
  person,
  attendance,
  season,
  room,
  lesson,
} from "./schema";

/**
 * Séances (occurrences datées des cours), fermetures et appel. Toujours avec
 * la transaction d'`avecEcole()` (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;
export type Result = { ok: true; id: string } | { ok: false; message: string };

/** Danseurs qui figurent à l'appel : inscrits ou à l'essai, jamais en liste d'attente. */
const ATTENDANCE_STATUSES = ["active", "essai"] as const;

// ---------------------------------------------------------------------------
// Fermetures
// ---------------------------------------------------------------------------

export type Closure = { id: string; label: string; start: string; end: string };

export const validClosureInput = z.object({
  label: z.string().trim().min(1, "Libellé obligatoire").max(100),
  start: z.iso.date("Date invalide"),
  end: z.iso.date("Date invalide"),
});

export function listClosures(tx: Tx, seasonId: string): Promise<Closure[]> {
  return tx
    .select({ id: closure.id, label: closure.label, start: closure.startDate, end: closure.endDate })
    .from(closure)
    .where(eq(closure.seasonId, seasonId))
    .orderBy(asc(closure.startDate));
}

export async function addClosure(tx: Tx, seasonId: string, saisie: z.input<typeof validClosureInput>): Promise<Result> {
  const f = validClosureInput.safeParse(saisie);
  if (!f.success) return { ok: false, message: f.error.issues[0].message };
  if (f.data.end < f.data.start) return { ok: false, message: "La fin précède le début." };
  const [{ id }] = await tx
    .insert(closure)
    .values({
      label: f.data.label,
      startDate: f.data.start,
      endDate: f.data.end,
      seasonId: seasonId,
      schoolId: CURRENT_SCHOOL,
    })
    .returning({ id: closure.id });
  return { ok: true, id };
}

export async function deleteClosure(tx: Tx, id: string): Promise<Result> {
  const refusal = { ok: false as const, message: "Cette fermeture n’existe plus." };
  if (!isUuid(id)) return refusal;
  const rows = await tx.delete(closure).where(eq(closure.id, id)).returning({ id: closure.id });
  return rows.length === 1 ? { ok: true, id } : refusal;
}

// ---------------------------------------------------------------------------
// Génération
// ---------------------------------------------------------------------------

/** Heure (texte `HH:MM:SS`) et durée effectives d'une séance : les siennes si elle a été déplacée (#90), sinon celles du cours. */
export const effectiveTime = sql<string>`coalesce(${lesson.startTime}, ${course.startTime})::text`;
export const effectiveDuration = sql<number>`coalesce(${lesson.durationMinutes}, ${course.durationMinutes})`;

const withAttendance = sql`EXISTS (SELECT 1 FROM attendance p WHERE p.lesson_id = ${lesson}.${sql.identifier("id")})`;

/**
 * Met les séances à venir de la saison en accord avec les cours et les
 * fermetures : crée celles qui manquent (titulaire du cours) et retire les
 * séances prévues devenues sans objet. Le passé, les séances annulées et
 * celles dont l'appel est fait ne sont jamais touchés. Une séance déplacée
 * (#90) se repère à sa date d'origine (`date_prevue`) : elle n'est ni recréée
 * à cette date, ni retirée. `depuis` : ne régénérer qu'à partir de cette date
 * (déplacement d'une séance « et des suivantes »).
 */
export async function syncLessons(
  tx: Tx,
  seasonId: string,
  today: string,
  since?: string,
): Promise<{ added: number; retirees: number }> {
  const [s] = await tx
    .select({ start: season.startDate, end: season.endDate })
    .from(season)
    .where(eq(season.id, seasonId));
  if (!s) return { added: 0, retirees: 0 };
  const start = [s.start, today, since ?? ""].reduce((a, b) => (b > a ? b : a));
  const closures = await listClosures(tx, seasonId);
  const tous = await tx
    .select({
      id: course.id,
      recurrence: course.recurrence,
      weekday: course.weekday,
      startDate: course.startDate,
      endDate: course.endDate,
      instructorId: course.instructorId,
    })
    .from(course)
    .where(eq(course.seasonId, seasonId));
  const oneOff = await tx
    .select({ courseId: courseDate.courseId, date: courseDate.date })
    .from(courseDate)
    .innerJoin(course, eq(course.id, courseDate.courseId))
    .where(eq(course.seasonId, seasonId));

  // Toute la saison, puis à partir de `debut` : l'alternance « une semaine sur deux » se cale sur la première date.
  const expected = tous.flatMap((c) => {
    const r: Recurrence =
      c.recurrence === "dates"
        ? { type: "dates", dates: oneOff.filter((p) => p.courseId === c.id).map((p) => p.date) }
        : { type: c.recurrence, weekday: c.weekday as number, startDate: c.startDate, endDate: c.endDate };
    return courseDates(r, { start: s.start, end: s.end }, closures)
      .filter((date) => date >= start)
      .map((date) => ({ courseId: c.id, date, instructorId: c.instructorId }));
  });
  const reference = sql<string>`coalesce(${lesson.plannedDate}, ${lesson.date})::text`;
  const existing = await tx
    .select({
      id: lesson.id,
      courseId: lesson.courseId,
      reference: reference,
      status: lesson.status,
      attendanceSheet: sql<boolean>`${withAttendance}`,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .where(eq(course.seasonId, seasonId));
  const presentes = new Set(existing.map((e) => `${e.courseId} ${e.reference}`));
  const missing = expected.filter((a) => !presentes.has(`${a.courseId} ${a.date}`));
  const added =
    missing.length === 0
      ? []
      : await tx
          .insert(lesson)
          .values(
            missing.map((a) => ({
              courseId: a.courseId,
              date: a.date,
              instructorId: a.instructorId,
              schoolId: CURRENT_SCHOOL,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: lesson.id });

  const wanted = new Set(expected.map((a) => `${a.courseId} ${a.date}`));
  const toRemove = existing
    .filter(
      (e) =>
        e.reference >= start &&
        e.status === "prevue" &&
        !e.attendanceSheet &&
        !wanted.has(`${e.courseId} ${e.reference}`),
    )
    .map((e) => e.id);
  if (toRemove.length > 0) await tx.delete(lesson).where(inArray(lesson.id, toRemove));
  return { added: added.length, retirees: toRemove.length };
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

const attendanceCount = (present: boolean) => sql<number>`(
  SELECT count(*)::int FROM attendance p WHERE p.lesson_id = ${lesson}.${sql.identifier("id")} AND p.present = ${present}
)`;

export type CourseLesson = {
  id: string;
  date: string;
  status: "prevue" | "effectuee" | "annulee";
  instructor: string;
  presents: number;
  absents: number;
};

/** Séances d'un cours, par date. */
export async function courseLessons(tx: Tx, courseId: string): Promise<CourseLesson[]> {
  if (!isUuid(courseId)) return [];
  const rows = await tx
    .select({
      id: lesson.id,
      date: lesson.date,
      status: lesson.status,
      firstName: instructor.firstName,
      name: instructor.lastName,
      presents: attendanceCount(true),
      absents: attendanceCount(false),
    })
    .from(lesson)
    .innerJoin(instructor, eq(instructor.id, lesson.instructorId))
    .where(eq(lesson.courseId, courseId))
    .orderBy(asc(lesson.date));
  return rows.map(({ firstName: firstName, name: name, ...l }) => ({ ...l, instructor: `${firstName} ${name}` }));
}

export type DayLesson = {
  id: string;
  courseId: string;
  startTime: string;
  durationMinutes: number;
  discipline: string;
  level: string | null;
  room: string;
  instructor: string;
  status: CourseLesson["status"];
  doneAttendance: boolean;
};

/** Séances d'une journée, par heure : pour lancer l'appel depuis l'accueil. */
export async function dayLessons(tx: Tx, date: string): Promise<DayLesson[]> {
  const rows = await tx
    .select({
      id: lesson.id,
      courseId: course.id,
      startTime: effectiveTime,
      durationMinutes: effectiveDuration,
      discipline: discipline.name,
      level: course.level,
      room: room.name,
      firstName: instructor.firstName,
      name: instructor.lastName,
      status: lesson.status,
      doneAttendance: sql<boolean>`${withAttendance}`,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(room, eq(room.id, course.roomId))
    .innerJoin(instructor, eq(instructor.id, lesson.instructorId))
    .where(eq(lesson.date, date))
    .orderBy(effectiveTime, asc(discipline.name));
  return rows.map(({ firstName: firstName, name: name, startTime: startTime, ...l }) => ({
    ...l,
    startTime: startTime.slice(0, 5),
    instructor: `${firstName} ${name}`,
  }));
}

export type Attendance = {
  id: string;
  date: string;
  status: CourseLesson["status"];
  courseId: string;
  discipline: string;
  level: string | null;
  startTime: string;
  durationMinutes: number;
  room: string;
  instructorId: string;
  regularInstructorId: string;
  students: {
    id: string;
    firstName: string;
    name: string;
    birthDate: string | null;
    notes: string | null;
    status: (typeof ATTENDANCE_STATUSES)[number];
    /** null tant que l'appel n'est pas fait pour ce danseur. */
    present: boolean | null;
  }[];
};

/** Fiche d'appel d'une séance ; null si elle n'existe pas dans l'école courante. */
export async function readAttendance(tx: Tx, lessonId: string): Promise<Attendance | null> {
  if (!isUuid(lessonId)) return null;
  const [s] = await tx
    .select({
      id: lesson.id,
      date: lesson.date,
      status: lesson.status,
      courseId: course.id,
      discipline: discipline.name,
      level: course.level,
      startTime: effectiveTime,
      durationMinutes: effectiveDuration,
      room: room.name,
      instructorId: lesson.instructorId,
      regularInstructorId: course.instructorId,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(room, eq(room.id, course.roomId))
    .where(eq(lesson.id, lessonId));
  if (!s) return null;

  const students = await tx
    .selectDistinctOn([person.lastName, person.firstName, person.id], {
      id: person.id,
      firstName: person.firstName,
      name: person.lastName,
      birthDate: person.birthDate,
      notes: person.notes,
      status: sql<Attendance["students"][number]["status"]>`${enrollment.status}`,
      present: attendance.present,
    })
    .from(enrollmentCourse)
    .innerJoin(enrollment, eq(enrollment.id, enrollmentCourse.enrollmentId))
    .innerJoin(person, eq(person.id, enrollmentCourse.studentId))
    .leftJoin(attendance, and(eq(attendance.lessonId, lessonId), eq(attendance.studentId, person.id)))
    .where(and(eq(enrollmentCourse.courseId, s.courseId), inArray(enrollment.status, [...ATTENDANCE_STATUSES])))
    .orderBy(asc(person.lastName), asc(person.firstName), asc(person.id), desc(sql`${enrollment.status} = 'active'`));

  return {
    ...s,
    startTime: s.startTime.slice(0, 5),
    students: students.map((d) => ({ ...d, firstName: d.firstName ?? d.name })),
  };
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------

export const validAttendance = z.array(z.object({ studentId: z.uuid(), present: z.boolean() })).max(200);

/** Enregistre ou corrige l'appel ; la séance passe « effectuée ». */
export async function saveAttendance(
  tx: Tx,
  lessonId: string,
  saisie: z.input<typeof validAttendance>,
): Promise<Result> {
  const rows = validAttendance.safeParse(saisie);
  if (!rows.success) return { ok: false, message: "Saisie invalide." };
  const attendanceSheet = await readAttendance(tx, lessonId);
  if (!attendanceSheet) return { ok: false, message: "Cette séance n’existe plus." };
  if (attendanceSheet.status === "annulee") return { ok: false, message: "Cette séance est annulée." };
  const expected = new Set(attendanceSheet.students.map((d) => d.id));
  if (!rows.data.every((l) => expected.has(l.studentId)))
    return { ok: false, message: "Un des danseurs ne suit pas ce cours." };

  if (rows.data.length > 0) {
    await tx
      .insert(attendance)
      .values(
        rows.data.map((l) => ({
          studentId: l.studentId,
          present: l.present,
          lessonId: lessonId,
          schoolId: CURRENT_SCHOOL,
        })),
      )
      .onConflictDoUpdate({
        target: [attendance.lessonId, attendance.studentId],
        set: { present: sql`excluded.present` },
      });
  }
  await tx.update(lesson).set({ status: "effectuee" }).where(eq(lesson.id, lessonId));
  return { ok: true, id: lessonId };
}

/** Remplaçant (ou retour du titulaire) pour une séance ; intervenant actif seulement. */
export async function changeInstructor(tx: Tx, lessonId: string, instructorId: string): Promise<Result> {
  if (!isUuid(lessonId) || !isUuid(instructorId)) return { ok: false, message: "Saisie invalide." };
  const [i] = await tx
    .select({ id: instructor.id })
    .from(instructor)
    .where(and(eq(instructor.id, instructorId), eq(instructor.active, true)));
  if (!i) return { ok: false, message: "Intervenant introuvable ou inactif." };
  const rows = await tx
    .update(lesson)
    .set({ instructorId: instructorId })
    .where(eq(lesson.id, lessonId))
    .returning({ id: lesson.id });
  return rows.length === 1 ? { ok: true, id: lessonId } : { ok: false, message: "Cette séance n’existe plus." };
}

/** Annule une séance dont l'appel n'est pas fait ; elle reste visible, barrée. */
export async function cancelLesson(tx: Tx, lessonId: string): Promise<Result> {
  const attendanceSheet = await readAttendance(tx, lessonId);
  if (!attendanceSheet) return { ok: false, message: "Cette séance n’existe plus." };
  if (attendanceSheet.students.some((d) => d.present !== null))
    return { ok: false, message: "L’appel de cette séance est déjà fait." };
  await tx.update(lesson).set({ status: "annulee" }).where(eq(lesson.id, lessonId));
  return { ok: true, id: lessonId };
}

/** Rétablit une séance annulée. */
export async function restoreLesson(tx: Tx, lessonId: string): Promise<Result> {
  if (!isUuid(lessonId)) return { ok: false, message: "Cette séance n’existe plus." };
  const rows = await tx
    .update(lesson)
    .set({ status: "prevue" })
    .where(and(eq(lesson.id, lessonId), eq(lesson.status, "annulee")))
    .returning({ id: lesson.id });
  return rows.length === 1 ? { ok: true, id: lessonId } : { ok: false, message: "Cette séance n’est pas annulée." };
}

// ---------------------------------------------------------------------------
// Planning daté (#90)
// ---------------------------------------------------------------------------

/** Heure et durée effectives d'une séance : les siennes si elle a été déplacée, sinon celles du cours. */
const lessonTime = sql<string>`to_char(coalesce(${lesson.startTime}, ${course.startTime}), 'HH24:MI')`;
const lessonDuration = sql<number>`coalesce(${lesson.durationMinutes}, ${course.durationMinutes})`;

export type ScheduleLesson = {
  id: string;
  courseId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  status: "prevue" | "effectuee" | "annulee";
  /** Déplacée individuellement (autre date ou autre heure que prévu). */
  moved: boolean;
  recurrence: "hebdomadaire" | "quinzaine" | "dates";
  discipline: string;
  roomId: string;
  room: string;
  siteId: string;
  site: string;
  /** Intervenant de la séance (remplaçant éventuel). */
  instructorId: string;
  instructor: string;
  substitution: boolean;
  enrolled: number;
  maxCapacity: number | null;
};

/** Séances de la semaine qui commence le lundi `lundi`, toutes saisons confondues, par date et heure. */
export async function weekLessons(tx: Tx, monday: string): Promise<ScheduleLesson[]> {
  const sunday = sql`(${monday}::date + 6)`;
  const rows = await tx
    .select({
      id: lesson.id,
      courseId: lesson.courseId,
      date: lesson.date,
      startTime: lessonTime,
      durationMinutes: lessonDuration,
      status: lesson.status,
      // Déplacée elle-même (pas seulement figée avant un changement du cours) : elle garde sa date d'origine.
      moved: sql<boolean>`${lesson.plannedDate} IS NOT NULL`,
      recurrence: course.recurrence,
      discipline: discipline.name,
      roomId: course.roomId,
      room: room.name,
      siteId: room.siteId,
      site: sql<string>`(SELECT s.name FROM site s WHERE s.id = ${room.siteId})`,
      instructorId: lesson.instructorId,
      firstName: instructor.firstName,
      name: instructor.lastName,
      substitution: sql<boolean>`${lesson.instructorId} <> ${course.instructorId}`,
      enrolled: sql<number>`(
        SELECT count(DISTINCT ic.student_id)::int FROM enrollment_course ic
        JOIN enrollment i ON i.id = ic.enrollment_id AND i.status = 'active'
        WHERE ic.course_id = ${lesson.courseId})`,
      maxCapacity: course.maxCapacity,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(room, eq(room.id, course.roomId))
    .innerJoin(instructor, eq(instructor.id, lesson.instructorId))
    .where(and(sql`${lesson.date} >= ${monday}::date`, sql`${lesson.date} <= ${sunday}`))
    .orderBy(asc(lesson.date), sql`coalesce(${lesson.startTime}, ${course.startTime})`, asc(discipline.name));
  return rows.map(({ firstName: firstName, name: name, ...l }) => ({ ...l, instructor: `${firstName} ${name}` }));
}

/** Fermetures (toutes saisons) qui touchent la période. */
export function closuresBetween(
  tx: Tx,
  start: string,
  end: string,
): Promise<{ label: string; start: string; end: string }[]> {
  return tx
    .select({ label: closure.label, start: closure.startDate, end: closure.endDate })
    .from(closure)
    .where(and(sql`${closure.startDate} <= ${end}::date`, sql`${closure.endDate} >= ${start}::date`))
    .orderBy(asc(closure.startDate));
}

export const validLessonSlot = z.object({
  date: z.iso.date("Date invalide"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM"),
  durationMinutes: z.int().min(5).max(600),
});

export type LessonResult =
  { status: "ok"; seasonId: string; since: string | null } | { status: "refus"; message: string };

const isoDay = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Déplace une séance (#90). « seance » : elle seule change (le cours reste) ;
 * « suivantes » : le cours prend le nouveau créneau à partir de cette séance,
 * les séances précédentes gardent leur heure (figée), les suivantes passent
 * au nouveau jour en gardant leur intervenant (remplacement). L'appelant
 * resynchronise ensuite les séances à partir de `depuis`.
 */
export async function moveLesson(
  tx: Tx,
  id: string,
  slot: z.input<typeof validLessonSlot>,
  scope: "seance" | "suivantes",
): Promise<LessonResult> {
  const c = validLessonSlot.safeParse(slot);
  if (!c.success) return { status: "refus", message: c.error.issues[0].message };
  const { date, startTime: startTime, durationMinutes: durationMinutes } = c.data;
  if (Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) + durationMinutes > 24 * 60) {
    return { status: "refus", message: "La séance finirait après minuit." };
  }
  if (!isUuid(id)) return { status: "refus", message: "Cette séance n’existe plus." };
  const [s] = await tx
    .select({
      courseId: lesson.courseId,
      date: lesson.date,
      plannedDate: lesson.plannedDate,
      status: lesson.status,
      attendanceSheet: sql<boolean>`${withAttendance}`,
      seasonId: course.seasonId,
      recurrence: course.recurrence,
      courseDay: course.weekday,
      courseTime: sql<string>`to_char(${course.startTime}, 'HH24:MI')`,
      courseDuration: course.durationMinutes,
      seasonStart: season.startDate,
      seasonEnd: season.endDate,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .innerJoin(season, eq(season.id, course.seasonId))
    .where(eq(lesson.id, id));
  if (!s) return { status: "refus", message: "Cette séance n’existe plus." };
  if (s.status !== "prevue" || s.attendanceSheet)
    return { status: "refus", message: "Cette séance est annulée ou son appel est fait : elle ne se déplace plus." };
  if (date < s.seasonStart || date > s.seasonEnd)
    return { status: "refus", message: "Cette date est en dehors de la saison." };
  const reference = s.plannedDate ?? s.date;

  if (scope === "seance") {
    if (date !== s.date) {
      const [autre] = await tx
        .select({ id: lesson.id })
        .from(lesson)
        .where(and(eq(lesson.courseId, s.courseId), eq(lesson.date, date)));
      if (autre) return { status: "refus", message: "Ce cours a déjà une séance ce jour-là." };
    }
    const sameSlot = startTime === s.courseTime && durationMinutes === s.courseDuration;
    if (s.recurrence === "dates") {
      // Cours ponctuel : la date fait partie du cours lui-même.
      if (date !== s.date) {
        await tx.delete(courseDate).where(and(eq(courseDate.courseId, s.courseId), eq(courseDate.date, s.date)));
        await tx
          .insert(courseDate)
          .values({ schoolId: CURRENT_SCHOOL, courseId: s.courseId, date })
          .onConflictDoNothing();
      }
      await tx
        .update(lesson)
        .set({ date, startTime: sameSlot ? null : startTime, durationMinutes: sameSlot ? null : durationMinutes })
        .where(eq(lesson.id, id));
    } else {
      await tx
        .update(lesson)
        .set({
          date,
          // Revenue à son créneau d'origine : plus déplacée.
          plannedDate: date === reference && sameSlot ? null : reference,
          startTime: sameSlot ? null : startTime,
          durationMinutes: sameSlot ? null : durationMinutes,
        })
        .where(eq(lesson.id, id));
    }
    return { status: "ok", seasonId: s.seasonId, since: null };
  }

  if (s.recurrence === "dates")
    return { status: "refus", message: "Un cours à dates précises se déplace séance par séance." };
  const newDay = isoDay(date);
  // 1. Les séances d'avant gardent l'ancien créneau.
  await tx
    .update(lesson)
    .set({
      startTime: sql`coalesce(${lesson.startTime}, ${s.courseTime}::time)`,
      durationMinutes: sql`coalesce(${lesson.durationMinutes}, ${s.courseDuration})`,
    })
    .where(
      and(eq(lesson.courseId, s.courseId), sql`coalesce(${lesson.plannedDate}, ${lesson.date}) < ${reference}::date`),
    );
  // 2. Le cours prend le nouveau créneau.
  await tx
    .update(course)
    .set({ weekday: newDay, startTime: startTime, durationMinutes: durationMinutes })
    .where(eq(course.id, s.courseId));
  // 3. Les séances suivantes encore modifiables passent au nouveau jour de leur semaine, sans heure propre.
  const following = await tx
    .select({ id: lesson.id, reference: sql<string>`coalesce(${lesson.plannedDate}, ${lesson.date})::text` })
    .from(lesson)
    .where(
      and(
        eq(lesson.courseId, s.courseId),
        eq(lesson.status, "prevue"),
        sql`coalesce(${lesson.plannedDate}, ${lesson.date}) >= ${reference}::date`,
        sql`NOT ${withAttendance}`,
      ),
    );
  for (const x of following) {
    await tx
      .update(lesson)
      .set({
        date: shift(x.reference, newDay - isoDay(x.reference)),
        plannedDate: null,
        startTime: null,
        durationMinutes: null,
      })
      .where(eq(lesson.id, x.id));
  }
  return { status: "ok", seasonId: s.seasonId, since: shift(reference, 1 - isoDay(reference)) };
}
