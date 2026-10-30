import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { rowsOf } from "./columns-of";
import { discardDrafts, draftsBillingEnrollment, UNSENT_DRAFT } from "./invoice-draft-discard";
import { z } from "zod";
import { discountImpacts } from "../domain/enrollment/impacts";
import { alreadyTaken, duplicateRefusal, TAKEN_STATUSES, type TakenCourse } from "../domain/enrollment/duplicates";
import {
  cancelRefusal,
  confirmationPrice,
  countsAsSibling,
  dropDateBounds,
  dropDateRefusal,
  enrollmentActions,
  SIBLING_STATUSES,
  transitionRefusal,
  type EnrollmentActions,
  type InitialStatus,
} from "../domain/enrollment/lifecycle";
import {
  keptManualPrice,
  manualPriceRefusal,
  MAX_PRICE_CENTS,
  MAX_REASON_LENGTH,
  savedNetPrice,
  type ManualPrice,
} from "../domain/enrollment/manual-price";
import { STATUS_PRIORITY, type EnrollmentStatus } from "../domain/enrollment/statuses";
import {
  coveredQuarters,
  quarterEnrollmentRefusal,
  seasonDueCents,
  type SeasonQuarter,
} from "../domain/enrollment/quarters";
import { todayInParis } from "../domain/people/age";
import { has } from "../lib/has";
import { computeTariff } from "../domain/tariff/compute";
import { requestsByEntity, type EntityCourse } from "../domain/enrollment/entities";
import type {
  EnrollmentRequest,
  TariffRow,
  Period,
  Audience,
  DiscountRule,
  EnrollmentResult,
} from "../domain/tariff/types";
import { severalEntities } from "./billing-entities";
import type { Tx } from "./index";
import { paysForNonStudent, NOT_A_STUDENT_YET, payableStudents } from "./people";
import {
  auditLog,
  billingEntity,
  course,
  discipline,
  enrollment,
  enrollmentCourse,
  member,
  person,
  discount,
  enrollmentQuarter,
  season,
  seasonQuarter,
  tariff,
} from "./schema";

/**
 * Enrollments: loading the school's data, validating the input,
 * computing with the (pure) tariff engine and saving. Always within the
 * `withSchool()` transaction: RLS limits everything to the current school.
 */

export type EnrollmentInput = {
  studentIds: string[];
  audience: Audience;
  period: Period;
  courseIds: string[];
  /** « Inscrit » by default; « À l’essai » or « En attente » for a family not committed yet (#284). */
  status?: InitialStatus;
  /**
   * Prices typed by the front desk (#292), at most one per business of the new enrollments
   * (#299): it replaces the computed price of that business's enrollment, with a reason.
   */
  manualPrices?: ManualPriceEntry[];
  /**
   * The front desk confirmed enrolling a student again in a course they already take this
   * season (#333): without it, such an enrollment is held back (`duplicateRefusal`).
   */
  duplicatesConfirmed?: boolean;
};

/** A typed price for the new enrollment of one business (#292). */
export type ManualPriceEntry = ManualPrice & { billingEntityId: string };

/** What the form may send as typed prices; the rules are in `manualPriceRefusal`. */
export const validManualPrices = z
  .array(
    z.object({
      billingEntityId: z.uuid(),
      priceCents: z.int().min(0).max(MAX_PRICE_CENTS),
      reason: z.string().max(MAX_REASON_LENGTH * 2),
    }),
  )
  .max(10);

/** A typed price for a business none of the chosen courses belongs to any more. */
export const STALE_MANUAL_PRICE = "Un prix saisi ne correspond plus aux cours choisis : vérifiez-le.";

const uuid = z.uuid();
const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

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

/** `manual`: its price was typed by hand (#292), so a change of its discount changes nothing it costs. */
type Existing = EnrollmentRequest & { savedDeposit: number; manual: boolean };

/**
 * Enrollments of the payer for the season counted as siblings (`SIBLING_STATUSES`, #284 Q3),
 * in the shape expected by the engine; `except` leaves one out (the one being changed).
 */
async function existingEnrollments(tx: Tx, payerId: string, seasonId: string, except?: string): Promise<Existing[]> {
  const rows = await tx
    .select({
      id: enrollment.id,
      audience: enrollment.audience,
      period: enrollment.period,
      deposit: enrollment.discountCents,
      manual: sql<boolean>`${enrollment.manualPriceCents} IS NOT NULL`,
    })
    .from(enrollment)
    .where(
      and(
        eq(enrollment.payerId, payerId),
        eq(enrollment.seasonId, seasonId),
        inArray(enrollment.status, [...SIBLING_STATUSES]),
        except ? ne(enrollment.id, except) : undefined,
      ),
    );
  return withCourses(tx, rows);
}

