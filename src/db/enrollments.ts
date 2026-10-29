import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { rowsOf } from "./columns-of";
import { z } from "zod";
import { discountImpacts } from "../domain/enrollment/impacts";
import {
  confirmationPrice,
  dropDateRefusal,
  enrollmentActions,
  SIBLING_STATUSES,
  transitionRefusal,
  type EnrollmentActions,
} from "../domain/enrollment/lifecycle";
import { STATUS_PRIORITY, type EnrollmentStatus } from "../domain/enrollment/statuses";
import { has } from "../lib/has";
import { computeTariff } from "../domain/tariff/compute";
import type {
  ChosenCourse,
  EnrollmentRequest,
  TariffRow,
  Period,
  Audience,
  DiscountRule,
  EnrollmentResult,
} from "../domain/tariff/types";
import type { Tx } from "./index";
import { payableStudents } from "./people";
import {
  attendance,
  auditLog,
  course,
  discipline,
  enrollment,
  enrollmentCourse,
  lesson,
  member,
  person,
  discount,
  season,
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
};

const NEW = "new";
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
  rows: { id: string; audience: Audience; period: Period; deposit: number }[],
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

/** Payer's students and the season's courses actually chosen; otherwise the reason for refusal. */
async function validate(
  tx: Tx,
  payerId: string,
  seasonId: string,
  entry: EnrollmentInput,
): Promise<string | ChosenCourse[]> {
  const studentIds = [...new Set(entry.studentIds)];
  const courseIds = [...new Set(entry.courseIds)];
  if (entry.audience === "couple" && studentIds.length !== 2) return "Un couple réunit deux danseurs.";
  if (entry.audience !== "couple" && studentIds.length !== 1)
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
  | { status: "invalid"; message: string }
  | { status: "ok"; newEnrollment: EnrollmentResult; existingImpacts: ExistingImpact[] };

/** Price of the new enrollment, computed with the grid, the discounts and the payer's other enrollments. */
export async function enrollmentPreview(
  tx: Tx,
  payerId: string,
  seasonId: string,
  entry: EnrollmentInput,
): Promise<Preview> {
  const chosenCourses = await validate(tx, payerId, seasonId, entry);
  if (typeof chosenCourses === "string") return { status: "invalid", message: chosenCourses };

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
        studentIds: entry.studentIds,
        audience: entry.audience,
        period: entry.period,
        courses: chosenCourses,
      },
    ],
  });

  return {
    status: "ok",
    // The engine returns one result per request, NEW included.
    newEnrollment: result.enrollments.find((i) => i.reference === NEW)!,
    existingImpacts: await impactsOn(tx, payerId, existing, result.enrollments),
  };
}

/** Q2 (#284): the payer's saved enrollments whose discount would change, named by their students' first names. */
async function impactsOn(
  tx: Tx,
  payerId: string,
  existing: Existing[],
  recomputed: EnrollmentResult[],
): Promise<ExistingImpact[]> {
  const impacts = discountImpacts(
    existing.map((e) => ({ reference: e.reference, savedDiscountCents: e.savedDeposit })),
    recomputed,
  );
  if (impacts.length === 0) return [];
  const firstNames = new Map((await payableStudents(tx, payerId)).map((d) => [d.id, d.firstName]));
  return impacts.map((i) => ({
    reference: i.reference,
    students: (existing.find((e) => e.reference === i.reference)?.studentIds ?? [])
      .map((id) => firstNames.get(id) ?? "?")
      .join(" et "),
    savedDeposit: i.savedDiscountCents,
    recalculatedDiscount: i.recalculatedDiscountCents,
  }));
}

