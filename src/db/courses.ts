import { and, asc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./index";
import { hoursBySite } from "./settings";
import { course, courseDate, discipline, enrollmentCourse, instructor, attendance, room, lesson, site } from "./schema";

/** Édition du planning (cours, disciplines, salles), toujours avec la transaction d'`avecEcole()` (RLS). */

export const COURSE_TYPES = {
  collectif: "Collectif",
  particulier: "Particulier",
  competition: "Compétition",
  stage: "Stage",
} as const;

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const shortName = z.string().trim().min(1).max(100);
const integerOrNull = (min: number, max: number) => z.int().min(min).max(max).nullable();
const dateOrNull = z.iso.date("Date invalide").nullable();

/** Récurrences proposées (#90). */
export const RECURRENCES = {
  hebdomadaire: "Chaque semaine",
  quinzaine: "Une semaine sur deux",
  dates: "À des dates précises",
} as const;

export const validCourseInput = z
  .object({
    discipline: z.union([z.object({ id: z.uuid() }), z.object({ name: shortName })]),
    room: z.union([
      z.object({ id: z.uuid() }),
      z.object({
        name: shortName,
        capacity: integerOrNull(1, 1000),
        site: z.union([
          z.object({ id: z.uuid() }),
          z.object({ name: shortName, address: z.string().trim().min(1).max(300) }),
        ]),
      }),
    ]),
    instructorId: z.uuid(),
    type: z.enum(["collectif", "particulier", "competition", "stage"]),
    recurrence: z.enum(["hebdomadaire", "quinzaine", "dates"]),
    weekday: integerOrNull(1, 7),
    startDate: dateOrNull,
    endDate: dateOrNull,
    dates: z.array(z.iso.date("Date invalide")).max(100, "100 dates au plus"),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM"),
    durationMinutes: z.int().min(5).max(600),
    ageMin: integerOrNull(0, 120),
    ageMax: integerOrNull(0, 120),
    level: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .transform((v) => v || null),
    maxCapacity: integerOrNull(1, 1000),
  })
  .refine((c) => c.ageMin === null || c.ageMax === null || c.ageMin <= c.ageMax, {
    path: ["ageMax"],
    message: "L’âge maximum est inférieur à l’âge minimum",
  })
  .refine((c) => c.recurrence === "dates" || c.weekday !== null, {
    path: ["weekday"],
    message: "Jour obligatoire",
  })
  .refine((c) => c.recurrence !== "dates" || c.dates.length > 0, {
    path: ["dates"],
    message: "Ajoutez au moins une date",
  })
  .refine((c) => c.startDate === null || c.endDate === null || c.startDate <= c.endDate, {
    path: ["endDate"],
    message: "La fin précède le début",
  });

export type CourseInput = z.output<typeof validCourseInput>;
export type Result = { ok: true; id: string } | { ok: false; message: string };

export type EditedCourse = {
  id: string;
  seasonId: string;
  disciplineId: string;
  discipline: string;
  roomId: string;
  instructorId: string;
  type: keyof typeof COURSE_TYPES;
  recurrence: keyof typeof RECURRENCES;
  weekday: number | null;
  startDate: string | null;
  endDate: string | null;
  /** Dates d'un cours ponctuel, triées. */
  dates: string[];
  startTime: string;
  durationMinutes: number;
  ageMin: number | null;
  ageMax: number | null;
  level: string | null;
  maxCapacity: number | null;
};

/** Dates d'un cours ponctuel, triées (texte `YYYY-MM-DD`). */
export const courseDatesSql = sql<string[]>`coalesce((
  SELECT array_agg(cd.date::text ORDER BY cd.date) FROM course_date cd WHERE cd.course_id = ${course}.${sql.identifier("id")}), '{}')`;

export async function readCourse(tx: Tx, id: string): Promise<EditedCourse | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [c] = await tx
    .select({
      id: course.id,
      seasonId: course.seasonId,
      disciplineId: course.disciplineId,
      discipline: discipline.name,
      roomId: course.roomId,
      instructorId: course.instructorId,
      type: course.type,
      recurrence: course.recurrence,
      weekday: course.weekday,
      startDate: course.startDate,
      endDate: course.endDate,
      dates: courseDatesSql,
      startTime: course.startTime,
      durationMinutes: course.durationMinutes,
      ageMin: course.ageMin,
      ageMax: course.ageMax,
      level: course.level,
      maxCapacity: course.maxCapacity,
    })
    .from(course)
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .where(eq(course.id, id));
  return c ? { ...c, startTime: c.startTime.slice(0, 5) } : null;
}