/** Saved enrollments with their students and courses, as requests to the engine. */
async function withCourses(
  tx: Tx,
  rows: { id: string; audience: Audience; period: Period; deposit: number; manual: boolean }[],
): Promise<Existing[]> {
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
      manual: l.manual,
    };
  });
}

/**
 * Locks the payer's row until the end of the transaction: two changes to the same payer's
 * enrollments (two siblings enrolled or confirmed at the same moment) are priced one after
 * the other, each seeing the other's result in its siblings discount.
 */
async function lockPayer(tx: Tx, payerId: string) {
  await tx.select({ id: person.id }).from(person).where(eq(person.id, payerId)).for("no key update");
}

/** Payer's students and the season's courses actually chosen, with their entity; otherwise the reason for refusal. */
async function validate(
  tx: Tx,
  payerId: string,
  seasonId: string,
  entry: EnrollmentInput,
): Promise<string | EntityCourse[]> {
  const studentIds = [...new Set(entry.studentIds)];
  const courseIds = [...new Set(entry.courseIds)];
  if (entry.audience === "couple" && studentIds.length !== 2) return "Un couple réunit deux danseurs.";
  if (entry.audience !== "couple" && studentIds.length !== 1)
    return "Une inscription individuelle concerne un seul danseur.";
  if (![...studentIds, ...courseIds].every((id) => uuid.safeParse(id).success)) return "Saisie invalide.";

  const payables = new Set((await payableStudents(tx, payerId)).map((d) => d.id));
  if (!studentIds.every((id) => payables.has(id)))
    return (await paysForNonStudent(tx, payerId, studentIds))
      ? NOT_A_STUDENT_YET
      : "Cette personne ne paie pas pour ce danseur : ajoutez le lien « paie pour » sur sa fiche.";

  if (courseIds.length === 0) return [];
  const chosen = await tx
    .select({
      courseId: course.id,
      billingEntityId: course.billingEntityId,
      disciplineId: course.disciplineId,
      durationMinutes: course.durationMinutes,
    })
    .from(course)
    .where(and(inArray(course.id, courseIds), eq(course.seasonId, seasonId)))
    // A course whose entity is being changed at the same moment (FOR UPDATE, updateCourse) is
    // read once that change is committed: the enrollment then takes its new entity, never one
    // the foreign keys would refuse at insert.
    .for("key share");
  if (chosen.length !== courseIds.length) return "Un des cours ne fait pas partie de la saison.";
  // In the order chosen: the courses of each entity keep it.
  return courseIds.flatMap((id) => chosen.filter((c) => c.courseId === id));
}

/**
 * Courses of the season the students take (#333), through any enrollment whose status
 * means they take it (`TAKEN_STATUSES`: not a dropped or ended one), whoever pays for it.
 */
export async function takenCourses(tx: Tx, studentIds: string[], seasonId: string): Promise<TakenCourse[]> {
  const students = studentIds.filter((id) => uuid.safeParse(id).success);
  if (students.length === 0 || !uuid.safeParse(seasonId).success) return [];
  return tx
    .select({ studentId: enrollmentCourse.studentId, courseId: enrollmentCourse.courseId, status: enrollment.status })
    .from(enrollmentCourse)
    .innerJoin(enrollment, eq(enrollment.id, enrollmentCourse.enrollmentId))
    .where(
      and(
        inArray(enrollmentCourse.studentId, students),
        eq(enrollment.seasonId, seasonId),
        inArray(enrollment.status, [...TAKEN_STATUSES]),
      ),
    )
    .orderBy(asc(enrollment.enrolledOn));
}

/** An already saved enrollment whose discount would change with the new one (e.g. siblings). */
export type ExistingImpact = {
  reference: string;
  students: string;
  savedDeposit: number;
  recalculatedDiscount: number;
};

/** One of the enrollments a submission creates: one per business selling the chosen courses (#299). */
export type NewEnrollment = {
  billingEntityId: string;
  /** Short name of the business, shown when the school has several. */
  entity: string;
  /** Ids of its courses, among the chosen ones. */
  courseIds: string[];
  price: EnrollmentResult;
};

export type Preview =
  | { status: "invalid"; message: string }
  | {
      status: "ok";
      /** One per entity, the default first; a single one when every course is sold by the same business. */
      newEnrollments: NewEnrollment[];
      existingImpacts: ExistingImpact[];
      /**
       * Quarters a quarterly enrollment made today covers (#291), in date order: each new
       * enrollment owes its net price once per quarter. Empty for any other period.
       */
      quarters: SeasonQuarter[];
    };

/**
 * Quarters of the season (#291), in date order. The season row is read FOR KEY SHARE, which
 * waits for a quarters save (`saveSeasonQuarters`, FOR UPDATE) to commit: the quarters an
 * enrollment covers are never ones being removed.
 */
