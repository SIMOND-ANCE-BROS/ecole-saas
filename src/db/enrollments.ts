import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { computeTariff } from "../domain/tariff/compute";
import type {
  ChosenCourse,
  EnrollmentRequest,
  TariffRow,
  Period,
  Public,
  DiscountRule,
  EnrollmentResult,
} from "../domain/tariff/types";
import type { Tx } from "./index";
import { payableStudents } from "./people";
import { course, discipline, enrollment, enrollmentCourse, person, discount, tariff } from "./schema";

/**
 * Enrollments: loading the school's data, validating the input,
 * computing with the (pure) tariff engine and saving. Always within the
 * `withSchool()` transaction: RLS limits everything to the current school.
 */

export type EnrollmentInput = {
  studentIds: string[];
  audience: Public;
  period: Period;
  courseIds: string[];
};

const NEW = "nouvelle";
const uuid = z.uuid();

export async function loadGrid(tx: Tx, seasonId: string): Promise<TariffRow[]> {
  return tx
    .select({
      id: tariff.id,
      audience: tariff.audience,
      period: tariff.period,
      combination: tariff.combination,
      disciplineId: tariff.disciplineId,
      priceCents: tariff.priceCents,
    })
    .from(tariff)
    .where(eq(tariff.seasonId, seasonId));
}

export async function loadDiscounts(tx: Tx, seasonId: string): Promise<DiscountRule[]> {
  return tx
    .select({
      code: discount.code,
      rateBps: discount.rateBps,
      amountCents: discount.amountCents,
      minStudents: discount.minStudents,
      audiences: discount.audiences,
      combinableWithMultiDiscipline: discount.combinableWithMultiDiscipline,
    })
    .from(discount)
    .where(eq(discount.seasonId, seasonId));
}

type Existing = EnrollmentRequest & { savedDeposit: number };

/** Active enrollments of the payer for the season, in the shape expected by the engine. */
async function existingEnrollments(tx: Tx, payerId: string, seasonId: string): Promise<Existing[]> {
  const rows = await tx
    .select({
      id: enrollment.id,
      audience: enrollment.audience,
      period: enrollment.period,
      deposit: enrollment.discountCents,
    })
    .from(enrollment)
    .where(and(eq(enrollment.payerId, payerId), eq(enrollment.seasonId, seasonId), eq(enrollment.status, "active")));
  if (rows.length === 0) return [];

  const relationships = await tx
    .select({
      enrollmentId: enrollmentCourse.enrollmentId,
      studentId: enrollmentCourse.studentId,
      courseId: enrollmentCourse.courseId,
      disciplineId: course.disciplineId,
      durationMinutes: course.durationMinutes,
    })
    .from(enrollmentCourse)
    .innerJoin(course, eq(course.id, enrollmentCourse.courseId))
    .where(
      inArray(
        enrollmentCourse.enrollmentId,
        rows.map((l) => l.id),
      ),
    );

  return rows.map((l) => {
    const own = relationships.filter((x) => x.enrollmentId === l.id);
    const uniqueCourses = new Map(
      own.map((x) => [x.courseId, { disciplineId: x.disciplineId, durationMinutes: x.durationMinutes }]),
    );
    return {
      reference: l.id,
      studentIds: [...new Set(own.map((x) => x.studentId))],
      audience: l.audience,
      period: l.period,
      courses: [...uniqueCourses.values()],
      savedDeposit: l.deposit,
    };
  });
}

/** Payer's students and the season's courses actually chosen; otherwise the reason for refusal. */
async function validate(
  tx: Tx,
  payerId: string,
  seasonId: string,
  saisie: EnrollmentInput,
): Promise<string | ChosenCourse[]> {
  const studentIds = [...new Set(saisie.studentIds)];
  const courseIds = [...new Set(saisie.courseIds)];
  if (saisie.audience === "couple" && studentIds.length !== 2) return "Un couple réunit deux danseurs.";
  if (saisie.audience !== "couple" && studentIds.length !== 1)
    return "Une inscription individuelle concerne un seul danseur.";
  if (![...studentIds, ...courseIds].every((id) => uuid.safeParse(id).success)) return "Saisie invalide.";

  const payables = new Set((await payableStudents(tx, payerId)).map((d) => d.id));
  if (!studentIds.every((id) => payables.has(id)))
    return "Cette personne ne paie pas pour ce danseur : ajoutez le lien « paie pour » sur sa fiche.";

  if (courseIds.length === 0) return [];
  const chosen = await tx
    .select({ disciplineId: course.disciplineId, durationMinutes: course.durationMinutes })
    .from(course)
    .where(and(inArray(course.id, courseIds), eq(course.seasonId, seasonId)));
  if (chosen.length !== courseIds.length) return "Un des cours ne fait pas partie de la saison.";
  return chosen;
}

/** An already saved enrollment whose discount would change with the new one (e.g. siblings). */
export type ExistingImpact = {
  reference: string;
  students: string;
  savedDeposit: number;
  recalculatedDiscount: number;
};

export type Preview =
  | { status: "invalide"; message: string }
  | { status: "ok"; newEnrollment: EnrollmentResult; existingImpacts: ExistingImpact[] };