/** Choix proposés dans le formulaire de cours. `inclure` : intervenant à garder même inactif. */
export async function scheduleReferential(tx: Tx, include?: string) {
  const [disciplines, salles, sites, instructors] = [
    await tx.select({ id: discipline.id, name: discipline.name }).from(discipline).orderBy(asc(discipline.name)),
    await tx
      .select({ id: room.id, name: room.name, site: site.name, siteId: site.id, capacity: room.capacity })
      .from(room)
      .innerJoin(site, eq(site.id, room.siteId))
      .orderBy(asc(site.name), asc(room.name)),
    await tx.select({ id: site.id, name: site.name }).from(site).orderBy(asc(site.name)),
    await tx
      .select({
        id: instructor.id,
        firstName: instructor.firstName,
        name: instructor.lastName,
        active: instructor.active,
      })
      .from(instructor)
      .where(include ? or(eq(instructor.active, true), eq(instructor.id, include)) : eq(instructor.active, true))
      .orderBy(asc(instructor.firstName), asc(instructor.lastName)),
  ];
  // Horaires d'ouverture par site (#90) : le formulaire prévient d'un créneau qui en sort.
  return { disciplines, salles, sites, instructors: instructors, hours: await hoursBySite(tx) };
}
export type ScheduleReferential = Awaited<ReturnType<typeof scheduleReferential>>;

/** Discipline choisie, ou retrouvée par son nom (sans tenir compte de la casse), sinon créée. */
async function resolveDiscipline(tx: Tx, d: CourseInput["discipline"]): Promise<string | null> {
  if ("id" in d) {
    const [x] = await tx.select({ id: discipline.id }).from(discipline).where(eq(discipline.id, d.id));
    return x?.id ?? null;
  }
  const name = d.name.trim();
  const [x] = await tx
    .select({ id: discipline.id })
    .from(discipline)
    .where(sql`lower(${discipline.name}) = lower(${name})`);
  if (x) return x.id;
  const [n] = await tx
    .insert(discipline)
    .values({ schoolId: CURRENT_SCHOOL, name: name })
    .returning({ id: discipline.id });
  return n.id;
}

/** Salle choisie, ou créée avec son site (existant ou nouveau). */
async function resolveRoom(tx: Tx, s: CourseInput["room"]): Promise<string | null> {
  if ("id" in s) {
    const [x] = await tx.select({ id: room.id }).from(room).where(eq(room.id, s.id));
    return x?.id ?? null;
  }
  let siteId: string;
  if ("id" in s.site) {
    const [x] = await tx.select({ id: site.id }).from(site).where(eq(site.id, s.site.id));
    if (!x) return null;
    siteId = x.id;
  } else {
    [{ id: siteId }] = await tx
      .insert(site)
      .values({ schoolId: CURRENT_SCHOOL, name: s.site.name, address: s.site.address })
      .returning({ id: site.id });
  }
  const [n] = await tx
    .insert(room)
    .values({ schoolId: CURRENT_SCHOOL, siteId, name: s.name, capacity: s.capacity })
    .returning({ id: room.id });
  return n.id;
}

/** Résout discipline, salle et intervenant ; un intervenant inactif n'est accepté que s'il est `garde`. */
async function values(tx: Tx, saisie: CourseInput, guard?: string) {
  const [i] = await tx
    .select({ id: instructor.id })
    .from(instructor)
    .where(
      and(
        eq(instructor.id, saisie.instructorId),
        guard ? or(eq(instructor.active, true), eq(instructor.id, guard)) : eq(instructor.active, true),
      ),
    );
  if (!i) return { ok: false as const, message: "Intervenant introuvable ou inactif." };
  const roomId = await resolveRoom(tx, saisie.room);
  if (!roomId) return { ok: false as const, message: "Salle introuvable." };
  const disciplineId = await resolveDiscipline(tx, saisie.discipline);
  if (!disciplineId) return { ok: false as const, message: "Discipline introuvable." };
  const {
    instructorId: instructorId,
    type,
    recurrence,
    startTime: startTime,
    durationMinutes: durationMinutes,
    ageMin,
    ageMax,
    level: level,
    maxCapacity: maxCapacity,
  } = saisie;
  // Dates précises : ni jour ni période ; cours régulier : pas de dates.
  const oneOff = recurrence === "dates";
  const weekday = oneOff ? null : saisie.weekday;
  const [startDate, endDate] = oneOff ? [null, null] : [saisie.startDate, saisie.endDate];
  return {
    ok: true as const,
    // Course columns, ready for insert/update.
    values: {
      disciplineId,
      roomId: roomId,
      instructorId: instructorId,
      type,
      recurrence,
      weekday: weekday,
      startDate: startDate,
      endDate: endDate,
      startTime: startTime,
      durationMinutes: durationMinutes,
      ageMin,
      ageMax,
      level: level,
      maxCapacity: maxCapacity,
    },
    dates: oneOff ? [...new Set(saisie.dates)].sort() : [],
  };
}