async function quartersOf(tx: Tx, seasonId: string): Promise<SeasonQuarter[]> {
  await tx.select({ id: season.id }).from(season).where(eq(season.id, seasonId)).for("key share");
  return tx
    .select({
      id: seasonQuarter.id,
      label: seasonQuarter.label,
      startDate: seasonQuarter.startDate,
      endDate: seasonQuarter.endDate,
    })
    .from(seasonQuarter)
    .where(eq(seasonQuarter.seasonId, seasonId))
    .orderBy(asc(seasonQuarter.startDate));
}

/** The school's entities, the default first then by name: the order enrollments are split in. */
async function entitiesInOrder(tx: Tx): Promise<{ id: string; name: string }[]> {
  return tx
    .select({ id: billingEntity.id, name: billingEntity.name })
    .from(billingEntity)
    .orderBy(desc(billingEntity.isDefault), asc(billingEntity.name));
}

/**
 * Price of the new enrollments, computed with the grid, the discounts and the payer's
 * other enrollments. The chosen courses are split by the business that sells them, one
 * enrollment each, priced on its own combination (#288 Q3 default); siblings are counted
 * over every enrollment of the payer, whatever its business (#288 Q2 default). A quarterly
 * enrollment made on `today` covers the season's remaining quarters (#291), and is refused
 * when none is left.
 */
export async function enrollmentPreview(
  tx: Tx,
  payerId: string,
  seasonId: string,
  entry: EnrollmentInput,
  today: string = todayInParis(),
): Promise<Preview> {
  const chosenCourses = await validate(tx, payerId, seasonId, entry);
  if (typeof chosenCourses === "string") return { status: "invalid", message: chosenCourses };
  let quarters: SeasonQuarter[] = [];
  if (entry.period === "quarter") {
    const all = await quartersOf(tx, seasonId);
    const refusal = quarterEnrollmentRefusal(all, today);
    if (refusal) return { status: "invalid", message: refusal };
    quarters = coveredQuarters(all, today);
  }

  const entities = await entitiesInOrder(tx);
  // References of the new requests are entity ids, never an enrollment id of `existing`.
  const requests = requestsByEntity(
    entry,
    chosenCourses,
    entities.map((e) => e.id),
  );
  const grid = await loadGrid(tx, seasonId);
  const discounts = await loadDiscounts(tx, seasonId);
  const existing = await existingEnrollments(tx, payerId, seasonId);
  const result = computeTariff({ grid, discounts, enrollments: [...existing, ...requests] });

  return {
    status: "ok",
    newEnrollments: requests.map((r) => ({
      billingEntityId: r.reference,
      entity: entities.find((e) => e.id === r.reference)?.name ?? "",
      courseIds: chosenCourses.filter((c) => c.billingEntityId === r.reference).map((c) => c.courseId),
      // The engine returns one result per request, each new one included.
      price: result.enrollments.find((i) => i.reference === r.reference)!,
    })),
    // A trial or waitlist enrollment does not count as a sibling (Q3): the others' discounts stay as they are.
    existingImpacts: countsAsSibling(entry.status ?? "active") ? await impactsOn(tx, existing, result.enrollments) : [],
    quarters,
  };
}

/** Q2 (#284): the payer's saved enrollments whose discount would change, named by their students' first names. */
async function impactsOn(tx: Tx, existing: Existing[], recomputed: EnrollmentResult[]): Promise<ExistingImpact[]> {
  const impacts = discountImpacts(
    // A typed price is final (#292 Q2): its discount moving changes nothing to report.
    existing.filter((e) => !e.manual).map((e) => ({ reference: e.reference, savedDiscountCents: e.savedDeposit })),
    recomputed,
  );
  if (impacts.length === 0) return [];
  // Named after the students the enrollments hold, even one no longer marked as a student (#314).
  const ids = [...new Set(existing.flatMap((e) => e.studentIds))];
  const named = ids.length
    ? await tx
        .select({ id: person.id, firstName: person.firstName, name: person.lastName })
        .from(person)
        .where(inArray(person.id, ids))
    : [];
  const firstNames = new Map(named.map((d) => [d.id, d.firstName ?? d.name]));
  return impacts.map((i) => ({
    reference: i.reference,
    students: (existing.find((e) => e.reference === i.reference)?.studentIds ?? [])
      .map((id) => firstNames.get(id) ?? "?")
      .join(" et "),
    savedDeposit: i.savedDiscountCents,
    recalculatedDiscount: i.recalculatedDiscountCents,
  }));
}

/**
 * Saves the enrollments at the prices recomputed here (never the ones sent by the
 * browser): one per business selling the chosen courses (#299), all or none. `id` is
 * the first (the default entity's when it sells one of the courses), `ids` all of them.
 * A price typed by the front desk (#292) replaces the computed one of its business's
 * enrollment, with a reason, or prices a combination the grid has no package for. Each
 * enrollment is dated `today` and, when quarterly, covers the season's remaining quarters
 * (#291). A student enrolled again in a course they already take this season is held back
 * until the front desk confirms it (#333, `duplicateRefusal`). Each is written to the audit
 * log (technical ids, amounts and the typed reason).
 */
