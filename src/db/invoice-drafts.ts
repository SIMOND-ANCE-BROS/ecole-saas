import { and, asc, between, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { rowsOf } from "./columns-of";
import { discardDrafts, lockDrafts } from "./invoice-draft-discard";
import { loadGrid } from "./enrollments";
import type { Tx } from "./index";
import {
  auditLog,
  billingEntity,
  course,
  discipline,
  enrollment,
  enrollmentCourse,
  enrollmentQuarter,
  installment,
  invoice,
  invoiceLine,
  lessonPack,
  person,
  season,
  seasonQuarter,
  vatTreatment,
} from "./schema";
import type { VatTreatment } from "../domain/billing/vat";
import type { SeasonQuarter } from "../domain/enrollment/quarters";
import {
  draftInvoices,
  enrollmentLabel,
  packLineLabel,
  standalonePrice,
  type BillableEnrollment,
  type BillablePack,
  type DraftCourse,
} from "../domain/invoicing/draft";
import { displayedName } from "../domain/people/name";

/**
 * Invoice drafts of a payer for a season (#302, ADR 0006): one per business, persisted as an
 * invoice without number (`to_send`), its lines and its installments. The number comes from
 * the business's invoicing tool when it issues the invoice (#303, #304); nothing is sent here.
 * Always within `withSchool()` (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;

export type DraftOutcome = { ok: true; invoiceIds: string[] } | { ok: false; message: string };

/**
 * Drafts again the invoices of `payerId` for `seasonId`: its unsent drafts of the season are
 * replaced by new ones billing what no other invoice bills yet: the season's enrollments that
 * owe something and the lesson packs bought within the season's dates. An invoice handed to
 * the tool or issued is never touched; what it bills is left out. The payer row is locked, so
 * two draftings for the same payer run one after the other. Returns the new drafts' ids, none
 * when nothing is left to bill.
 */
export async function draftPayerInvoices(
  tx: Tx,
  actor: string | null,
  payerId: string,
  seasonId: string,
): Promise<DraftOutcome> {
  if (!isUuid(payerId) || !isUuid(seasonId)) return { ok: false, message: "Saisie invalide." };
  const [payer] = await tx.select({ id: person.id }).from(person).where(eq(person.id, payerId)).for("no key update");
  if (!payer) return { ok: false, message: "Ce payeur n’existe plus." };
  const [s] = await tx
    .select({ startDate: season.startDate, endDate: season.endDate })
    .from(season)
    .where(eq(season.id, seasonId));
  if (!s) return { ok: false, message: "Cette saison n’existe plus." };

  // The unsent drafts of the season go: what they billed is drafted again below.
  const stale = await lockDrafts(tx, and(eq(invoice.payerId, payerId), eq(invoice.seasonId, seasonId)));
  const discarded = await discardDrafts(tx, actor, stale);
  if (!discarded.ok) return discarded;

  const enrollments = await billableEnrollments(tx, payerId, seasonId);
  const packs = await billablePacks(tx, payerId, s);
  const entities = await tx
    .select({ id: billingEntity.id, name: billingEntity.name, vatRegime: billingEntity.vatRegime })
    .from(billingEntity)
    .orderBy(desc(billingEntity.isDefault), asc(billingEntity.name));
  const r = draftInvoices({ enrollments, packs, entities, treatments: await treatments(tx) });
  if (!r.ok) return r;

  const invoiceIds: string[] = [];
  for (const d of r.drafts) {
    const [{ id }] = await tx
      .insert(invoice)
      .values({
        schoolId: CURRENT_SCHOOL,
        billingEntityId: d.billingEntityId,
        payerId,
        seasonId,
        status: "to_send",
        totalInclTaxCents: d.totalInclTaxCents,
        totalExclTaxCents: d.totalExclTaxCents,
        totalVatCents: d.totalVatCents,
      })
      .returning({ id: invoice.id });
    invoiceIds.push(id);
    await tx.insert(invoiceLine).values(
      rowsOf(
        invoiceLine,
        d.lines.map((l) => ({ ...l, schoolId: CURRENT_SCHOOL, billingEntityId: d.billingEntityId, invoiceId: id })),
      ),
    );
    if (d.installments.length > 0)
      await tx.insert(installment).values(
        rowsOf(
          installment,
          d.installments.map((i) => ({
            schoolId: CURRENT_SCHOOL,
            billingEntityId: d.billingEntityId,
            invoiceId: id,
            rank: i.rank,
            dueDate: i.dueOn,
            amountCents: i.amountCents,
          })),
        ),
      );
    // Ids and amounts only: never a name in the audit log.
    await tx.insert(auditLog).values({
      schoolId: CURRENT_SCHOOL,
      actor,
      targetTable: "invoice",
      rowId: id,
      action: "insert",
      after: {
        billing_entity_id: d.billingEntityId,
        payer_id: payerId,
        season_id: seasonId,
        total_incl_tax_cents: d.totalInclTaxCents,
        lines: d.lines.length,
        installments: d.installments.length,
      },
    });
  }
  return { ok: true, invoiceIds };
}

/**
 * Billed by a line of an invoice (the unsent drafts are gone by then): not drafted again, even
 * on an invoice the tool rejected or that was cancelled, until the sending (#304) and credit
 * notes decide what such an invoice gives back.
 */
const billedEnrollment = sql`EXISTS (SELECT 1 FROM invoice_line l WHERE l.enrollment_id = ${enrollment.id})`;
const billedPack = sql`EXISTS (SELECT 1 FROM invoice_line l WHERE l.lesson_pack_id = ${lessonPack.id})`;

/** The payer's enrollments of the season no invoice bills yet, with their courses, students and quarters. */
async function billableEnrollments(tx: Tx, payerId: string, seasonId: string): Promise<BillableEnrollment[]> {
  const rows = await tx
    .select({
      id: enrollment.id,
      billingEntityId: enrollment.billingEntityId,
      status: enrollment.status,
      audience: enrollment.audience,
      period: enrollment.period,
      enrolledOn: enrollment.enrolledOn,
      grossPriceCents: enrollment.grossPriceCents,
      discountCents: enrollment.discountCents,
      discountCodes: enrollment.discounts,
      manualPriceCents: enrollment.manualPriceCents,
    })
    .from(enrollment)
    .where(and(eq(enrollment.payerId, payerId), eq(enrollment.seasonId, seasonId), sql`NOT ${billedEnrollment}`))
    .orderBy(asc(enrollment.enrolledOn), asc(enrollment.createdAt), asc(enrollment.id));
  if (rows.length === 0) return [];
  const ids = rows.map((e) => e.id);
  const courses = await tx
    .select({
      enrollmentId: enrollmentCourse.enrollmentId,
      courseId: course.id,
      vatTreatmentId: course.vatTreatmentId,
      durationMinutes: course.durationMinutes,
      disciplineId: course.disciplineId,
      discipline: discipline.name,
      student: { name: person.lastName, firstName: person.firstName, companyName: person.companyName },
    })
    .from(enrollmentCourse)
    .innerJoin(course, eq(course.id, enrollmentCourse.courseId))
    .innerJoin(discipline, eq(discipline.id, course.disciplineId))
    .innerJoin(person, eq(person.id, enrollmentCourse.studentId))
    .where(inArray(enrollmentCourse.enrollmentId, ids))
    .orderBy(asc(course.weekday), asc(course.startTime), asc(course.id), asc(person.firstName), asc(person.id));
  const quarters = await tx
    .select({
      enrollmentId: enrollmentQuarter.enrollmentId,
      id: seasonQuarter.id,
      label: seasonQuarter.label,
      startDate: seasonQuarter.startDate,
      endDate: seasonQuarter.endDate,
    })
    .from(enrollmentQuarter)
    .innerJoin(seasonQuarter, eq(seasonQuarter.id, enrollmentQuarter.quarterId))
    .where(inArray(enrollmentQuarter.enrollmentId, ids))
    .orderBy(asc(seasonQuarter.startDate));
  const grid = await loadGrid(tx, seasonId);
  return rows.map((e) => {
    const mine = courses.filter((c) => c.enrollmentId === e.id);
    // A couple's two students share the courses: each course once.
    const byCourse = new Map<string, DraftCourse>();
    for (const c of mine)
      if (!byCourse.has(c.courseId))
        byCourse.set(c.courseId, {
          courseId: c.courseId,
          vatTreatmentId: c.vatTreatmentId,
          durationMinutes: c.durationMinutes,
          standalonePriceCents: standalonePrice(grid, e, c),
          label: c.discipline,
        });
    const students = [...new Set(mine.map((c) => displayedName(c.student)))];
    const covered: SeasonQuarter[] = quarters
      .filter((q) => q.enrollmentId === e.id)
      .map(({ enrollmentId: _, ...q }) => q);
    return {
      id: e.id,
      billingEntityId: e.billingEntityId,
      status: e.status,
      period: e.period,
      label: enrollmentLabel(
        [...byCourse.values()].map((c) => c.durationMinutes),
        students,
      ),
      enrolledOn: e.enrolledOn,
      grossPriceCents: e.grossPriceCents,
      discountCents: e.discountCents,
      discountCodes: e.discountCodes,
      manualPriceCents: e.manualPriceCents,
      courses: [...byCourse.values()],
      quarters: covered,
    };
  });
}

/**
 * The payer's lesson packs no invoice bills yet, bought within the season's dates. A pack
 * bought between two seasons is on no season's draft: which season it belongs to is an open
 * question (#302).
 */
async function billablePacks(
  tx: Tx,
  payerId: string,
  season: { startDate: string; endDate: string },
): Promise<BillablePack[]> {
  const rows = await tx
    .select({
      id: lessonPack.id,
      billingEntityId: lessonPack.billingEntityId,
      vatTreatmentId: lessonPack.vatTreatmentId,
      lessonCount: lessonPack.lessonCount,
      peopleCount: lessonPack.peopleCount,
      priceCents: lessonPack.priceCents,
      purchasedOn: lessonPack.purchasedOn,
    })
    .from(lessonPack)
    .where(
      and(
        eq(lessonPack.payerId, payerId),
        between(lessonPack.purchasedOn, season.startDate, season.endDate),
        sql`NOT ${billedPack}`,
      ),
    )
    .orderBy(asc(lessonPack.purchasedOn), asc(lessonPack.id));
  return rows.map((p) => ({
    id: p.id,
    billingEntityId: p.billingEntityId,
    vatTreatmentId: p.vatTreatmentId,
    label: packLineLabel(p),
    priceCents: p.priceCents,
    purchasedOn: p.purchasedOn,
  }));
}

/** The school's VAT treatments, as the domain reads them. */
async function treatments(tx: Tx): Promise<VatTreatment[]> {
  const rows = await tx
    .select({
      id: vatTreatment.id,
      category: vatTreatment.category,
      rateBps: vatTreatment.rateBps,
      mention: vatTreatment.mention,
    })
    .from(vatTreatment);
  return rows.map((t) =>
    t.category === "standard"
      ? { id: t.id, category: "standard", rateBps: t.rateBps }
      : { id: t.id, category: t.category, mention: t.mention ?? "" },
  );
}
