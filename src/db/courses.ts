import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { columnsOf, rowsOf } from "./columns-of";
import { z } from "zod";
import type { Tx } from "./index";
import { hoursBySite } from "./settings";
import { defaultEntityId, NO_DEFAULT_ENTITY } from "./billing-entities";
import {
  auditLog,
  billingEntity,
  course,
  courseDate,
  discipline,
  enrollmentCourse,
  instructor,
  attendance,
  lessonPackUsage,
  member,
  room,
  lesson,
  payMode,
  season,
  site,
} from "./schema";
import {
  courseRateAllowed,
  rateAfterUpdate,
  rateInCurrentUnit,
  rateUnitAfterSave,
  type PayMode,
} from "../domain/payroll/rate";
import { courseRateEditable } from "../domain/payroll/course-rates";
import { entityChangeRefusal } from "../domain/enrollment/entities";
import { issuePath } from "../lib/form-errors";
import { has } from "../lib/has";
import { parseEuros } from "../lib/money";

/** Schedule editing (courses, disciplines, rooms), always within the `withSchool()` transaction (RLS). */

export const COURSE_TYPES = {
  group: "Collectif",
  private: "Particulier",
  competition: "Compétition",
  workshop: "Stage",
} as const;

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const shortName = z.string().trim().min(1, "Obligatoire").max(100, "100 caractères au plus");
const between = (min: number, max: number) => `Nombre entier entre ${min} et ${max}`;
const integerOrNull = (min: number, max: number) =>
  z.int(between(min, max)).min(min, between(min, max)).max(max, between(min, max)).nullable();
const duration = z.int(between(5, 600)).min(5, between(5, 600)).max(600, between(5, 600));
const dateOrNull = z.iso.date("Date invalide").nullable();
/** Typed in euros (« 35 », « 35,50 »), kept in integer cents. Empty: none. */
const euroRate = z
  .string()
  .max(20)
  .transform((v, ctx) => {
    const typed = v.trim();
    if (typed === "") return null;
    const cents = parseEuros(typed);
    if (cents === null || cents > 100_000_00) {
      ctx.addIssue({ code: "custom", message: "Montant en euros, par exemple 35 ou 35,50" });
      return z.NEVER;
    }
    return cents;
  });
/** Absent (field not offered, monthly flat instructor): the stored rate is kept. */
const euroRateOrNull = euroRate.optional();

/**
 * A course's rate set from the instructor page (#276): the amount (empty: the
 * usual rate) and the unit the page showed it in, which the server checks
 * against the instructor's current pay mode (#268).
 */
export const validCourseRateEdit = z.object({
  rate: euroRate,
  unit: z.enum(payMode.enumValues),
});

/** Offered recurrences (#90). */
export const RECURRENCES = {
  weekly: "Chaque semaine",
  biweekly: "Une semaine sur deux",
  dates: "À des dates précises",
} as const;

