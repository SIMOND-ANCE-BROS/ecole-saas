import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { rowsOf } from "./columns-of";
import { z } from "zod";
import { closedCourseLabel, type ScopedClosure } from "../domain/schedule/closure-scope";
import { recurrenceOf, type SeasonCalendar } from "../domain/schedule/lessons";
import { planLessonSync, seasonLessons } from "../domain/schedule/lesson-sync";
import type { Tx } from "./index";
import {
  course,
  courseDate,
  discipline,
  closure,
  closureCourse,
  closureSite,
  site,
  enrollment,
  enrollmentCourse,
  instructor,
  person,
  attendance,
  season,
  room,
  lesson,
  suspendedLesson,
} from "./schema";

/**
 * Lessons (dated occurrences of courses), closures and attendance. Always within
 * the `withSchool()` transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;
export type Result = { ok: true; id: string } | { ok: false; message: string };

/** Students on the attendance sheet: active or on trial, never on the waitlist. */
const ATTENDANCE_STATUSES = ["active", "trial"] as const;

// ---------------------------------------------------------------------------
// Closures
// ---------------------------------------------------------------------------

/**
 * A closure with its scope (#200) and, for display, what it covers: the
 * names of its sites, or its courses as « Jazz débutant – mardi 18:00 –
 * Salle 1 »; empty for the whole school.
 */
export type Closure = ScopedClosure & { id: string; label: string; targets: string[] };

export const validClosureInput = z.discriminatedUnion(
  "scope",
  [
    z.object({
      scope: z.literal("school"),
      label: z.string().trim().min(1, "Libellé obligatoire").max(100),
      start: z.iso.date("Date invalide"),
      end: z.iso.date("Date invalide"),
    }),
    z.object({
      scope: z.literal("sites"),
      label: z.string().trim().min(1, "Libellé obligatoire").max(100),
      start: z.iso.date("Date invalide"),
      end: z.iso.date("Date invalide"),
      siteIds: z.array(z.uuid("Site inconnu")).min(1, "Choisissez au moins un site.").max(50),
    }),
    z.object({
      scope: z.literal("courses"),
      label: z.string().trim().min(1, "Libellé obligatoire").max(100),
      start: z.iso.date("Date invalide"),
      end: z.iso.date("Date invalide"),
      courseIds: z.array(z.uuid("Cours inconnu")).min(1, "Choisissez au moins un cours.").max(500),
    }),
  ],
  { error: "Choix invalide." },
);

/** The season's dates and closures, to compute lesson dates (overlap warnings, #96); null if unknown. */
export async function seasonCalendar(tx: Tx, seasonId: string, today: string): Promise<SeasonCalendar | null> {
  const [s] = await tx
    .select({ start: season.startDate, end: season.endDate })
    .from(season)
    .where(eq(season.id, seasonId));
  if (!s) return null;
  const closures = await readClosures(tx, eq(closure.seasonId, seasonId));
  return { period: s, closures: closures.map(({ period, scope }) => ({ period, scope })), from: today };
}

/** Closures of a season, by start date, with what they cover. */
export async function listClosures(tx: Tx, seasonId: string): Promise<Closure[]> {
  return named(tx, await readClosures(tx, eq(closure.seasonId, seasonId)));
}

/** Closures matching `filter`, by start date, with their scope (#200). */
async function readClosures(tx: Tx, filter: SQL): Promise<(ScopedClosure & { id: string; label: string })[]> {
  const rows = await tx
    .select({
      id: closure.id,
      label: closure.label,
      start: closure.startDate,
      end: closure.endDate,
      scope: closure.scope,
    })
    .from(closure)
    .where(filter)
    .orderBy(asc(closure.startDate), asc(closure.label));
  const ids = rows.filter((r) => r.scope !== "school").map((r) => r.id);
  const [sites, courses] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          tx
            .select({ closureId: closureSite.closureId, id: closureSite.siteId })
            .from(closureSite)
            .where(inArray(closureSite.closureId, ids)),
          tx
            .select({ closureId: closureCourse.closureId, id: closureCourse.courseId })
            .from(closureCourse)
            .where(inArray(closureCourse.closureId, ids)),
        ]);
  const of = (links: { closureId: string; id: string }[], closureId: string) =>
    links.filter((l) => l.closureId === closureId).map((l) => l.id);
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    period: { start: r.start, end: r.end },
    scope:
      r.scope === "sites"
        ? { kind: "sites", siteIds: of(sites, r.id) }
        : r.scope === "courses"
          ? { kind: "courses", courseIds: of(courses, r.id) }
          : { kind: "school" },
  }));
}