export async function createCourse(tx: Tx, seasonId: string, saisie: CourseInput): Promise<Result> {
  const r = await values(tx, saisie);
  if (!r.ok) return r;
  const [{ id }] = await tx
    .insert(course)
    .values({ ...r.values, schoolId: CURRENT_SCHOOL, seasonId: seasonId })
    .returning({ id: course.id });
  await replaceDates(tx, id, r.dates);
  return { ok: true, id };
}

async function replaceDates(tx: Tx, courseId: string, dates: string[]) {
  await tx.delete(courseDate).where(eq(courseDate.courseId, courseId));
  if (dates.length > 0)
    await tx.insert(courseDate).values(dates.map((date) => ({ schoolId: CURRENT_SCHOOL, courseId: courseId, date })));
}

export async function updateCourse(tx: Tx, id: string, saisie: CourseInput): Promise<Result> {
  const existing = await readCourse(tx, id);
  if (!existing) return { ok: false, message: "Ce cours n’existe plus." };
  const r = await values(tx, saisie, existing.instructorId);
  if (!r.ok) return r;
  await tx.update(course).set(r.values).where(eq(course.id, id));
  await replaceDates(tx, id, r.dates);
  // Nouveau titulaire : il reprend les séances à venir de l'ancien, pas celles d'un remplaçant.
  if (r.values.instructorId !== existing.instructorId) {
    await tx
      .update(lesson)
      .set({ instructorId: r.values.instructorId })
      .where(
        and(
          eq(lesson.courseId, id),
          eq(lesson.instructorId, existing.instructorId),
          eq(lesson.status, "prevue"),
          sql`${lesson.date} >= (now() AT TIME ZONE 'Europe/Paris')::date`,
        ),
      );
  }
  return { ok: true, id };
}

/** Refusée dès qu'une inscription, quel que soit son statut, porte sur le cours. */
export async function deleteCourse(tx: Tx, id: string): Promise<Result> {
  if (!(await readCourse(tx, id))) return { ok: false, message: "Ce cours n’existe plus." };
  const [{ n }] = await tx
    .select({ n: sql<number>`count(DISTINCT ${enrollmentCourse.enrollmentId})::int` })
    .from(enrollmentCourse)
    .where(eq(enrollmentCourse.courseId, id));
  if (n > 0)
    return { ok: false, message: `Ce cours a ${n} inscription${n > 1 ? "s" : ""} : il ne peut pas être supprimé.` };
  const [attendanceRow] = await tx
    .select({ lessonId: attendance.lessonId })
    .from(attendance)
    .innerJoin(lesson, eq(lesson.id, attendance.lessonId))
    .where(eq(lesson.courseId, id))
    .limit(1);
  if (attendanceRow)
    return { ok: false, message: "Des appels ont été faits pour ce cours : il ne peut pas être supprimé." };
  await tx.delete(lesson).where(eq(lesson.courseId, id));
  await tx.delete(course).where(eq(course.id, id));
  return { ok: true, id };
}

export const validSlot = z.object({
  weekday: z.int().min(1).max(7),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM"),
  durationMinutes: z.int().min(5).max(600),
});

export type MoveResult =
  { status: "ok"; id: string } | { status: "confirmer"; enrolled: number } | { status: "refus"; message: string };

/**
 * Déplace (jour, heure) ou étire (durée) un cours depuis la vue agenda. Si des
 * élèves y sont inscrits (actifs ou à l'essai), il faut d'abord confirmer.
 * Les séances à venir sont recalculées par l'appelant (synchroniserSeances).
 */
export async function moveCourse(
  tx: Tx,
  id: string,
  slot: z.input<typeof validSlot>,
  confirmed: boolean,
): Promise<MoveResult> {
  const c = validSlot.safeParse(slot);
  if (!c.success) return { status: "refus", message: c.error.issues[0].message };
  const existing = await readCourse(tx, id);
  if (!existing) return { status: "refus", message: "Ce cours n’existe plus." };
  if (existing.recurrence === "dates")
    return { status: "refus", message: "Un cours à dates précises se modifie depuis sa fiche." };
  if (toMinutesEnd(c.data) > 24 * 60) return { status: "refus", message: "Le cours finirait après minuit." };
  if (!confirmed) {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(DISTINCT ${enrollmentCourse.studentId})::int` })
      .from(enrollmentCourse)
      .innerJoin(sql`enrollment i`, sql`i.id = ${enrollmentCourse.enrollmentId} AND i.status IN ('active', 'essai')`)
      .where(eq(enrollmentCourse.courseId, id));
    if (n > 0) return { status: "confirmer", enrolled: n };
  }
  await tx
    .update(course)
    .set({ weekday: c.data.weekday, startTime: c.data.startTime, durationMinutes: c.data.durationMinutes })
    .where(eq(course.id, id));
  return { status: "ok", id };
}

const toMinutesEnd = (c: { startTime: string; durationMinutes: number }) =>
  Number(c.startTime.slice(0, 2)) * 60 + Number(c.startTime.slice(3, 5)) + c.durationMinutes;
