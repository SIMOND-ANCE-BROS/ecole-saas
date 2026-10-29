import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { columnsOf } from "./columns-of";
import { z } from "zod";
import { frenchList } from "../lib/french-list";
import { seasonBlocksPayModeChange } from "../domain/payroll/rate";
import { deleteConnection } from "./calendar-connections";
import type { Tx } from "./index";
import { auditLog, course, instructor, member, season } from "./schema";

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

/** Instructors (teachers), always within the `withSchool()` transaction (RLS). */

export const STATUSES = { sole_trader: "Micro-entreprise", company: "Société", employee: "Salarié" } as const;
export const VAT_REGIMES = {
  franchise_293b: "Franchise en base (293 B)",
  vat_registered: "Assujetti à la TVA",
  not_applicable: "Non applicable",
} as const;
export const PAY_MODES = {
  hourly: "à l’heure",
  per_lesson: "à la séance",
  monthly_flat: "forfait mensuel",
} as const;
/** Rate unit according to the pay mode. */
export { PAY_UNITS } from "../domain/payroll/rate-field";

const keys = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const validInstructorInput = z.object({
  firstName: z.string().trim().min(1, "Prénom obligatoire").max(100),
  name: z.string().trim().min(1, "Nom obligatoire").max(100),
  email: z.union([z.literal(""), z.email("E-mail invalide")]).transform((v) => v || null),
  status: z.enum(keys(STATUSES)),
  siren: z
    .string()
    .transform((v) => v.replace(/\s/g, ""))
    .refine((v) => v === "" || /^\d{9}$/.test(v), "Le SIREN compte 9 chiffres")
    .transform((v) => v || null),
  vatRegime: z.enum(keys(VAT_REGIMES)),
  isOwner: z.boolean(),
  payMode: z.enum(keys(PAY_MODES)),
  rateCents: z.int().min(0).max(100_000_00),
  active: z.boolean(),
});

export type InstructorInput = z.output<typeof validInstructorInput>;
export type Instructor = InstructorInput & { id: string };

/** Instructor columns from the form input. */
const instructorRow = (s: InstructorInput) => ({
  firstName: s.firstName,
  lastName: s.name,
  email: s.email,
  status: s.status,
  siren: s.siren,
  vatRegime: s.vatRegime,
  isOwner: s.isOwner,
  payMode: s.payMode,
  rateCents: s.rateCents,
  active: s.active,
});

const columns = {
  id: instructor.id,
  firstName: instructor.firstName,
  name: instructor.lastName,
  email: instructor.email,
  status: instructor.status,
  siren: instructor.siren,
  vatRegime: instructor.vatRegime,
  isOwner: instructor.isOwner,
  payMode: instructor.payMode,
  rateCents: instructor.rateCents,
  active: instructor.active,
};

/** Courses of a season taught by the instructor (main instructor of the course). */
const seasonCourses = (seasonId: string) => sql<number>`(
  SELECT count(*)::int FROM course c
  WHERE c.instructor_id = ${instructor}.${sql.identifier("id")} AND c.season_id = ${seasonId}
)`;

/** Active first, then by last and first name. */
export function listInstructors(tx: Tx, seasonId: string): Promise<(Instructor & { seasonCourses: number })[]> {
  return tx
    .select({ ...columns, seasonCourses: seasonCourses(seasonId) })
    .from(instructor)
    .orderBy(desc(instructor.active), asc(instructor.lastName), asc(instructor.firstName));
}

export async function readInstructor(tx: Tx, id: string): Promise<Instructor | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [i] = await tx.select(columns).from(instructor).where(eq(instructor.id, id));
  return i ?? null;
}

export async function createInstructor(tx: Tx, entry: InstructorInput): Promise<string> {
  const [{ id }] = await tx
    .insert(instructor)
    .values(
      columnsOf(instructor, {
        ...instructorRow(entry),
        schoolId: sql`nullif(current_setting('app.school_id', true), '')::uuid`,
      }),
    )
    .returning({ id: instructor.id });
  return id;
}

/**
 * Refused if the instructor does not exist in the current school, or if the
 * pay mode changes while courses of the current or a future season carry their
 * own rate for them (#191): such a rate is in the unit of the old pay mode.
 * Rates of past seasons are kept untouched as history and do not block
 * (#192 Q5, recommended rule pending the school's validation). `today` is a
 * `YYYY-MM-DD` date in Paris (`todayInParis()`).
 *
 * A change of pay mode or rate is kept in the audit log, by `userId` when
 * given: the monthly statement flags a month whose rates changed (#285).
 */
export async function updateInstructor(
  tx: Tx,
  id: string,
  entry: InstructorInput,
  today: string,
  userId: string | null = null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const gone = { ok: false as const, message: "Cet intervenant n’existe plus." };
  if (!z.uuid().safeParse(id).success) return gone;
  // Locked: a course rate saved meanwhile (FOR SHARE in courses.ts) waits, or makes this check see it.
  const [current] = await tx
    .select({ payMode: instructor.payMode, rateCents: instructor.rateCents })
    .from(instructor)
    .where(eq(instructor.id, id))
    .for("update");
  if (!current) return gone;
  if (current.payMode !== entry.payMode) {
    const rated = await tx
      .select({ season: season.label, seasonEndDate: season.endDate })
      .from(course)
      .innerJoin(season, eq(season.id, course.seasonId))
      .where(and(eq(course.instructorId, id), isNotNull(course.instructorRateCents)))
      .orderBy(asc(season.startDate));
    const blocking = rated.filter((r) => seasonBlocksPayModeChange(r.seasonEndDate, today));
    const n = blocking.length;
    if (n > 0) {
      const seasons = [...new Set(blocking.map((r) => r.season))];
      const of = `${seasons.length > 1 ? "des saisons" : "de la saison"} ${frenchList(seasons)}`;
      return {
        ok: false,
        message:
          n > 1
            ? `${n} cours ${of} ont un tarif propre pour cet intervenant : videz ces tarifs dans les fiches des cours avant de changer son mode de rémunération.`
            : `1 cours ${of} a un tarif propre pour cet intervenant : videz ce tarif dans la fiche du cours avant de changer son mode de rémunération.`,
      };
    }
  }
  // Deactivating an instructor also cuts off their subscription and connected calendar.
  const cutoff = entry.active ? {} : { calendarTokenHash: null, calendarTokenCreatedAt: null };
  const rows = await tx
    .update(instructor)
    .set(columnsOf(instructor, { ...instructorRow(entry), ...cutoff }))
    .where(eq(instructor.id, id))
    .returning({ id: instructor.id });
  if (rows.length !== 1) return gone;
  if (!entry.active) await deleteConnection(tx, id);
  if (current.payMode !== entry.payMode || current.rateCents !== entry.rateCents) {
    const [who] = userId ? await tx.select({ id: member.id }).from(member).where(eq(member.userId, userId)) : [];
    await tx.insert(auditLog).values({
      schoolId: CURRENT_SCHOOL,
      actor: who?.id ?? null,
      targetTable: "instructor",
      rowId: id,
      action: "update",
      before: { payMode: current.payMode, rateCents: current.rateCents },
      after: { payMode: entry.payMode, rateCents: entry.rateCents },
    });
  }
  return { ok: true };
}