/** Saves the enrollment at the price recomputed here (never the one sent by the browser). */
export async function saveEnrollment(
  tx: Tx,
  payerId: string,
  seasonId: string,
  entry: EnrollmentInput,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (!uuid.safeParse(payerId).success) return { ok: false, message: "Saisie invalide." };
  await lockPayer(tx, payerId);
  const preview = await enrollmentPreview(tx, payerId, seasonId, entry);
  if (preview.status === "invalid") return { ok: false, message: preview.message };
  const r = preview.newEnrollment;
  if (r.status === "error") return { ok: false, message: r.error.message };

  const [{ id }] = await tx
    .insert(enrollment)
    .values({
      schoolId: sql`nullif(current_setting('app.school_id', true), '')::uuid`,
      payerId: payerId,
      seasonId: seasonId,
      tariffId: r.tariffRowId,
      audience: entry.audience,
      period: entry.period,
      grossPriceCents: r.grossPriceCents,
      discountCents: r.discountCents,
      discounts: r.discounts.filter((d) => d.status === "applied").map((d) => d.code),
    })
    .returning({ id: enrollment.id });

  const studentIds = [...new Set(entry.studentIds)];
  const courseIds = [...new Set(entry.courseIds)];
  if (courseIds.length > 0) {
    await tx.insert(enrollmentCourse).values(
      rowsOf(
        enrollmentCourse,
        studentIds.flatMap((studentId) =>
          courseIds.map((courseId) => ({
            schoolId: sql`nullif(current_setting('app.school_id', true), '')::uuid`,
            enrollmentId: id,
            studentId: studentId,
            courseId: courseId,
          })),
        ),
      ),
    );
  }
  return { ok: true, id };
}

export type SeasonEnrollment = {
  id: string;
  /** Students' first names: « Zoé », « Léa et Hugo » (couple). */
  students: string;
  audience: Audience;
  period: Period;
  courses: string[];
  netPriceCents: number;
  status: EnrollmentStatus;
  droppedOn: string | null;
  /** An invoice line refers to it: only a credit note can undo it. */
  invoiced: boolean;
  /** What the front desk can do with it (#284). */
  actions: EnrollmentActions;
};

/** An invoice line refers to the enrollment of the row. */
const invoicedSql = sql<boolean>`EXISTS (SELECT 1 FROM invoice_line l WHERE l.enrollment_id = ${enrollment}.${sql.identifier("id")})`;

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
      status: enrollment.status,
      droppedOn: enrollment.droppedOn,
      invoiced: invoicedSql,
    })
    .from(enrollment)
    .where(and(mine, eq(enrollment.seasonId, seasonId)));
  if (rows.length === 0) return [];

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
      return {
        id: l.id,
        audience: l.audience,
        period: l.period,
        netPriceCents: l.netPriceCents ?? 0,
        status: l.status,
        droppedOn: l.droppedOn,
        invoiced: l.invoiced,
        actions: enrollmentActions(l.status, l.invoiced),
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
const INVOICED = "Cette inscription est facturée : passez par un avoir.";
const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

type Saved = {
  id: string;
  payerId: string;
  seasonId: string;
  status: EnrollmentStatus;
  audience: Audience;
  period: Period;
  grossPriceCents: number;
  discountCents: number;
  droppedOn: string | null;
  invoiced: boolean;
};

/**
 * A saved enrollment of the current school, or null. `lock`: the payer's row then the
 * enrollment's stay locked until the end of the transaction (same order everywhere), so
 * two clicks or two desks wait for each other and the second sees the first's change.
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
          droppedOn: enrollment.droppedOn,
          invoiced: invoicedSql,
        })
        .from(enrollment)
        .where(eq(enrollment.id, id))
    )[0] ?? null;
  const first = await read();
  if (!first || !lock) return first;
  await lockPayer(tx, first.payerId);
  await tx.select({ id: enrollment.id }).from(enrollment).where(eq(enrollment.id, id)).for("no key update");
  // Read again under the locks, in a new statement: a change committed meanwhile is seen.
  return read();
}

/** Member of the current school making the change, for the audit log. */
async function memberOf(tx: Tx, userId: string): Promise<string | null> {
  const [m] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true)));
  return m?.id ?? null;
}

/** Price of a trial or waitlist enrollment if it were confirmed now, and its effect on the payer's others. */
export type ConfirmationPreview =
  | { status: "invalid"; message: string }
  | {
      status: "ok";
      /** Recomputed with the payer's current active enrollments (#284 Q4). */
      price: EnrollmentResult;
      /** Net price saved at trial or waitlist time. */
      savedNetPriceCents: number;
      existingImpacts: ExistingImpact[];
    };

