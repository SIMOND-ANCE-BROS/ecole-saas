import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { rowsOf } from "./columns-of";
import type { Tx } from "./index";
import { seasonById, type Season } from "./schedule";
import { auditLog, course, discipline, instructor, member, room, season, site } from "./schema";
import { planSeasonCopy, type SeasonCopyPlan } from "../domain/schedule/season-copy";
import { courseRateAllowed, rateInCurrentUnit } from "../domain/payroll/rate";
import type { CourseRate } from "./courses";

/**
 * Copy of another season's planning (#190), always within the
 * `withSchool()` transaction (RLS): seasons, courses and instructors of
 * another school are invisible here.
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

/** Course columns a copy does not take from its source: its own id, school and season, and the old season's period. */
type NotCopied = "id" | "schoolId" | "seasonId" | "startDate" | "endDate";
type MustCopy = Exclude<keyof typeof course.$inferInsert, NotCopied>;

/**
 * Every other course column is copied as it is. Checked by the compiler: a
 * column added to `course` must be listed here or in `NotCopied`.
 */
const COPIED = {
  disciplineId: course.disciplineId,
  roomId: course.roomId,
  instructorId: course.instructorId,
  type: course.type,
  level: course.level,
  ageMin: course.ageMin,
  ageMax: course.ageMax,
  recurrence: course.recurrence,
  weekday: course.weekday,
  startTime: course.startTime,
  durationMinutes: course.durationMinutes,
  maxCapacity: course.maxCapacity,
  // Belongs to the course and its instructor, both copied (#191), with its unit (#268).
  instructorRateCents: course.instructorRateCents,
  instructorRatePayMode: course.instructorRatePayMode,
} satisfies { [K in MustCopy]: (typeof course)[K] };

async function coursesOf(tx: Tx, seasonId: string) {
  const rows = await tx
    .select({
      id: course.id,
      columns: COPIED,
      startDate: course.startDate,
      endDate: course.endDate,
      discipline: discipline.name,
      /** « Salle, Site » */
      room: sql<string>`${room.name} || ', ' || ${site.name}`,
      /** « Prénom Nom » */
      instructor: sql<string>`${instructor.firstName} || ' ' || ${instructor.lastName}`,
      instructorActive: instructor.active,
      instructorPayMode: instructor.payMode,
    })
    .from(course)
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(room, eq(room.id, course.roomId))
    .innerJoin(site, eq(site.id, room.siteId))
    .innerJoin(instructor, eq(instructor.id, course.instructorId))
    .where(eq(course.seasonId, seasonId))
    .orderBy(sql`${course.weekday} NULLS LAST`, course.startTime, discipline.name);
  // The fields the plan reads, next to the copied columns kept whole for the insert.
  return rows.map(({ instructorPayMode, ...r }) => {
    const { instructorRateCents: cents, instructorRatePayMode: unit } = r.columns;
    // A rate is carried over only in the unit of the instructor's current pay mode (#268): never
    // for a monthly flat instructor (#192), nor a rate of their older pay mode, kept as history
    // in its own season. Whether a rate should be carried at all is an open question (#192 Q4).
    const carried = rateInCurrentUnit(unit, instructorPayMode);
    const columns = carried ? r.columns : { ...r.columns, instructorRateCents: null, instructorRatePayMode: null };
    /** Rate of the instructor's older pay mode, not carried over: said on the copy screen. */
    const oldUnitRate: CourseRate | null =
      !carried && cents !== null && unit !== null && courseRateAllowed(instructorPayMode)
        ? { cents, payMode: unit }
        : null;
    return { ...r, columns, ...columns, oldUnitRate };
  });
}

export type CourseToCopy = Awaited<ReturnType<typeof coursesOf>>[number];

export type SeasonCopy =
  | { ok: false; message: string }
  | { ok: true; source: Season; target: Season; plan: SeasonCopyPlan<CourseToCopy>; targetCourses: number };

/** What copying `sourceId` into `targetId` would do; both must be seasons of the school, and different. */
export async function seasonCopyPlan(tx: Tx, sourceId: unknown, targetId: unknown): Promise<SeasonCopy> {
  const target = await seasonById(tx, targetId);
  if (!target) return { ok: false, message: "Cette saison n’existe plus." };
  const source = await seasonById(tx, sourceId);
  if (!source) return { ok: false, message: "Choisissez la saison à copier." };
  if (source.id === target.id) return { ok: false, message: "Choisissez une autre saison que celle à remplir." };
  const already = await coursesOf(tx, target.id);
  const plan = planSeasonCopy(await coursesOf(tx, source.id), already);
  return { ok: true, source, target, plan, targetCourses: already.length };
}

/** Number of courses of each season of the school. */
export async function courseCountBySeason(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx
    .select({ seasonId: course.seasonId, n: sql<number>`count(*)::int` })
    .from(course)
    .groupBy(course.seasonId);
  return new Map(rows.map((r) => [r.seasonId, r.n]));
}

/**
 * Creates the planned courses in the target season, each one written to the
 * audit log with the course it was copied from. The plan is computed again
 * here, never taken from the browser. The target season is locked, so two
 * copies at once cannot both add the same courses. Lessons are generated by
 * the caller (`syncLessons`), as for a course created by hand.
 */
export async function copySeason(
  tx: Tx,
  userId: string,
  sourceId: unknown,
  targetId: unknown,
): Promise<{ ok: true; target: Season; copied: number } | { ok: false; message: string }> {
  const [who] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true), eq(member.role, "director")));
  if (!who) return { ok: false, message: "Accès refusé." };
  const target = await seasonById(tx, targetId);
  if (target) await tx.select({ id: season.id }).from(season).where(eq(season.id, target.id)).for("update");
  const r = await seasonCopyPlan(tx, sourceId, targetId);
  if (!r.ok) return r;
  const { copied } = r.plan;
  if (copied.length === 0) return { ok: false, message: "Aucun cours à copier." };
  // Ids chosen here: each audit entry names its course without relying on the order of RETURNING.
  const rows = copied.map((c) => ({ id: randomUUID(), from: c.id, columns: c.columns }));
  await tx.insert(course).values(
    rowsOf(
      course,
      rows.map((x) => ({ ...x.columns, id: x.id, schoolId: CURRENT_SCHOOL, seasonId: r.target.id })),
    ),
  );
  await tx.insert(auditLog).values(
    rowsOf(
      auditLog,
      rows.map((x) => ({
        schoolId: CURRENT_SCHOOL,
        actor: who.id,
        targetTable: "course",
        rowId: x.id,
        action: "insert",
        after: { ...x.columns, seasonId: r.target.id, copiedFrom: x.from },
      })),
    ),
  );
  return { ok: true, target: r.target, copied: rows.length };
}