const courseFields = z.object({
  discipline: z.union([z.object({ id: z.uuid() }), z.object({ name: shortName })]),
  room: z.union([
    z.object({ id: z.uuid() }),
    z.object({
      name: shortName,
      capacity: integerOrNull(1, 1000),
      site: z.union([
        z.object({ id: z.uuid() }),
        z.object({
          name: shortName,
          address: z.string().trim().min(1, "Obligatoire").max(300, "300 caractères au plus"),
        }),
      ]),
    }),
  ]),
  instructorId: z.uuid(),
  /**
   * Business that sells the course (#299). Absent (a school with one entity sees no
   * choice): the default entity for a new course, unchanged for an existing one.
   */
  billingEntityId: z.uuid().optional(),
  type: z.enum(["group", "private", "competition", "workshop"]),
  recurrence: z.enum(["weekly", "biweekly", "dates"]),
  weekday: integerOrNull(1, 7),
  startDate: dateOrNull,
  endDate: dateOrNull,
  dates: z.array(z.iso.date("Date invalide")).max(100, "100 dates au plus"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM"),
  durationMinutes: duration,
  ageMin: integerOrNull(0, 120),
  ageMax: integerOrNull(0, 120),
  level: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .transform((v) => v || null),
  maxCapacity: integerOrNull(1, 1000),
  /** Instructor's pay for this course (#191), director only; absent or empty: their default rate. */
  instructorRate: euroRateOrNull,
  /** Instructor the rate was typed for: a rate left over from another instructor is not kept (#191). */
  instructorRateFor: z.uuid().optional(),
  /** Unit the form showed for that rate (#268): the server refuses an amount typed in a pay mode no longer current. */
  instructorRateUnit: z.enum(payMode.enumValues).optional(),
});

export const validCourseInput = courseFields
  .refine((c) => c.ageMin === null || c.ageMax === null || c.ageMin <= c.ageMax, {
    path: issuePath(courseFields, "ageMax"),
    message: "L’âge maximum est inférieur à l’âge minimum",
  })
  .refine((c) => c.recurrence === "dates" || c.weekday !== null, {
    path: issuePath(courseFields, "weekday"),
    message: "Jour obligatoire",
  })
  .refine((c) => c.recurrence !== "dates" || c.dates.length > 0, {
    path: issuePath(courseFields, "dates"),
    message: "Ajoutez au moins une date",
  })
  .refine((c) => c.startDate === null || c.endDate === null || c.startDate <= c.endDate, {
    path: issuePath(courseFields, "endDate"),
    message: "La fin précède le début",
  });

export type CourseInput = z.output<typeof validCourseInput>;
export type Result = { ok: true; id: string } | { ok: false; message: string };
/** Saved course, with the instructor rate it now carries (#191). */
export type SaveResult = { ok: true; id: string; instructorRateCents: number | null } | { ok: false; message: string };

export type EditedCourse = {
  id: string;
  seasonId: string;
  disciplineId: string;
  discipline: string;
  roomId: string;
  instructorId: string;
  billingEntityId: string;
  type: keyof typeof COURSE_TYPES;
  recurrence: keyof typeof RECURRENCES;
  weekday: number | null;
  startDate: string | null;
  endDate: string | null;
  /** Dates of a one-off course, sorted. */
  dates: string[];
  startTime: string;
  durationMinutes: number;
  ageMin: number | null;
  ageMax: number | null;
  level: string | null;
  maxCapacity: number | null;
};

/** Dates of a one-off course, sorted (text `YYYY-MM-DD`). */
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
      billingEntityId: course.billingEntityId,
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

/** Choices offered in the course form. `include`: instructor to keep even if inactive. */
export async function scheduleReferential(tx: Tx, include?: string) {
  const [disciplines, rooms, sites, instructors] = [
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
  // Opening hours per site (#90): the form warns about a slot that falls outside them.
  return { disciplines, rooms, sites, instructors, hours: await hoursBySite(tx) };
}
export type ScheduleReferential = Awaited<ReturnType<typeof scheduleReferential>>;

/** Chosen discipline, or found by its name (case-insensitive), otherwise created. */
async function resolveDiscipline(tx: Tx, d: CourseInput["discipline"]): Promise<string | null> {
  if (has(d, "id")) {
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

/** Chosen room, or created with its site (existing or new). */
async function resolveRoom(tx: Tx, s: CourseInput["room"]): Promise<string | null> {
  if (has(s, "id")) {
    const [x] = await tx.select({ id: room.id }).from(room).where(eq(room.id, s.id));
    return x?.id ?? null;
  }
  let siteId: string;
  if (has(s.site, "id")) {
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

/** A rate per course typed for a monthly flat instructor (#192). */
const MONTHLY_FLAT = {
  ok: false as const,
  message: "Pas de tarif par cours pour un forfait mensuel pour l’instant (règle en attente).",
};

/** Resolves discipline, room and instructor; an inactive instructor is accepted only if it is `guard`. */
async function values(tx: Tx, entry: CourseInput, guard?: string) {
  const found = tx
    .select({ id: instructor.id, payMode: instructor.payMode })
    .from(instructor)
    .where(
      and(
        eq(instructor.id, entry.instructorId),
        guard ? or(eq(instructor.active, true), eq(instructor.id, guard)) : eq(instructor.active, true),
      ),
    );
  // Saving a rate: the pay mode it is checked against cannot change before the commit (see updateInstructor).
  const [i] = entry.instructorRate != null ? await found.for("share") : await found;
  if (!i) return { ok: false as const, message: "Intervenant introuvable ou inactif." };
  if (entry.instructorRate != null && !courseRateAllowed(i.payMode)) return MONTHLY_FLAT;
  const roomId = await resolveRoom(tx, entry.room);
  if (!roomId) return { ok: false as const, message: "Salle introuvable." };
  const disciplineId = await resolveDiscipline(tx, entry.discipline);
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
  } = entry;
  // Specific dates: neither day nor period; regular course: no dates.
  const oneOff = recurrence === "dates";
  const weekday = oneOff ? null : entry.weekday;
  const [startDate, endDate] = oneOff ? [null, null] : [entry.startDate, entry.endDate];
  return {
    ok: true as const,
    // The instructor's current pay mode: the unit of a rate typed now (#268).
    payMode: i.payMode,
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
    dates: oneOff ? [...new Set(entry.dates)].sort() : [],
  };
}

/**
 * The entity a saved course is sold by (#299): the one chosen, if it is active or is
 * already the course's (`current`, kept even once deactivated); none chosen, the
 * course's own, or the school's default for a new course.
 */
async function resolveEntity(
  tx: Tx,
  wanted: string | undefined,
  current?: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (wanted === undefined) {
    const id = current ?? (await defaultEntityId(tx));
    return id ? { ok: true, id } : { ok: false, message: NO_DEFAULT_ENTITY };
  }
  const [e] = await tx
    .select({ id: billingEntity.id })
    .from(billingEntity)
    .where(
      and(
        eq(billingEntity.id, wanted),
        current ? or(eq(billingEntity.active, true), eq(billingEntity.id, current)) : eq(billingEntity.active, true),
      ),
    );
  return e ? { ok: true, id: e.id } : { ok: false, message: "Entreprise introuvable ou inactive." };
}

/** Number of enrollments, whatever their status, with a student in the course. */
async function enrollmentCount(tx: Tx, id: string): Promise<number> {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(DISTINCT ${enrollmentCourse.enrollmentId})::int` })
    .from(enrollmentCourse)
    .where(eq(enrollmentCourse.courseId, id));
  return n;
}

/** An amount typed in a unit the instructor is no longer paid in (a form opened before a pay mode change, #268). */
const STALE_UNIT = {
  ok: false as const,
  message:
    "Le mode de rémunération de cet intervenant a changé : rechargez la page pour saisir le tarif dans la bonne unité.",
};

export async function createCourse(tx: Tx, seasonId: string, entry: CourseInput): Promise<SaveResult> {
  const r = await values(tx, entry);
  if (!r.ok) return r;
  const entity = await resolveEntity(tx, entry.billingEntityId);
  if (!entity.ok) return entity;
  const instructorRateCents = entry.instructorRate ?? null;
  // A rate is typed in the instructor's current pay mode (#268).
  const unit = rateUnitAfterSave({
    cents: instructorRateCents,
    sent: entry.instructorRate,
    shownUnit: entry.instructorRateUnit,
    stored: null,
    sameInstructor: false,
    payMode: r.payMode,
  });
  if (!unit) return STALE_UNIT;
  const instructorRatePayMode = unit.unit;
  const [{ id }] = await tx
    .insert(course)
    .values(
      columnsOf(course, {
        ...r.values,
        billingEntityId: entity.id,
        instructorRateCents,
        instructorRatePayMode,
        schoolId: CURRENT_SCHOOL,
        seasonId: seasonId,
      }),
    )
    .returning({ id: course.id });
  await replaceDates(tx, id, r.dates);
  return { ok: true, id, instructorRateCents };
}

async function replaceDates(tx: Tx, courseId: string, dates: string[]) {
  await tx.delete(courseDate).where(eq(courseDate.courseId, courseId));
  if (dates.length > 0)
    await tx.insert(courseDate).values(
      rowsOf(
        courseDate,
        dates.map((date) => ({ schoolId: CURRENT_SCHOOL, courseId: courseId, date })),
      ),
    );
}

/**
 * Locks a course row until the commit (FOR UPDATE), before reading what a save
 * keeps of it: the course form and the instructor page's rate (#276) then save
 * one after the other, each seeing the other's rate, instead of the later one
 * writing back a rate read before the other's commit. Lock order: the course,
 * then its instructor (FOR SHARE), on both paths.
 */
export async function lockCourse(tx: Tx, id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  await tx.select({ id: course.id }).from(course).where(eq(course.id, id)).for("update");
}

export async function updateCourse(tx: Tx, id: string, entry: CourseInput): Promise<SaveResult> {
  // Already locked by the action (before its audit read); kept here for any other caller.
  await lockCourse(tx, id);
  const existing = await readCourse(tx, id);
  if (!existing) return { ok: false, message: "Ce cours n’existe plus." };
  const r = await values(tx, entry, existing.instructorId);
  if (!r.ok) return r;
  const entity = await resolveEntity(tx, entry.billingEntityId, existing.billingEntityId);
  if (!entity.ok) return entity;
  // Its enrollments belong to its entity (the database refuses the change too).
  const entityRefusal =
    entity.id === existing.billingEntityId
      ? null
      : entityChangeRefusal({
          from: existing.billingEntityId,
          to: entity.id,
          enrollments: await enrollmentCount(tx, id),
        });
  if (entityRefusal) return { ok: false, message: entityRefusal };
  const stored = (await courseRate(tx, id)) ?? null;
  const instructorRateCents = rateAfterUpdate({
    sent: entry.instructorRate,
    typedFor: entry.instructorRateFor,
    stored: stored?.cents ?? null,
    oldInstructor: existing.instructorId,
    newInstructor: r.values.instructorId,
  });
  // Unit (#268), decided here: an older pay mode's rate sent back untouched keeps its own.
  const unit = rateUnitAfterSave({
    cents: instructorRateCents,
    sent: entry.instructorRate,
    shownUnit: entry.instructorRateUnit,
    stored,
    sameInstructor: existing.instructorId === r.values.instructorId,
    payMode: r.payMode,
  });
  if (!unit) return STALE_UNIT;
  const instructorRatePayMode = unit.unit;
  await tx
    .update(course)
    .set(columnsOf(course, { ...r.values, billingEntityId: entity.id, instructorRateCents, instructorRatePayMode }))
    .where(eq(course.id, id));
  await replaceDates(tx, id, r.dates);
  // New main instructor: takes over the old one's upcoming lessons, not those of a substitute.
  if (r.values.instructorId !== existing.instructorId) {
    await tx
      .update(lesson)
      .set({ instructorId: r.values.instructorId })
      .where(
        and(
          eq(lesson.courseId, id),
          eq(lesson.instructorId, existing.instructorId),
          eq(lesson.status, "planned"),
          sql`${lesson.date} >= (now() AT TIME ZONE 'Europe/Paris')::date`,
        ),
      );
  }
  return { ok: true, id, instructorRateCents };
}

/** A course's own instructor rate with its unit: the pay mode it was typed in (#268). */
export type CourseRate = { cents: number; payMode: PayMode };

/**
 * Instructor's rate for this course (#191) with its unit (#268): director
 * pages only, never read with the course for the front desk. null: none;
 * undefined: no such course.
 */
export async function courseRate(tx: Tx, id: string): Promise<CourseRate | null | undefined> {
  if (!z.uuid().safeParse(id).success) return undefined;
  const [c] = await tx
    .select({ cents: course.instructorRateCents, payMode: course.instructorRatePayMode })
    .from(course)
    .where(eq(course.id, id));
  if (!c) return undefined;
  // Both set or both null (check course_instructor_rate_unit).
  return c.cents === null || c.payMode === null ? null : { cents: c.cents, payMode: c.payMode };
}

/**
 * The course's own instructor rate, in the unit it was typed in (#268), when
 * one is shown (#191): null when none is set or the instructor is now paid a
 * monthly flat. `current`: the unit is still the instructor's pay mode; if not,
 * it is an older pay mode's rate, kept as history (#192 Q5).
 * Director only: callers check the role before reading it.
 */
export async function courseOwnRate(tx: Tx, id: string): Promise<(CourseRate & { current: boolean }) | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [c] = await tx
    .select({ cents: course.instructorRateCents, unit: course.instructorRatePayMode, payMode: instructor.payMode })
    .from(course)
    .innerJoin(instructor, eq(instructor.id, course.instructorId))
    .where(eq(course.id, id));
  if (!c || c.cents === null || c.unit === null || !courseRateAllowed(c.payMode)) return null;
  return { cents: c.cents, payMode: c.unit, current: rateInCurrentUnit(c.unit, c.payMode) };
}

export type CoursePay = {
  /** Pay mode and default rate of each instructor offered in the form. */
  instructors: Record<string, { payMode: PayMode; rateCents: number }>;
  /** The course's own instructor rate, in its own unit (#268); null: none (or a new course). */
  rate: CourseRate | null;
};

/** Pay data of the course form (#191), for the director's new and edit pages only. */
export async function coursePay(tx: Tx, courseId: string | null): Promise<CoursePay> {
  const rows = await tx
    .select({ id: instructor.id, payMode: instructor.payMode, rateCents: instructor.rateCents })
    .from(instructor);
  return {
    instructors: Object.fromEntries(rows.map((i) => [i.id, { payMode: i.payMode, rateCents: i.rateCents }])),
    rate: courseId ? ((await courseRate(tx, courseId)) ?? null) : null,
  };
}

/**
 * The instructor's courses (main instructor) with their own rate, if any
 * (#191, #276), newest season first: director's instructor page.
 */
export async function instructorCourseRates(tx: Tx, instructorId: string) {
  if (!z.uuid().safeParse(instructorId).success) return [];
  const rows = await tx
    .select({
      id: course.id,
      discipline: discipline.name,
      level: course.level,
      weekday: course.weekday,
      startTime: sql<string>`to_char(${course.startTime}, 'HH24:MI')`,
      durationMinutes: course.durationMinutes,
      season: season.label,
      seasonEndDate: season.endDate,
      rateCents: course.instructorRateCents,
      /** Unit of the rate (#268): the pay mode it was typed in, maybe not the instructor's current one. */
      ratePayMode: course.instructorRatePayMode,
    })
    .from(course)
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(season, eq(season.id, course.seasonId))
    .where(eq(course.instructorId, instructorId))
    .orderBy(desc(season.startDate), sql`${course.weekday} NULLS LAST`, course.startTime, discipline.name);
  return rows.map(({ rateCents, ratePayMode, ...c }) => ({
    ...c,
    // Both set or both null (check course_instructor_rate_unit).
    rate: rateCents === null || ratePayMode === null ? null : { cents: rateCents, payMode: ratePayMode },
  }));
}

/**
 * Sets (or clears, `rate` null: the usual rate) a course's instructor rate
 * from the instructor page (#276), with the course form's rules: no rate per
 * course for a monthly flat instructor (#192), the unit decided by
 * `rateUnitAfterSave` (#268), the course row locked FOR UPDATE (see
 * lockCourse), then the instructor row FOR SHARE so that their pay mode
 * cannot change before the commit (see updateInstructor).
 * Refused for a course no longer taught by this instructor, or of a past
 * season (history, #192 Q5). `today` is a `YYYY-MM-DD` date in Paris.
 * Returns the rate states before and after, for the audit log.
 */
export async function setCourseRate(
  tx: Tx,
  instructorId: string,
  courseId: string,
  edit: z.output<typeof validCourseRateEdit>,
  today: string,
): Promise<
  | { ok: true; rate: CourseRate | null; before: CourseRateState; after: CourseRateState }
  | { ok: false; message: string }
> {
  const noInstructor = { ok: false as const, message: "Cet intervenant n’existe plus." };
  const gone = { ok: false as const, message: "Ce cours n’existe plus." };
  if (!z.uuid().safeParse(instructorId).success) return noInstructor;
  if (!z.uuid().safeParse(courseId).success) return gone;
  // Lock order as in the course form: the course (FOR UPDATE, see lockCourse), then the instructor.
  const [c] = await tx
    .select({
      instructorId: course.instructorId,
      cents: course.instructorRateCents,
      unit: course.instructorRatePayMode,
      seasonEndDate: season.endDate,
    })
    .from(course)
    .innerJoin(season, eq(season.id, course.seasonId))
    .where(eq(course.id, courseId))
    .for("update", { of: course });
  if (!c) return gone;
  // The pay mode checked here cannot change before the commit (updateInstructor locks the row FOR UPDATE).
  const [i] = await tx
    .select({ payMode: instructor.payMode })
    .from(instructor)
    .where(eq(instructor.id, instructorId))
    .for("share");
  if (!i) return noInstructor;
  if (c.instructorId !== instructorId)
    return { ok: false, message: "Ce cours est maintenant donné par un autre intervenant : rechargez la page." };
  if (edit.rate !== null && !courseRateAllowed(i.payMode)) return MONTHLY_FLAT;
  if (!courseRateEditable(c.seasonEndDate, today))
    return { ok: false, message: "La saison de ce cours est terminée : son tarif est gardé tel quel." };
  const stored = c.cents === null || c.unit === null ? null : { cents: c.cents, payMode: c.unit };
  const unit = rateUnitAfterSave({
    cents: edit.rate,
    sent: edit.rate,
    shownUnit: edit.unit,
    stored,
    sameInstructor: true,
    payMode: i.payMode,
  });
  if (!unit) return STALE_UNIT;
  const rate = edit.rate !== null && unit.unit !== null ? { cents: edit.rate, payMode: unit.unit } : null;
  await tx
    .update(course)
    .set({ instructorRateCents: rate?.cents ?? null, instructorRatePayMode: rate?.payMode ?? null })
    .where(eq(course.id, courseId));
  return {
    ok: true,
    rate,
    before: { instructorId, instructorRateCents: c.cents, instructorRatePayMode: c.unit },
    after: { instructorId, instructorRateCents: rate?.cents ?? null, instructorRatePayMode: rate?.payMode ?? null },
  };
}

/** A course's instructor and own rate, as written to the audit log. */
export type CourseRateState = {
  instructorId: string;
  instructorRateCents: number | null;
  instructorRatePayMode: PayMode | null;
};

/** Records a change of a course's instructor or of their rate for it in the audit log; nothing when neither changed. */
export async function logCourseRate(
  tx: Tx,
  userId: string,
  courseId: string,
  before: CourseRateState | null,
  after: CourseRateState,
) {
  const was = before?.instructorRateCents ?? null;
  const sameRate =
    was === after.instructorRateCents && (before?.instructorRatePayMode ?? null) === after.instructorRatePayMode;
  // A change of instructor is kept too, rate or not: the lessons already given were
  // taught by the old one, and the monthly statement flags it (#285).
  const sameInstructor = before === null || before.instructorId === after.instructorId;
  if (sameRate && sameInstructor) return;
  const [who] = await tx.select({ id: member.id }).from(member).where(eq(member.userId, userId));
  await tx.insert(auditLog).values(
    rowsOf(auditLog, [
      {
        schoolId: CURRENT_SCHOOL,
        actor: who?.id ?? null,
        targetTable: "course",
        rowId: courseId,
        action: before ? "update" : "insert",
        before,
        after,
      },
    ]),
  );
}

/** A course's instructor and own rate, for the audit log (#191, #268); null: no such course. */
export async function courseRateState(tx: Tx, id: string): Promise<CourseRateState | null> {
  const existing = await readCourse(tx, id);
  if (!existing) return null;
  const rate = (await courseRate(tx, id)) ?? null;
  return {
    instructorId: existing.instructorId,
    instructorRateCents: rate?.cents ?? null,
    instructorRatePayMode: rate?.payMode ?? null,
  };
}

/** Refused as soon as an enrollment, whatever its status, concerns the course. */
export async function deleteCourse(tx: Tx, id: string): Promise<Result> {
  if (!(await readCourse(tx, id))) return { ok: false, message: "Ce cours n’existe plus." };
  const n = await enrollmentCount(tx, id);
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
  // A lesson a lesson pack was counted on is never deleted (#225): the foreign key would refuse it anyway.
  const [packRow] = await tx
    .select({ lessonId: lessonPackUsage.lessonId })
    .from(lessonPackUsage)
    .innerJoin(lesson, eq(lesson.id, lessonPackUsage.lessonId))
    .where(eq(lesson.courseId, id))
    .limit(1);
  if (packRow)
    return {
      ok: false,
      message: "Ce cours a des séances déjà décomptées d’un carnet : il ne peut pas être supprimé.",
    };
  await tx.delete(lesson).where(eq(lesson.courseId, id));
  await tx.delete(course).where(eq(course.id, id));
  return { ok: true, id };
}

export const validSlot = z.object({
  weekday: z.int().min(1).max(7),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure au format HH:MM"),
  durationMinutes: duration,
  /** Day-by-room view (#85): the course moves to another room too. */
  roomId: z.uuid().optional(),
});

export type MoveResult =
  { status: "ok"; id: string } | { status: "confirm"; enrolled: number } | { status: "refused"; message: string };

/**
 * Moves (day, time) or stretches (duration) a course from the calendar view. If
 * students are enrolled (active or on trial), it must be confirmed first.
 * Upcoming lessons are recomputed by the caller (syncLessons).
 */
export async function moveCourse(
  tx: Tx,
  id: string,
  slot: z.input<typeof validSlot>,
  confirmed: boolean,
): Promise<MoveResult> {
  const c = validSlot.safeParse(slot);
  if (!c.success) return { status: "refused", message: c.error.issues[0].message };
  const existing = await readCourse(tx, id);
  if (!existing) return { status: "refused", message: "Ce cours n’existe plus." };
  if (existing.recurrence === "dates")
    return { status: "refused", message: "Un cours à dates précises se modifie depuis sa fiche." };
  if (toMinutesEnd(c.data) > 24 * 60) return { status: "refused", message: "Le cours finirait après minuit." };
  const roomId = c.data.roomId ?? existing.roomId;
  if (roomId !== existing.roomId) {
    // Under RLS: a room of another school is not found (and the composite foreign key would refuse it).
    const [r] = await tx.select({ id: room.id }).from(room).where(eq(room.id, roomId));
    if (!r) return { status: "refused", message: "Cette salle n’existe plus." };
  }
  if (!confirmed) {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(DISTINCT ${enrollmentCourse.studentId})::int` })
      .from(enrollmentCourse)
      .innerJoin(sql`enrollment i`, sql`i.id = ${enrollmentCourse.enrollmentId} AND i.status IN ('active', 'trial')`)
      .where(eq(enrollmentCourse.courseId, id));
    if (n > 0) return { status: "confirm", enrolled: n };
  }
  await tx
    .update(course)
    .set({ weekday: c.data.weekday, startTime: c.data.startTime, durationMinutes: c.data.durationMinutes, roomId })
    .where(eq(course.id, id));
  return { status: "ok", id };
}

const toMinutesEnd = (c: { startTime: string; durationMinutes: number }) =>
  Number(c.startTime.slice(0, 2)) * 60 + Number(c.startTime.slice(3, 5)) + c.durationMinutes;