async function confirmationOf(tx: Tx, e: Saved): Promise<ConfirmationPreview> {
  const refusal = e.invoiced ? INVOICED : transitionRefusal(e.status, "active");
  if (refusal) return { status: "invalid", message: refusal };
  const [target] = await withCourses(tx, [
    { id: e.id, audience: e.audience, period: e.period, deposit: e.discountCents },
  ]);
  const existing = await existingEnrollments(tx, e.payerId, e.seasonId, e.id);
  const result = computeTariff({
    grid: await loadGrid(tx, e.seasonId),
    discounts: await loadDiscounts(tx, e.seasonId),
    enrollments: [...existing, target],
  });
  return {
    status: "ok",
    // The engine returns one result per request, the target included.
    price: result.enrollments.find((r) => r.reference === e.id)!,
    savedNetPriceCents: e.grossPriceCents - e.discountCents,
    existingImpacts: await impactsOn(tx, e.payerId, existing, result.enrollments),
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
 * the new price is to be checked. A second click, or a retry after a lost response, finds
 * it active and changes nothing (#260).
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
  if (r.status === "error") return { ok: false, message: r.error.message };
  if (r.netPriceCents !== expectedNetCents)
    return { ok: false, message: "Le prix a changé depuis son affichage : vérifiez-le avant de confirmer." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  const price = confirmationPrice(
    { grossPriceCents: e.grossPriceCents, discountCents: e.discountCents },
    { grossPriceCents: r.grossPriceCents, discountCents: r.discountCents },
  );
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
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who,
    targetTable: "enrollment",
    rowId: id,
    action: "update",
    before: { status: e.status, grossPriceCents: e.grossPriceCents, discountCents: e.discountCents },
    after: { status: "active", grossPriceCents: price.grossPriceCents, discountCents: price.discountCents },
  });
  return { ok: true, id };
}

/**
 * What a drop-out or a cancellation would change for the payer's other enrollments: an
 * active enrollment leaving takes its students out of the siblings (#284 Q2, Q3). Told, never applied.
 */
export async function leavingImpacts(tx: Tx, id: string): Promise<ExistingImpact[]> {
  const e = await readSaved(tx, id);
  if (!e || !(SIBLING_STATUSES as readonly EnrollmentStatus[]).includes(e.status)) return [];
  const remaining = await existingEnrollments(tx, e.payerId, e.seasonId, e.id);
  if (remaining.length === 0) return [];
  const result = computeTariff({
    grid: await loadGrid(tx, e.seasonId),
    discounts: await loadDiscounts(tx, e.seasonId),
    enrollments: remaining,
  });
  return impactsOn(tx, e.payerId, remaining, result.enrollments);
}

/**
 * Records a drop-out on `droppedOn` (within the enrollment's season): the student leaves
 * the attendance sheets of the lessons after that day. Its price stays as saved and is
 * shown apart on the balance (#99, #284 Q1). The same drop-out sent twice changes nothing.
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
  const dateRefusal = s ? dropDateRefusal(droppedOn, s) : GONE;
  if (dateRefusal) return { ok: false, message: dateRefusal };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  await tx.update(enrollment).set({ status: "dropped", droppedOn }).where(eq(enrollment.id, id));
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who,
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
 * for it (a drop-out is then what happened).
 */
export async function cancelEnrollment(tx: Tx, userId: string, id: string): Promise<ChangeResult> {
  const e = await readSaved(tx, id, true);
  if (!e) return { ok: false, message: "Cette inscription a déjà été annulée." };
  if (e.invoiced) return { ok: false, message: INVOICED };
  const courses = await tx
    .select({ studentId: enrollmentCourse.studentId, courseId: enrollmentCourse.courseId })
    .from(enrollmentCourse)
    .where(eq(enrollmentCourse.enrollmentId, id));
  if (courses.length > 0) {
    const [attended] = await tx
      .select({ lessonId: attendance.lessonId })
      .from(attendance)
      .innerJoin(lesson, eq(lesson.id, attendance.lessonId))
      .where(or(...courses.map((c) => and(eq(attendance.studentId, c.studentId), eq(lesson.courseId, c.courseId)))))
      .limit(1);
    if (attended)
      return {
        ok: false,
        message: "Des présences sont déjà relevées pour cette inscription : enregistrez plutôt un abandon.",
      };
  }
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  await tx.delete(enrollmentCourse).where(eq(enrollmentCourse.enrollmentId, id));
  await tx.delete(enrollment).where(eq(enrollment.id, id));
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who,
    targetTable: "enrollment",
    rowId: id,
    action: "delete",
    before: {
      payerId: e.payerId,
      seasonId: e.seasonId,
      status: e.status,
      grossPriceCents: e.grossPriceCents,
      discountCents: e.discountCents,
      courses,
    },
  });
  return { ok: true, id };
}