export async function saveEnrollment(
  tx: Tx,
  userId: string,
  payerId: string,
  seasonId: string,
  entry: EnrollmentInput,
  today: string = todayInParis(),
): Promise<{ ok: true; id: string; ids: string[] } | { ok: false; message: string }> {
  const typed = validManualPrices.safeParse(entry.manualPrices ?? []);
  if (!uuid.safeParse(payerId).success || !typed.success) return { ok: false, message: "Saisie invalide." };
  if (new Set(typed.data.map((m) => m.billingEntityId)).size !== typed.data.length)
    return { ok: false, message: "Saisie invalide." };
  await lockPayer(tx, payerId);
  const preview = await enrollmentPreview(tx, payerId, seasonId, entry, today);
  if (preview.status === "invalid") return { ok: false, message: preview.message };
  if (!typed.data.every((m) => preview.newEnrollments.some((n) => n.billingEntityId === m.billingEntityId)))
    return { ok: false, message: STALE_MANUAL_PRICE };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };

  const several = preview.newEnrollments.length > 1;
  const named = (n: NewEnrollment, message: string) => ({
    ok: false as const,
    message: several ? `${n.entity} : ${message}` : message,
  });
  const priced: { n: NewEnrollment; manual: ManualPrice | null }[] = [];
  for (const n of preview.newEnrollments) {
    const m = typed.data.find((x) => x.billingEntityId === n.billingEntityId);
    const manual = m ? { priceCents: m.priceCents, reason: m.reason } : null;
    // Only a missing package is priced by hand; an enrollment without a course stays refused.
    if (n.price.status === "error" && (manual === null || n.price.error.code !== "missing_combination"))
      return named(n, n.price.error.message);
    const computedNetCents = n.price.status === "ok" ? n.price.netPriceCents : null;
    const refusal = manualPriceRefusal({ computedNetCents, manual }, who.role);
    if (refusal) return named(n, refusal);
    priced.push({ n, manual: keptManualPrice(computedNetCents, manual) });
  }

  // Once the entry is otherwise valid: a course a student already takes is confirmed last (#333).
  const studentIds = [...new Set(entry.studentIds)];
  const duplicates = alreadyTaken(
    studentIds,
    preview.newEnrollments.flatMap((n) => n.courseIds),
    await takenCourses(tx, studentIds, seasonId),
  );
  const duplicate = duplicateRefusal(duplicates.length, entry.duplicatesConfirmed === true);
  if (duplicate) return { ok: false, message: duplicate };

  const status = entry.status ?? "active";
  const ids: string[] = [];
  for (const { n, manual } of priced) {
    const r = n.price;
    // Without a package (checked above: a price is then typed), the typed price and no discount.
    const price =
      r.status === "ok"
        ? {
            tariffId: r.tariffRowId,
            grossPriceCents: r.grossPriceCents,
            discountCents: r.discountCents,
            discounts: r.discounts.filter((d) => d.status === "applied").map((d) => d.code),
          }
        : { tariffId: null, grossPriceCents: manual?.priceCents ?? 0, discountCents: 0, discounts: [] };
    const [{ id }] = await tx
      .insert(enrollment)
      .values({
        schoolId: CURRENT_SCHOOL,
        billingEntityId: n.billingEntityId,
        payerId: payerId,
        seasonId: seasonId,
        status,
        tariffId: price.tariffId,
        audience: entry.audience,
        period: entry.period,
        enrolledOn: today,
        grossPriceCents: price.grossPriceCents,
        discountCents: price.discountCents,
        discounts: price.discounts,
        manualPriceCents: manual?.priceCents ?? null,
        priceReason: manual?.reason ?? null,
      })
      .returning({ id: enrollment.id });
    ids.push(id);
    if (preview.quarters.length > 0)
      await tx.insert(enrollmentQuarter).values(
        rowsOf(
          enrollmentQuarter,
          preview.quarters.map((q) => ({ schoolId: CURRENT_SCHOOL, enrollmentId: id, quarterId: q.id })),
        ),
      );
    await tx.insert(auditLog).values({
      schoolId: CURRENT_SCHOOL,
      actor: who.id,
      targetTable: "enrollment",
      rowId: id,
      action: "insert",
      // Technical ids and amounts; the reason is what the member typed for a price apart from the grid.
      after: {
        payerId,
        seasonId,
        billingEntityId: n.billingEntityId,
        status,
        studentIds,
        courseIds: n.courseIds,
        ...(preview.quarters.length > 0 ? { quarterIds: preview.quarters.map((q) => q.id) } : {}),
        grossPriceCents: price.grossPriceCents,
        discountCents: price.discountCents,
        ...(manual
          ? {
              manualPriceCents: manual.priceCents,
              computedNetPriceCents: r.status === "ok" ? r.netPriceCents : null,
              reason: manual.reason,
            }
          : {}),
      },
    });
    if (n.courseIds.length > 0) {
      await tx.insert(enrollmentCourse).values(
        rowsOf(
          enrollmentCourse,
          studentIds.flatMap((studentId) =>
            n.courseIds.map((courseId) => ({
              schoolId: CURRENT_SCHOOL,
              // The enrollment's entity: the foreign keys check it is also the course's.
              billingEntityId: n.billingEntityId,
              enrollmentId: id,
              studentId: studentId,
              courseId: courseId,
            })),
          ),
        ),
      );
    }
  }
  return { ok: true, id: ids[0], ids };
}