/** Price of the new enrollment, computed with the grid, the discounts and the payer's other enrollments. */
export async function enrollmentPreview(
  tx: Tx,
  payerId: string,
  seasonId: string,
  saisie: EnrollmentInput,
): Promise<Preview> {
  const chosenCourses = await validate(tx, payerId, seasonId, saisie);
  if (typeof chosenCourses === "string") return { status: "invalide", message: chosenCourses };

  const grid = await loadGrid(tx, seasonId);
  const discounts = await loadDiscounts(tx, seasonId);
  const existing = await existingEnrollments(tx, payerId, seasonId);
  const result = computeTariff({
    grid,
    discounts,
    enrollments: [
      ...existing,
      {
        reference: NEW,
        studentIds: saisie.studentIds,
        audience: saisie.audience,
        period: saisie.period,
        courses: chosenCourses,
      },
    ],
  });

  const firstNames = new Map((await payableStudents(tx, payerId)).map((d) => [d.id, d.firstName]));
  const other = existing.flatMap((e): ExistingImpact[] => {
    const r = result.enrollments.find((i) => i.reference === e.reference);
    const recalculatedDiscount = r?.status === "ok" ? r.discountCents : e.savedDeposit;
    if (recalculatedDiscount === e.savedDeposit) return [];
    const students = e.studentIds.map((id) => firstNames.get(id) ?? "?").join(" et ");
    return [{ reference: e.reference, students, savedDeposit: e.savedDeposit, recalculatedDiscount }];
  });

  return { status: "ok", newEnrollment: result.enrollments.find((i) => i.reference === NEW)!, existingImpacts: other };
}

/** Saves the enrollment at the price recomputed here (never the one sent by the browser). */
export async function saveEnrollment(
  tx: Tx,
  payerId: string,
  seasonId: string,
  saisie: EnrollmentInput,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const preview = await enrollmentPreview(tx, payerId, seasonId, saisie);
  if (preview.status === "invalide") return { ok: false, message: preview.message };
  const r = preview.newEnrollment;
  if (r.status === "erreur") return { ok: false, message: r.error.message };

  const [{ id }] = await tx
    .insert(enrollment)
    .values({
      schoolId: sql`nullif(current_setting('app.school_id', true), '')::uuid`,
      payerId: payerId,
      seasonId: seasonId,
      tariffId: r.tariffRowId,
      audience: saisie.audience,
      period: saisie.period,
      grossPriceCents: r.grossPriceCents,
      discountCents: r.discountCents,
      discounts: r.discounts.filter((d) => d.status === "appliquee").map((d) => d.code),
    })
    .returning({ id: enrollment.id });

  const studentIds = [...new Set(saisie.studentIds)];
  const courseIds = [...new Set(saisie.courseIds)];
  if (courseIds.length > 0) {
    await tx.insert(enrollmentCourse).values(
      studentIds.flatMap((studentId) =>
        courseIds.map((courseId) => ({
          schoolId: sql`nullif(current_setting('app.school_id', true), '')::uuid`,
          enrollmentId: id,
          studentId: studentId,
          courseId: courseId,
        })),
      ),
    );
  }
  return { ok: true, id };
}

export type PaidEnrollment = {
  id: string;
  students: string;
  audience: Public;
  period: Period;
  courses: string[];
  netPriceCents: number;
};

/** Active enrollments paid by a person for the season, sorted by student. */
export async function enrollmentsPayeesBy(tx: Tx, payerId: string, seasonId: string): Promise<PaidEnrollment[]> {
  const rows = await tx
    .select({
      id: enrollment.id,
      audience: enrollment.audience,
      period: enrollment.period,
      netPriceCents: enrollment.netPriceCents,
    })
    .from(enrollment)
    .where(and(eq(enrollment.payerId, payerId), eq(enrollment.seasonId, seasonId), eq(enrollment.status, "active")));
  if (rows.length === 0) return [];

  const relationships = await tx
    .select({
      enrollmentId: enrollmentCourse.enrollmentId,
      firstName: sql<string>`coalesce(${person.firstName}, ${person.lastName})`,
      discipline: discipline.name,
      day: course.weekday,
      heure: course.startTime,
    })
    .from(enrollmentCourse)
    .innerJoin(person, eq(person.id, enrollmentCourse.studentId))
    .innerJoin(course, eq(course.id, enrollmentCourse.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .where(
      inArray(
        enrollmentCourse.enrollmentId,
        rows.map((l) => l.id),
      ),
    )
    .orderBy(asc(course.weekday), asc(course.startTime));

  const DAYS = ["", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
  return rows
    .map((l) => {
      const own = relationships.filter((x) => x.enrollmentId === l.id);
      return {
        id: l.id,
        audience: l.audience,
        period: l.period,
        netPriceCents: l.netPriceCents ?? 0,
        students: [...new Set(own.map((x) => x.firstName))].sort().join(" et "),
        courses: [
          ...new Set(
            own.map((x) => `${x.discipline} ${x.day ? DAYS[x.day] : ""} ${x.heure.slice(0, 5)}`.replace("  ", " ")),
          ),
        ],
      };
    })
    .sort((a, b) => a.students.localeCompare(b.students, "fr"));
}