/** Adds the names of what each closure covers. */
async function named(tx: Tx, closures: (ScopedClosure & { id: string; label: string })[]): Promise<Closure[]> {
  const siteIds = closures.flatMap((f) => (f.scope.kind === "sites" ? f.scope.siteIds : []));
  const courseIds = closures.flatMap((f) => (f.scope.kind === "courses" ? f.scope.courseIds : []));
  const [sites, courses] = await Promise.all([
    siteIds.length === 0 ? [] : tx.select({ id: site.id, name: site.name }).from(site).where(inArray(site.id, siteIds)),
    courseIds.length === 0
      ? []
      : tx
          .select({
            id: course.id,
            discipline: discipline.name,
            level: course.level,
            weekday: course.weekday,
            startTime: course.startTime,
            room: room.name,
          })
          .from(course)
          .innerJoin(discipline, eq(discipline.id, course.disciplineId))
          .innerJoin(room, eq(room.id, course.roomId))
          .where(inArray(course.id, courseIds)),
  ]);
  const names = new Map<string, string>([
    ...sites.map((s) => [s.id, s.name] as const),
    ...courses.map((c) => [c.id, closedCourseLabel({ ...c, startTime: c.startTime.slice(0, 5) })] as const),
  ]);
  return closures.map((f) => ({
    ...f,
    targets: (f.scope.kind === "sites" ? f.scope.siteIds : f.scope.kind === "courses" ? f.scope.courseIds : [])
      .map((id) => names.get(id) ?? "")
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "fr")),
  }));
}

export async function addClosure(tx: Tx, seasonId: string, entry: z.input<typeof validClosureInput>): Promise<Result> {
  const f = validClosureInput.safeParse(entry);
  if (!f.success) return { ok: false, message: f.error.issues[0].message };
  if (f.data.end < f.data.start) return { ok: false, message: "La fin précède le début." };
  const [s] = await tx
    .select({ start: season.startDate, end: season.endDate })
    .from(season)
    .where(eq(season.id, seasonId));
  if (!s) return { ok: false, message: "Cette saison n’existe plus." };
  // A closure belongs to one season (#189): its lessons are the ones it cancels.
  if (f.data.start < s.start || f.data.end > s.end)
    return { ok: false, message: "Les dates doivent être comprises dans la saison." };
  // The chosen sites, or courses of this season, must still exist (RLS: only this school's).
  const siteIds = f.data.scope === "sites" ? [...new Set(f.data.siteIds)] : [];
  const courseIds = f.data.scope === "courses" ? [...new Set(f.data.courseIds)] : [];
  if (siteIds.length > 0) {
    const found = await tx.select({ id: site.id }).from(site).where(inArray(site.id, siteIds));
    if (found.length !== siteIds.length) return { ok: false, message: "Un des sites choisis n’existe plus." };
  }
  if (courseIds.length > 0) {
    const found = await tx
      .select({ id: course.id })
      .from(course)
      .where(and(inArray(course.id, courseIds), eq(course.seasonId, seasonId)));
    if (found.length !== courseIds.length)
      return { ok: false, message: "Un des cours choisis n’existe plus dans cette saison." };
  }
  const [{ id }] = await tx
    .insert(closure)
    .values({
      label: f.data.label,
      startDate: f.data.start,
      endDate: f.data.end,
      scope: f.data.scope,
      seasonId,
      schoolId: CURRENT_SCHOOL,
    })
    .returning({ id: closure.id });
  if (siteIds.length > 0)
    await tx.insert(closureSite).values(
      rowsOf(
        closureSite,
        siteIds.map((siteId) => ({ closureId: id, siteId, schoolId: CURRENT_SCHOOL })),
      ),
    );
  if (courseIds.length > 0)
    await tx.insert(closureCourse).values(
      rowsOf(
        closureCourse,
        courseIds.map((courseId) => ({ closureId: id, courseId, schoolId: CURRENT_SCHOOL })),
      ),
    );
  return { ok: true, id };
}