export type SeasonEnrollment = {
  id: string;
  /** Students' first names: « Zoé », « Léa et Hugo » (couple). */
  students: string;
  audience: Audience;
  period: Period;
  courses: string[];
  /** Its price: one quarter's for a quarterly package. */
  netPriceCents: number;
  /** Quarters a quarterly enrollment covers (#291), in date order; empty for any other period. */
  quarters: string[];
  /** Number of covered quarters, as the balance counts them (`seasonDueCents`). */
  quarterCount: number;
  /** What it costs over the season: its price once per covered quarter when quarterly (#291). */
  seasonDueCents: number;
  /** Reason of a price typed by hand (#292); null when the price is the grid's. */
  priceReason: string | null;
  status: EnrollmentStatus;
  droppedOn: string | null;
  enrolledOn: string;
  payerId: string;
  /** A line of an invoice handed to the tool refers to it: only a credit note can undo it. */
  invoiced: boolean;
  /** What the front desk can do with it (#284). */
  actions: EnrollmentActions;
  /** Business that sells it (#299); null when the school has only one. */
  entity: string | null;
  /** Why it cannot be cancelled, in French; null when it can. */
  cancelRefusal: string | null;
};

const enrollmentId = sql`${enrollment}.${sql.identifier("id")}`;

/** Number of quarters the enrollment of the row covers (#291): what `seasonDueCents` multiplies a quarterly price by. */
export const quarterCountSql = sql<number>`(SELECT count(*) FROM enrollment_quarter q WHERE q.enrollment_id = ${enrollmentId})::int`;

/**
 * A line of an invoice other than an unsent draft refers to the enrollment of the row. An
 * unsent draft (#302) never reached the tool: cancelling the enrollment throws the draft away.
 * A draft the outbox attempted (#304) may be in the tool: it counts as invoiced.
 */
const invoicedSql = sql<boolean>`EXISTS (SELECT 1 FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id
  WHERE l.enrollment_id = ${enrollmentId} AND NOT ${UNSENT_DRAFT})`;

/**
 * Attendance was taken for a student of the enrollment of the row in one of its courses,
 * and no other enrollment of that student covers that course (a duplicate entered by
 * mistake stays cancellable when the right one has the attendance).
 */
const attendedSql = sql<boolean>`EXISTS (
  SELECT 1 FROM enrollment_course c
  JOIN lesson s ON s.course_id = c.course_id
  JOIN attendance a ON a.lesson_id = s.id AND a.student_id = c.student_id
  WHERE c.enrollment_id = ${enrollmentId}
    AND NOT EXISTS (
      SELECT 1 FROM enrollment_course o
      WHERE o.student_id = c.student_id AND o.course_id = c.course_id AND o.enrollment_id <> c.enrollment_id
    )
)`;

/**
 * Enrollments of the season, every status, sorted by student: the ones a person pays for
 * (`payerId`), or also the ones they dance in (`personId`, for a student's record).
 */
export async function seasonEnrollments(
  tx: Tx,
  scope: { payerId: string } | { personId: string },
  seasonId: string,
): Promise<SeasonEnrollment[]> {
  const byPayer = has(scope, "payerId");
  const id = byPayer ? scope.payerId : scope.personId;
  if (!uuid.safeParse(id).success) return [];
  const mine = byPayer
    ? eq(enrollment.payerId, id)
    : or(
        eq(enrollment.payerId, id),
        sql`EXISTS (SELECT 1 FROM enrollment_course c WHERE c.enrollment_id = ${enrollment}.${sql.identifier("id")} AND c.student_id = ${id})`,
      );
  const rows = await tx
    .select({
      id: enrollment.id,
      audience: enrollment.audience,
      period: enrollment.period,
      netPriceCents: enrollment.netPriceCents,
      priceReason: enrollment.priceReason,
      status: enrollment.status,
      droppedOn: enrollment.droppedOn,
      enrolledOn: enrollment.enrolledOn,
      payerId: enrollment.payerId,
      invoiced: invoicedSql,
      attended: attendedSql,
      entity: billingEntity.name,
    })
    .from(enrollment)
    .innerJoin(billingEntity, eq(billingEntity.id, enrollment.billingEntityId))
    .where(and(mine, eq(enrollment.seasonId, seasonId)));
  if (rows.length === 0) return [];
  const namedEntity = await severalEntities(tx);
  const covered = await tx
    .select({ enrollmentId: enrollmentQuarter.enrollmentId, label: seasonQuarter.label })
    .from(enrollmentQuarter)
    .innerJoin(seasonQuarter, eq(seasonQuarter.id, enrollmentQuarter.quarterId))
    .where(
      inArray(
        enrollmentQuarter.enrollmentId,
        rows.map((l) => l.id),
      ),
    )
    .orderBy(asc(seasonQuarter.startDate));

  const relationships = await tx
    .select({
      enrollmentId: enrollmentCourse.enrollmentId,
      firstName: sql<string>`coalesce(${person.firstName}, ${person.lastName})`,
      discipline: discipline.name,
      day: course.weekday,
      startTime: course.startTime,
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
  const order = (s: EnrollmentStatus) => STATUS_PRIORITY.indexOf(s);
  return rows
    .map((l) => {
      const own = relationships.filter((x) => x.enrollmentId === l.id);
      const quarters = covered.filter((q) => q.enrollmentId === l.id).map((q) => q.label);
      const netPriceCents = l.netPriceCents ?? 0;
      return {
        id: l.id,
        audience: l.audience,
        period: l.period,
        netPriceCents,
        quarters,
        quarterCount: quarters.length,
        seasonDueCents: seasonDueCents({ period: l.period, netPriceCents, quarterCount: quarters.length }),
        priceReason: l.priceReason,
        status: l.status,
        droppedOn: l.droppedOn,
        enrolledOn: l.enrolledOn,
        payerId: l.payerId,
        invoiced: l.invoiced,
        actions: enrollmentActions(l.status, { invoiced: l.invoiced, attended: l.attended }),
        cancelRefusal: cancelRefusal({ invoiced: l.invoiced, attended: l.attended }),
        entity: namedEntity ? l.entity : null,
        students: [...new Set(own.map((x) => x.firstName))].sort().join(" et "),
        courses: [
          ...new Set(
            own.map((x) => `${x.discipline} ${x.day ? DAYS[x.day] : ""} ${x.startTime.slice(0, 5)}`.replace("  ", " ")),
          ),
        ],
      };
    })
    .sort((a, b) => a.students.localeCompare(b.students, "fr") || order(a.status) - order(b.status));
}

// ---------------------------------------------------------------------------
// Lifecycle (#284): confirm a trial or waitlist enrollment, record a drop-out,
// cancel a mistake. Every change is written to the audit log (technical ids
// and amounts only, never names).
// ---------------------------------------------------------------------------

const GONE = "Cette inscription n’existe plus.";

type Saved = {
  id: string;
  payerId: string;
  seasonId: string;
  status: EnrollmentStatus;
  audience: Audience;
  period: Period;
  grossPriceCents: number;
  discountCents: number;
  /** Price typed by hand (#292) and its reason, or null. */
  manualPriceCents: number | null;
  priceReason: string | null;
  droppedOn: string | null;
  enrolledOn: string;
  invoiced: boolean;
  attended: boolean;
};

/**
 * A saved enrollment of the current school, or null. `lock`: the payer's row then the
 * enrollment's stay locked until the end of the transaction (same order everywhere), so
 * two clicks or two desks wait for each other and the second sees the first's change.
 * The enrollment is locked `FOR UPDATE`: an invoice line referring to it (epic #6, which
 * takes `FOR KEY SHARE` through its foreign key) waits for the change, then sees it.
 * Attendance is not locked: one taken at the same instant as a cancellation can slip
 * through (the cancellation then removes an enrollment just attended; the audit log keeps it).
 */
async function readSaved(tx: Tx, id: string, lock = false): Promise<Saved | null> {
  if (!uuid.safeParse(id).success) return null;
  const read = async () =>
    (
      await tx
        .select({
          id: enrollment.id,
          payerId: enrollment.payerId,
          seasonId: enrollment.seasonId,
          status: enrollment.status,
          audience: enrollment.audience,
          period: enrollment.period,
          grossPriceCents: enrollment.grossPriceCents,
          discountCents: enrollment.discountCents,
          manualPriceCents: enrollment.manualPriceCents,
          priceReason: enrollment.priceReason,
          droppedOn: enrollment.droppedOn,
          enrolledOn: enrollment.enrolledOn,
          invoiced: invoicedSql,
          attended: attendedSql,
        })
        .from(enrollment)
        .where(eq(enrollment.id, id))
    )[0] ?? null;
  const first = await read();
  if (!first || !lock) return first;
  await lockPayer(tx, first.payerId);
  await tx.select({ id: enrollment.id }).from(enrollment).where(eq(enrollment.id, id)).for("update");
  // Read again under the locks, in a new statement: a change committed meanwhile is seen.
  return read();
}

/** Member of the current school making the change (audit log, typed price), with their role. */
async function memberOf(tx: Tx, userId: string) {
  const [m] = await tx
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true)));
  return m ?? null;
}