/** Deletes a closure; gives its season, whose lessons are then to be restored. */
export async function deleteClosure(
  tx: Tx,
  id: string,
): Promise<{ ok: true; id: string; seasonId: string } | { ok: false; message: string }> {
  const refusal = { ok: false as const, message: "Cette fermeture n’existe plus." };
  if (!isUuid(id)) return refusal;
  const [row] = await tx.delete(closure).where(eq(closure.id, id)).returning({ seasonId: closure.seasonId });
  return row ? { ok: true, id, seasonId: row.seasonId } : refusal;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Effective time (text `HH:MM:SS`) and duration of a lesson: its own if it was moved (#90), otherwise the course's. */
export const effectiveTime = sql<string>`coalesce(${lesson.startTime}, ${course.startTime})::text`;
export const effectiveDuration = sql<number>`coalesce(${lesson.durationMinutes}, ${course.durationMinutes})`;

const withAttendance = sql`EXISTS (SELECT 1 FROM attendance p WHERE p.lesson_id = ${lesson}.${sql.identifier("id")})`;
const withPackUsage = sql`EXISTS (SELECT 1 FROM lesson_pack_usage u WHERE u.lesson_id = ${lesson}.${sql.identifier("id")})`;

/**
 * Brings the season's upcoming lessons in line with the courses and the
 * closures: creates the missing ones (course's main instructor) and removes
 * planned lessons that no longer apply. The past, cancelled lessons and
 * those whose attendance is taken are never touched. A moved lesson
 * (#90) is identified by its original date (`planned_date`): it is neither recreated
 * on that date nor removed. `since`: only regenerate from that date on
 * (moving a lesson « et des suivantes »). A lesson removed by a closure
 * keeps aside what it had of its own (substitute, time, new date) and gets
 * it back when the closure no longer covers it (#206). A lesson a lesson pack
 * was counted on is never removed either (#225): `keptForPack` counts those
 * left on a closed day (within `report`, the closure just added, when given),
 * for the director to move them if need be.
 */
export async function syncLessons(
  tx: Tx,
  seasonId: string,
  today: string,
  since?: string,
  report?: { start: string; end: string },
): Promise<{ added: number; removed: number; keptForPack: number }> {
  // One sync at a time per season: another one could take a lesson just kept aside for stale (#206).
  // NO KEY UPDATE, not UPDATE: callers insert a course or a closure first, whose foreign key takes
  // KEY SHARE on the season; FOR UPDATE would conflict with that of a concurrent caller (deadlock).
  const [s] = await tx
    .select({ start: season.startDate, end: season.endDate })
    .from(season)
    .where(eq(season.id, seasonId))
    .for("no key update");
  if (!s) return { added: 0, removed: 0, keptForPack: 0 };
  const start = [s.start, today, since ?? ""].reduce((a, b) => (b > a ? b : a));
  const closures = await readClosures(tx, eq(closure.seasonId, seasonId));
  const allCourses = await tx
    .select({
      id: course.id,
      recurrence: course.recurrence,
      weekday: course.weekday,
      startDate: course.startDate,
      endDate: course.endDate,
      instructorId: course.instructorId,
      siteId: room.siteId,
    })
    .from(course)
    .innerJoin(room, eq(room.id, course.roomId))
    .where(eq(course.seasonId, seasonId));
  const oneOff = await tx
    .select({ courseId: courseDate.courseId, date: courseDate.date })
    .from(courseDate)
    .innerJoin(course, eq(course.id, courseDate.courseId))
    .where(eq(course.seasonId, seasonId));

  const { expected, meets, closed } = seasonLessons(
    allCourses.map((c) => ({
      ...c,
      recurrence: recurrenceOf({ ...c, dates: oneOff.filter((p) => p.courseId === c.id).map((p) => p.date) }),
    })),
    { start: s.start, end: s.end },
    closures,
    start,
  );
  const existing = await tx
    .select({
      id: lesson.id,
      courseId: lesson.courseId,
      reference: sql<string>`coalesce(${lesson.plannedDate}, ${lesson.date})::text`,
      date: sql<string>`${lesson.date}::text`,
      plannedDate: sql<string | null>`${lesson.plannedDate}::text`,
      startTime: sql<string | null>`${lesson.startTime}::text`,
      durationMinutes: lesson.durationMinutes,
      instructorId: lesson.instructorId,
      courseInstructorId: course.instructorId,
      status: lesson.status,
      attendanceSheet: sql<boolean>`${withAttendance}`,
      packUsage: sql<boolean>`${withPackUsage}`,
    })
    .from(lesson)
    .innerJoin(course, eq(course.id, lesson.courseId))
    .where(eq(course.seasonId, seasonId));
  const suspended = await tx
    .select({
      courseId: suspendedLesson.courseId,
      referenceDate: sql<string>`${suspendedLesson.referenceDate}::text`,
      date: sql<string>`${suspendedLesson.date}::text`,
      plannedDate: sql<string | null>`${suspendedLesson.plannedDate}::text`,
      startTime: sql<string | null>`${suspendedLesson.startTime}::text`,
      durationMinutes: suspendedLesson.durationMinutes,
      instructorId: suspendedLesson.instructorId,
    })
    .from(suspendedLesson)
    .innerJoin(course, eq(course.id, suspendedLesson.courseId))
    .where(eq(course.seasonId, seasonId));
  const active = await tx.select({ id: instructor.id }).from(instructor).where(eq(instructor.active, true));

  const plan = planLessonSync({
    start,
    today,
    expected,
    meets,
    existing,
    suspended,
    activeInstructors: new Set(active.map((i) => i.id)),
    closed,
    report,
  });

  // Removals first: a lesson given back may take the date a removed lesson leaves.
  if (plan.remove.length > 0) await tx.delete(lesson).where(inArray(lesson.id, plan.remove));
  if (plan.forget.length > 0)
    await tx.delete(suspendedLesson).where(
      sql`(${suspendedLesson.courseId}, ${suspendedLesson.referenceDate}) IN (${sql.join(
        plan.forget.map((k) => sql`(${k.courseId}::uuid, ${k.referenceDate}::date)`),
        sql`, `,
      )})`,
    );
  if (plan.setAside.length > 0)
    await tx
      .insert(suspendedLesson)
      .values(
        rowsOf(
          suspendedLesson,
          plan.setAside.map((k) => ({
            courseId: k.courseId,
            referenceDate: k.referenceDate,
            date: k.date,
            plannedDate: k.plannedDate,
            startTime: k.startTime,
            durationMinutes: k.durationMinutes,
            instructorId: k.instructorId,
            schoolId: CURRENT_SCHOOL,
          })),
        ),
      )
      .onConflictDoUpdate({
        target: [suspendedLesson.courseId, suspendedLesson.referenceDate],
        set: {
          date: sql`excluded.date`,
          plannedDate: sql`excluded.planned_date`,
          startTime: sql`excluded.start_time`,
          durationMinutes: sql`excluded.duration_minutes`,
          instructorId: sql`excluded.instructor_id`,
        },
      });
  const added =
    plan.insert.length === 0
      ? []
      : await tx
          .insert(lesson)
          .values(
            rowsOf(
              lesson,
              plan.insert.map((a) => ({
                courseId: a.courseId,
                date: a.date,
                plannedDate: a.plannedDate,
                startTime: a.startTime,
                durationMinutes: a.durationMinutes,
                instructorId: a.instructorId,
                schoolId: CURRENT_SCHOOL,
              })),
            ),
          )
          .onConflictDoNothing()
          .returning({ id: lesson.id });
  return { added: added.length, removed: plan.remove.length, keptForPack: plan.keptForPack.length };
}

/**
 * Brings in line the lessons of every season with a course in the room: a
 * room moved to another site changes which site closures cover its courses (#200).
 */
export async function syncRoomSeasons(tx: Tx, roomId: string, today: string): Promise<void> {
  // Always the same order: each sync locks its season, two such calls must not lock them crosswise.
  const seasons = await tx
    .selectDistinct({ id: course.seasonId })
    .from(course)
    .where(eq(course.roomId, roomId))
    .orderBy(course.seasonId);
  for (const s of seasons) await syncLessons(tx, s.id, today);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const attendanceCount = (present: boolean) => sql<number>`(
  SELECT count(*)::int FROM attendance p WHERE p.lesson_id = ${lesson}.${sql.identifier("id")} AND p.present = ${present}
)`;

export type CourseLesson = {
  id: string;
  date: string;
  status: "planned" | "done" | "cancelled";
  instructor: string;
  presents: number;
  absents: number;
};

/** Lessons of a course, by date. */
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
  return rows.map(({ firstName, name, ...l }) => ({ ...l, instructor: `${firstName} ${name}` }));
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

/** Lessons of a day, by time: to take attendance from the front desk. */
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
  return rows.map(({ firstName, name, startTime, ...l }) => ({
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
    /** null until attendance is taken for this student. */
    present: boolean | null;
  }[];
};

/** Attendance sheet of a lesson; null if it does not exist in the current school. */
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
// Writes
// ---------------------------------------------------------------------------

export const validAttendance = z.array(z.object({ studentId: z.uuid(), present: z.boolean() })).max(200);

/** Records or corrects attendance; the lesson becomes « effectuée ». */
export async function saveAttendance(
  tx: Tx,
  lessonId: string,
  entry: z.input<typeof validAttendance>,
): Promise<Result> {
  const rows = validAttendance.safeParse(entry);
  if (!rows.success) return { ok: false, message: "Saisie invalide." };
  const attendanceSheet = await readAttendance(tx, lessonId);
  if (!attendanceSheet) return { ok: false, message: "Cette séance n’existe plus." };
  if (attendanceSheet.status === "cancelled") return { ok: false, message: "Cette séance est annulée." };
  const expected = new Set(attendanceSheet.students.map((d) => d.id));
  if (!rows.data.every((l) => expected.has(l.studentId)))
    return { ok: false, message: "Un des danseurs ne suit pas ce cours." };

  if (rows.data.length > 0) {
    await tx
      .insert(attendance)
      .values(
        rowsOf(
          attendance,
          rows.data.map((l) => ({
            studentId: l.studentId,
            present: l.present,
            lessonId,
            schoolId: CURRENT_SCHOOL,
          })),
        ),
      )
      .onConflictDoUpdate({
        target: [attendance.lessonId, attendance.studentId],
        set: { present: sql`excluded.present` },
      });
  }
  await tx.update(lesson).set({ status: "done" }).where(eq(lesson.id, lessonId));
  return { ok: true, id: lessonId };
}

/** Substitute (or return of the main instructor) for a lesson; active instructor only. */
export async function changeInstructor(tx: Tx, lessonId: string, instructorId: string): Promise<Result> {
  if (!isUuid(lessonId) || !isUuid(instructorId)) return { ok: false, message: "Saisie invalide." };
  const [i] = await tx
    .select({ id: instructor.id })
    .from(instructor)
    .where(and(eq(instructor.id, instructorId), eq(instructor.active, true)));
  if (!i) return { ok: false, message: "Intervenant introuvable ou inactif." };
  const rows = await tx
    .update(lesson)
    .set({ instructorId })
    .where(eq(lesson.id, lessonId))
    .returning({ id: lesson.id });
  return rows.length === 1 ? { ok: true, id: lessonId } : { ok: false, message: "Cette séance n’existe plus." };
}

/** Cancels a lesson whose attendance is not taken; it stays visible, struck through. */
export async function cancelLesson(tx: Tx, lessonId: string): Promise<Result> {
  const attendanceSheet = await readAttendance(tx, lessonId);
  if (!attendanceSheet) return { ok: false, message: "Cette séance n’existe plus." };
  if (attendanceSheet.students.some((d) => d.present !== null))
    return { ok: false, message: "L’appel de cette séance est déjà fait." };
  await tx.update(lesson).set({ status: "cancelled" }).where(eq(lesson.id, lessonId));
  return { ok: true, id: lessonId };
}

/** Restores a cancelled lesson. */
export async function restoreLesson(tx: Tx, lessonId: string): Promise<Result> {
  if (!isUuid(lessonId)) return { ok: false, message: "Cette séance n’existe plus." };
  const rows = await tx
    .update(lesson)
    .set({ status: "planned" })
    .where(and(eq(lesson.id, lessonId), eq(lesson.status, "cancelled")))
    .returning({ id: lesson.id });
  return rows.length === 1 ? { ok: true, id: lessonId } : { ok: false, message: "Cette séance n’est pas annulée." };
}

// ---------------------------------------------------------------------------
// Dated schedule (#90)
// ---------------------------------------------------------------------------

/** Effective time and duration of a lesson: its own if it was moved, otherwise the course's. */
const lessonTime = sql<string>`to_char(coalesce(${lesson.startTime}, ${course.startTime}), 'HH24:MI')`;
const lessonDuration = sql<number>`coalesce(${lesson.durationMinutes}, ${course.durationMinutes})`;

export type ScheduleLesson = {
  id: string;
  courseId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  status: "planned" | "done" | "cancelled";
  /** Moved individually (other date or other time than planned). */
  moved: boolean;
  /** Original date of a moved lesson, otherwise its date: what closures are checked against, as in `syncLessons`. */
  plannedDate: string;
  recurrence: "weekly" | "biweekly" | "dates";
  discipline: string;
  roomId: string;
  room: string;
  siteId: string;
  site: string;
  /** Instructor of the lesson (substitute, if any). */
  instructorId: string;
  instructor: string;
  substitution: boolean;
  enrolled: number;
  maxCapacity: number | null;
};

/** Lessons of the week starting on Monday `monday`, across all seasons, by date and time. */
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
      // Moved itself (not merely frozen before a course change): it keeps its original date.
      moved: sql<boolean>`${lesson.plannedDate} IS NOT NULL`,
      plannedDate: sql<string>`coalesce(${lesson.plannedDate}, ${lesson.date})::text`,
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
  return rows.map(({ firstName, name, ...l }) => ({ ...l, instructor: `${firstName} ${name}` }));
}

/** Closures (all seasons) that touch the period, with what they cover (#200). */
export async function closuresBetween(tx: Tx, start: string, end: string): Promise<Closure[]> {
  return named(
    tx,
    await readClosures(tx, sql`${closure.startDate} <= ${end}::date AND ${closure.endDate} >= ${start}::date`),
  );
}

export const validLessonSlot = z.object({
  date: z.iso.date("Date invalide"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM"),
  durationMinutes: z.int().min(5).max(600),
});

export type LessonResult =
  { status: "ok"; seasonId: string; since: string | null } | { status: "refused"; message: string };

const isoDay = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// Sent by the browser through a server action: any other value is refused (#160).
const validMoveScope = z.enum(["lesson", "following"]);

/**
 * Moves a lesson (#90). "lesson": only it changes (the course stays);
 * "following": the course takes the new slot from this lesson on,
 * earlier lessons keep their (frozen) time, later ones move
 * to the new day keeping their instructor (replacement). The caller
 * then resyncs the lessons from `since` on.
 */
export async function moveLesson(
  tx: Tx,
  id: string,
  slot: z.input<typeof validLessonSlot>,
  scope: z.infer<typeof validMoveScope>,
): Promise<LessonResult> {
  if (!validMoveScope.safeParse(scope).success)
    return { status: "refused", message: "Indiquez s’il faut déplacer cette séance seulement ou aussi les suivantes." };
  const c = validLessonSlot.safeParse(slot);
  if (!c.success) return { status: "refused", message: c.error.issues[0].message };
  const { date, startTime, durationMinutes } = c.data;
  if (Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) + durationMinutes > 24 * 60) {
    return { status: "refused", message: "La séance finirait après minuit." };
  }
  if (!isUuid(id)) return { status: "refused", message: "Cette séance n’existe plus." };
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
  if (!s) return { status: "refused", message: "Cette séance n’existe plus." };
  if (s.status !== "planned" || s.attendanceSheet)
    return { status: "refused", message: "Cette séance est annulée ou son appel est fait : elle ne se déplace plus." };
  if (date < s.seasonStart || date > s.seasonEnd)
    return { status: "refused", message: "Cette date est en dehors de la saison." };
  const reference = s.plannedDate ?? s.date;

  if (scope === "lesson") {
    if (date !== s.date) {
      const [other] = await tx
        .select({ id: lesson.id })
        .from(lesson)
        .where(and(eq(lesson.courseId, s.courseId), eq(lesson.date, date)));
      if (other) return { status: "refused", message: "Ce cours a déjà une séance ce jour-là." };
    }
    const sameSlot = startTime === s.courseTime && durationMinutes === s.courseDuration;
    if (s.recurrence === "dates") {
      // One-off course: the date is part of the course itself.
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
          // Back to its original slot: no longer moved.
          plannedDate: date === reference && sameSlot ? null : reference,
          startTime: sameSlot ? null : startTime,
          durationMinutes: sameSlot ? null : durationMinutes,
        })
        .where(eq(lesson.id, id));
    }
    return { status: "ok", seasonId: s.seasonId, since: null };
  }

  if (s.recurrence === "dates")
    return { status: "refused", message: "Un cours à dates précises se déplace séance par séance." };
  const newDay = isoDay(date);
  // A later lesson a lesson pack was counted on stays as it is (#225), unless it is the one moved.
  const packKept = and(
    sql`coalesce(${lesson.plannedDate}, ${lesson.date}) >= ${reference}::date`,
    ne(lesson.id, id),
    sql`${withPackUsage}`,
  );
  // 1. Earlier lessons, and the later ones kept for a pack, keep the old slot.
  await tx
    .update(lesson)
    .set({
      startTime: sql`coalesce(${lesson.startTime}, ${s.courseTime}::time)`,
      durationMinutes: sql`coalesce(${lesson.durationMinutes}, ${s.courseDuration})`,
    })
    .where(
      and(
        eq(lesson.courseId, s.courseId),
        or(sql`coalesce(${lesson.plannedDate}, ${lesson.date}) < ${reference}::date`, packKept),
      ),
    );
  // 2. The course takes the new slot.
  await tx.update(course).set({ weekday: newDay, startTime, durationMinutes }).where(eq(course.id, s.courseId));
  // 3. Later lessons that can still be changed move to the new day of their week, without their own time.
  const following = await tx
    .select({ id: lesson.id, reference: sql<string>`coalesce(${lesson.plannedDate}, ${lesson.date})::text` })
    .from(lesson)
    .where(
      and(
        eq(lesson.courseId, s.courseId),
        eq(lesson.status, "planned"),
        sql`coalesce(${lesson.plannedDate}, ${lesson.date}) >= ${reference}::date`,
        sql`NOT ${withAttendance}`,
        or(eq(lesson.id, id), sql`NOT ${withPackUsage}`),
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