/** Price of a trial or waitlist enrollment if it were confirmed now, and its effect on the payer's others. */
export type ConfirmationPreview =
  | { status: "invalid"; message: string }
  | {
      status: "ok";
      /** Recomputed with the payer's current active enrollments (#284 Q4). */
      price: EnrollmentResult;
      /** Price typed by hand at trial or waitlist time (#292): kept at confirmation, it stays the final price. */
      manualPrice: ManualPrice | null;
      /** What the enrollment will cost once confirmed; null when it cannot be priced. */
      netPriceCents: number | null;
      /** Net price saved at trial or waitlist time. */
      savedNetPriceCents: number;
      existingImpacts: ExistingImpact[];
    };

async function confirmationOf(tx: Tx, e: Saved): Promise<ConfirmationPreview> {
  const refusal = e.invoiced
    ? cancelRefusal({ invoiced: true, attended: false })
    : transitionRefusal(e.status, "active");
  if (refusal) return { status: "invalid", message: refusal };
  const [target] = await withCourses(tx, [
    { id: e.id, audience: e.audience, period: e.period, deposit: e.discountCents, manual: e.manualPriceCents !== null },
  ]);
  const existing = await existingEnrollments(tx, e.payerId, e.seasonId, e.id);
  const result = computeTariff({
    grid: await loadGrid(tx, e.seasonId),
    discounts: await loadDiscounts(tx, e.seasonId),
    enrollments: [...existing, target],
  });
  // The engine returns one result per request, the target included.
  const price = result.enrollments.find((r) => r.reference === e.id)!;
  const manualPrice =
    e.manualPriceCents !== null && e.priceReason !== null
      ? { priceCents: e.manualPriceCents, reason: e.priceReason }
      : null;
  return {
    status: "ok",
    price,
    manualPrice,
    // Q2 (#292): a typed price stays the final price, whatever the grid says now.
    // It stands in for a missing package only: without a course, nothing can be confirmed.
    netPriceCents:
      price.status === "ok"
        ? (manualPrice?.priceCents ?? price.netPriceCents)
        : price.error.code === "missing_combination"
          ? (manualPrice?.priceCents ?? null)
          : null,
    savedNetPriceCents: savedNetPrice(e),
    existingImpacts: await impactsOn(tx, existing, result.enrollments),
  };
}

/** What confirming would cost, shown before the front desk confirms. */
export async function confirmationPreview(tx: Tx, id: string): Promise<ConfirmationPreview> {
  const e = await readSaved(tx, id);
  return e ? confirmationOf(tx, e) : { status: "invalid", message: GONE };
}

export type ChangeResult = { ok: true; id: string; already?: true } | { ok: false; message: string };

/**
 * Confirms a trial or waitlist enrollment (→ active) at the price recomputed now, which
 * must be the one the front desk saw (`expectedNetCents`): otherwise nothing is saved and
 * the new price is to be checked. A price typed by hand (#292) is kept and stays the
 * price; the grid price and discount under it are still recomputed when the grid has a
 * package. A second click, or a retry after a lost response, finds it active and changes
 * nothing (#260).
 */
export async function confirmEnrollment(
  tx: Tx,
  userId: string,
  id: string,
  expectedNetCents: number,
): Promise<ChangeResult> {
  const e = await readSaved(tx, id, true);
  if (!e) return { ok: false, message: GONE };
  if (e.status === "active") return { ok: true, id, already: true };
  const preview = await confirmationOf(tx, e);
  if (preview.status === "invalid") return { ok: false, message: preview.message };
  const r = preview.price;
  // A typed price stands in for a missing package only; any other refusal (no course) stays.
  if (r.status === "error" && (preview.manualPrice === null || r.error.code !== "missing_combination"))
    return { ok: false, message: r.error.message };
  if (preview.netPriceCents !== expectedNetCents)
    return { ok: false, message: "Le prix a changé depuis son affichage : vérifiez-le avant de confirmer." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  // Still no package in the grid (a typed price, checked above): the saved price stays as it is.
  const price =
    r.status === "ok"
      ? confirmationPrice(
          { grossPriceCents: e.grossPriceCents, discountCents: e.discountCents },
          { grossPriceCents: r.grossPriceCents, discountCents: r.discountCents },
        )
      : { grossPriceCents: e.grossPriceCents, discountCents: e.discountCents };
  if (r.status === "ok")
    await tx
      .update(enrollment)
      .set({
        status: "active",
        tariffId: r.tariffRowId,
        grossPriceCents: price.grossPriceCents,
        discountCents: price.discountCents,
        discounts: r.discounts.filter((d) => d.status === "applied").map((d) => d.code),
      })
      .where(eq(enrollment.id, id));
  else await tx.update(enrollment).set({ status: "active" }).where(eq(enrollment.id, id));
  // The net is said on both sides: under a typed price it stays, whatever gross and discount become.
  const typed = e.manualPriceCents !== null ? { manualPriceCents: e.manualPriceCents, reason: e.priceReason } : {};
  const net = (p: { grossPriceCents: number; discountCents: number }) =>
    savedNetPrice({ ...p, manualPriceCents: e.manualPriceCents });
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who.id,
    targetTable: "enrollment",
    rowId: id,
    action: "update",
    before: {
      status: e.status,
      grossPriceCents: e.grossPriceCents,
      discountCents: e.discountCents,
      netPriceCents: net(e),
      ...typed,
    },
    after: {
      status: "active",
      grossPriceCents: price.grossPriceCents,
      discountCents: price.discountCents,
      netPriceCents: net(price),
      ...typed,
    },
  });
  return { ok: true, id };
}

/**
 * What a drop-out or a cancellation would change for the payer's other enrollments: an
 * active enrollment leaving takes its students out of the siblings (#284 Q2, Q3). Told, never applied.
 */
export async function leavingImpacts(tx: Tx, id: string): Promise<ExistingImpact[]> {
  const e = await readSaved(tx, id);
  if (!e || !countsAsSibling(e.status)) return [];
  const remaining = await existingEnrollments(tx, e.payerId, e.seasonId, e.id);
  if (remaining.length === 0) return [];
  const result = computeTariff({
    grid: await loadGrid(tx, e.seasonId),
    discounts: await loadDiscounts(tx, e.seasonId),
    enrollments: remaining,
  });
  return impactsOn(tx, remaining, result.enrollments);
}

/**
 * Records a drop-out on `droppedOn` (from the enrollment day, within its season): the
 * student leaves the attendance sheets of the lessons after that day. Its price stays as
 * saved and stays due (#284 Q1: the school neither carries over nor refunds). The same
 * drop-out sent twice changes nothing.
 */
export async function dropEnrollment(tx: Tx, userId: string, id: string, droppedOn: string): Promise<ChangeResult> {
  const e = await readSaved(tx, id, true);
  if (!e) return { ok: false, message: GONE };
  if (e.status === "dropped" && e.droppedOn === droppedOn) return { ok: true, id, already: true };
  const refusal = transitionRefusal(e.status, "dropped");
  if (refusal) return { ok: false, message: refusal };
  const [s] = await tx
    .select({ startDate: season.startDate, endDate: season.endDate })
    .from(season)
    .where(eq(season.id, e.seasonId));
  const dateRefusal = s ? dropDateRefusal(droppedOn, dropDateBounds(e.enrolledOn, s)) : GONE;
  if (dateRefusal) return { ok: false, message: dateRefusal };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  await tx.update(enrollment).set({ status: "dropped", droppedOn }).where(eq(enrollment.id, id));
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who.id,
    targetTable: "enrollment",
    rowId: id,
    action: "update",
    before: { status: e.status },
    after: { status: "dropped", droppedOn },
  });
  return { ok: true, id };
}

/**
 * Cancels an enrollment entered by mistake: removed with its courses, the audit log keeps
 * its ids and amounts; the payer's payments are untouched and stay on the balance.
 * Refused once invoiced (a credit note is the way back) or once attendance was taken
 * for it (a drop-out is then what happened). The unsent invoice drafts billing it are thrown
 * away whole (#302), with the payer's other lines of that business and season: they come back
 * at the next drafting (`draftPayerInvoices`), which nothing triggers yet.
 */
export async function cancelEnrollment(tx: Tx, userId: string, id: string): Promise<ChangeResult> {
  const e = await readSaved(tx, id, true);
  if (!e) return { ok: false, message: "Cette inscription a déjà été annulée." };
  const refusal = cancelRefusal(e);
  if (refusal) return { ok: false, message: refusal };
  const courses = await tx
    .select({ studentId: enrollmentCourse.studentId, courseId: enrollmentCourse.courseId })
    .from(enrollmentCourse)
    .where(eq(enrollmentCourse.enrollmentId, id));
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  const discarded = await discardDrafts(tx, who.id, await draftsBillingEnrollment(tx, id));
  if (!discarded.ok) return discarded;
  await tx.delete(enrollmentCourse).where(eq(enrollmentCourse.enrollmentId, id));
  await tx.delete(enrollment).where(eq(enrollment.id, id));
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who.id,
    targetTable: "enrollment",
    rowId: id,
    action: "delete",
    before: {
      payerId: e.payerId,
      seasonId: e.seasonId,
      status: e.status,
      grossPriceCents: e.grossPriceCents,
      discountCents: e.discountCents,
      ...(e.manualPriceCents !== null ? { manualPriceCents: e.manualPriceCents } : {}),
      courses,
    },
  });
  return { ok: true, id };
}
