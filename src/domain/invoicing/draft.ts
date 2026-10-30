import { allocate } from "../../lib/money";
import { NO_VAT_CHARGED, vatBreakdown, type VatRegime, type VatTreatment } from "../billing/vat";
import { quarterlyDues, type SeasonQuarter } from "../enrollment/quarters";
import { DUE_STATUSES, type EnrollmentStatus } from "../payments/balance";
import { combinationLabel } from "../tariff/compute";
import type { Audience, Period, TariffRow } from "../tariff/types";

/**
 * Invoice drafts (#302, ADR 0006): what a payer owes for a season, one draft per business
 * (billing entity) that sells to them, built from their enrollments and lesson packs. Pure
 * functions, no database. A draft never carries an invoice number: the business's invoicing
 * tool numbers it when it issues it (CLAUDE.md §5).
 *
 * The issue's open questions, each decided here and nowhere else with its default (owner
 * approved, pending the accountant, #289 and #291):
 *
 * - Q1 (split key of a package mixing VAT treatments): each course's standalone grid price,
 *   weekly minutes when a course has none (`splitWeights`).
 * - Q2 (quarterly billing): one invoice per season with one installment per quarter
 *   (`installmentsOf`, `quarterlyDues`).
 * - Q3 (what a dropped or trial enrollment owes, #99): as the balance counts it,
 *   `DUE_STATUSES` (a drop-out owes all it covers, a trial or waitlist nothing yet).
 *
 * Until the school's installment plans exist (#176), what is not quarterly (a yearly or
 * drop-in package, a lesson pack) is due at once, on the day it was sold (`installmentsOf`).
 */

/** Label of the negative line taking a discount off a package, one per VAT treatment (#289). */
export const DISCOUNT_LABEL = "Remise";

// ---------------------------------------------------------------------------
// Splitting a package over VAT treatments
// ---------------------------------------------------------------------------

/** A course of a package, as its price is split: its treatment, its weight and how lines name it. */
export type SplitCourse = { courseId: string; vatTreatmentId: string; weight: number; label?: string };

export type SplitLine = {
  vatTreatmentId: string;
  kind: "package" | "discount";
  label: string;
  inclTaxCents: number;
};

/**
 * A package's lines per VAT treatment (#302): the package price spread over the treatments of
 * its courses in proportion to their weights (`allocate`, exact to the cent), and each
 * discount spread with the same weights into one negative « Remise » line per treatment. A
 * package of one treatment gets one package line and one line per discount. The lines add up
 * to the net price to the cent. Groups in the order of their first course; a discount of 0
 * gives no line. With several treatments, each line names the courses it covers.
 */
export function splitEnrollment(input: {
  grossPriceCents: number;
  discounts: readonly { code: string; amountCents: number }[];
  courses: readonly SplitCourse[];
  /** Label of the package line: « Forfait 45 min + 1 h 00 ». */
  label?: string;
}): SplitLine[] {
  if (input.courses.length === 0) throw new RangeError("Au moins un cours attendu");
  const groups = new Map<string, { weight: number; labels: string[] }>();
  for (const c of input.courses) {
    if (!Number.isSafeInteger(c.weight) || c.weight < 0) throw new TypeError(`Poids invalide : ${c.weight}`);
    const g = groups.get(c.vatTreatmentId) ?? { weight: 0, labels: [] };
    g.weight += c.weight;
    if (c.label) g.labels.push(c.label);
    groups.set(c.vatTreatmentId, g);
  }
  const entries = [...groups];
  const weights = entries.map(([, g]) => g.weight);
  const packageParts = allocate(input.grossPriceCents, weights);
  const discountParts = input.discounts
    .filter((d) => d.amountCents !== 0)
    .map((d) => allocate(-d.amountCents, weights));
  const named = (base: string, labels: readonly string[]) =>
    entries.length > 1 && labels.length > 0 ? `${base} — ${labels.join(", ")}` : base;
  return entries.flatMap(([vatTreatmentId, g], i) => [
    {
      vatTreatmentId,
      kind: "package" as const,
      label: named(input.label ?? "Forfait", g.labels),
      inclTaxCents: packageParts[i],
    },
    ...discountParts.map((parts) => ({
      vatTreatmentId,
      kind: "discount" as const,
      label: named(DISCOUNT_LABEL, g.labels),
      inclTaxCents: parts[i],
    })),
  ]);
}

/** A course of an enrollment as the split key reads it. */
export type WeightedCourse = { durationMinutes: number; standalonePriceCents: number | null };

/**
 * Q1 default (#289): the split key of a package. Each course's standalone grid price (the
 * single-course package of the same audience and period); when one course has none, every
 * course's weekly minutes, so the key is never a mix of euros and minutes.
 */
export function splitWeights(courses: readonly WeightedCourse[]): number[] {
  const prices = courses.map((c) => c.standalonePriceCents);
  return prices.every((p): p is number => p !== null) && prices.some((p) => p > 0)
    ? prices
    : courses.map((c) => c.durationMinutes);
}

/**
 * The grid price of a course taken alone (#289): the single-course package of its length for
 * the enrollment's audience and period, the one of its discipline first, else the one of all
 * disciplines. Null when the grid has none.
 */
export function standalonePrice(
  grid: readonly TariffRow[],
  enrollment: { audience: Audience; period: Period },
  course: { disciplineId: string; durationMinutes: number },
): number | null {
  const single = grid.filter(
    (r) =>
      r.audience === enrollment.audience &&
      r.period === enrollment.period &&
      r.combination.length === 1 &&
      r.combination[0] === course.durationMinutes,
  );
  const row = single.find((r) => r.disciplineId === course.disciplineId) ?? single.find((r) => r.disciplineId === null);
  return row?.priceCents ?? null;
}

// ---------------------------------------------------------------------------
// Drafting a payer's invoices
// ---------------------------------------------------------------------------

export type DraftCourse = WeightedCourse & { courseId: string; vatTreatmentId: string; label: string };

/** An enrollment of the payer for the season, as saved. */
export type BillableEnrollment = {
  id: string;
  billingEntityId: string;
  status: EnrollmentStatus;
  period: Period;
  /** Package line label: « Forfait 45 min + 1 h 00 — Zz Alice ». */
  label: string;
  enrolledOn: string;
  grossPriceCents: number;
  discountCents: number;
  /** Codes of the applied discounts (`enrollment.discounts`). */
  discountCodes: readonly string[];
  /** Price typed by hand (#292): billed as is, with no discount line. */
  manualPriceCents: number | null;
  /** Its courses, each once (a couple's two students share them). */
  courses: readonly DraftCourse[];
  /** Quarters a quarterly enrollment covers (`enrollment_quarter`); ignored otherwise. */
  quarters: readonly SeasonQuarter[];
};

/** A lesson pack of the payer not invoiced yet. */
export type BillablePack = {
  id: string;
  billingEntityId: string;
  vatTreatmentId: string;
  label: string;
  priceCents: number;
  purchasedOn: string;
};

export type DraftEntity = { id: string; name: string; vatRegime: VatRegime };

export type DraftLine = {
  label: string;
  quantityThousandths: number;
  /** VAT-inclusive unit price (#301). */
  unitPriceCents: number;
  inclTaxCents: number;
  exclTaxCents: number;
  vatCents: number;
  vatTreatmentId: string;
  vatCategory: VatTreatment["category"];
  vatRateBps: number;
  vatMention: string | null;
  enrollmentId: string | null;
  lessonPackId: string | null;
};

export type DraftInstallment = { rank: number; dueOn: string; amountCents: number };

/** One invoice to be issued by a business's tool: no number, the tool gives it. */
export type InvoiceDraft = {
  billingEntityId: string;
  lines: DraftLine[];
  totalInclTaxCents: number;
  totalExclTaxCents: number;
  totalVatCents: number;
  installments: DraftInstallment[];
};

export type DraftResult = { ok: true; drafts: InvoiceDraft[] } | { ok: false; message: string };

/** What an enrollment's package bills per period: the typed price alone (#292 Q2), or the grid price and its discount. */
function priceOf(e: BillableEnrollment) {
  if (e.manualPriceCents !== null) return { grossPriceCents: e.manualPriceCents, discounts: [] };
  return {
    grossPriceCents: e.grossPriceCents,
    discounts: e.discountCents === 0 ? [] : [{ code: e.discountCodes.join("+"), amountCents: e.discountCents }],
  };
}

/** Net price of one period, as `enrollment.net_price_cents`. */
const netOf = (e: BillableEnrollment) => e.manualPriceCents ?? e.grossPriceCents - e.discountCents;

type RawLine = Omit<DraftLine, "exclTaxCents" | "vatCents" | "vatCategory" | "vatRateBps" | "vatMention">;

/**
 * An enrollment's lines. A quarterly package bills each covered quarter at its own cents
 * (#291 Q3: the discount already taken off each quarter): every line holds one quarter's
 * amount as its unit price, times the number of quarters, so nothing is recomputed on the
 * season total. A quarterly enrollment covering no quarter owes nothing (`seasonDueCents`).
 */
function enrollmentLines(e: BillableEnrollment): RawLine[] {
  const count = e.period === "quarter" ? e.quarters.length : 1;
  if (count === 0) return [];
  const weights = splitWeights(e.courses);
  const quarters = e.period === "quarter" ? ` — ${count} trimestre${count > 1 ? "s" : ""}` : "";
  return splitEnrollment({
    ...priceOf(e),
    label: `${e.label}${quarters}`,
    courses: e.courses.map((c, i) => ({
      courseId: c.courseId,
      vatTreatmentId: c.vatTreatmentId,
      weight: weights[i],
      label: c.label,
    })),
  }).map((l) => ({
    label: l.label,
    quantityThousandths: count * 1000,
    unitPriceCents: l.inclTaxCents,
    inclTaxCents: l.inclTaxCents * count,
    vatTreatmentId: l.vatTreatmentId,
    enrollmentId: e.id,
    lessonPackId: null,
  }));
}

/**
 * Q2 default (#291): an invoice's installments. Each quarter of a quarterly enrollment is due
 * on its own cashing day (`quarterlyDues`); the rest, until installment plans exist (#176),
 * at once on the day it was sold. Amounts due the same day make one installment; ranks in date
 * order; a day owing nothing has none. They add up to the invoice's total.
 */
function installmentsOf(
  enrollments: readonly BillableEnrollment[],
  packs: readonly BillablePack[],
): DraftInstallment[] {
  const byDay = new Map<string, number>();
  const add = (day: string, cents: number) => byDay.set(day, (byDay.get(day) ?? 0) + cents);
  for (const e of enrollments) {
    if (e.period === "quarter")
      for (const d of quarterlyDues(e.quarters, netOf(e), e.enrolledOn)) add(d.dueOn, d.amountCents);
    else add(e.enrolledOn, netOf(e));
  }
  for (const p of packs) add(p.purchasedOn, p.priceCents);
  return [...byDay]
    .filter(([, cents]) => cents !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dueOn, amountCents], i) => ({ rank: i + 1, dueOn, amountCents }));
}

/**
 * A payer's invoice drafts for a season (#302): one per business, in the order of `entities`,
 * for the enrollments that owe something (`DUE_STATUSES`) and the lesson packs given. Lines:
 * each enrollment's package and « Remise » lines per VAT treatment, then each pack; VAT taken
 * out of the VAT-inclusive prices per treatment over the whole invoice (`vatBreakdown`), the
 * treatment's category, rate and mention copied onto each line. A business with nothing to bill
 * gets no draft. Refused, in French, when a line carries VAT for a business that charges none.
 */
export function draftInvoices(input: {
  enrollments: readonly BillableEnrollment[];
  packs: readonly BillablePack[];
  entities: readonly DraftEntity[];
  treatments: readonly VatTreatment[];
}): DraftResult {
  const treatments = new Map(input.treatments.map((t) => [t.id, t]));
  const known = new Set(input.entities.map((e) => e.id));
  for (const x of [...input.enrollments, ...input.packs])
    if (!known.has(x.billingEntityId)) throw new RangeError(`Entreprise inconnue : ${x.billingEntityId}`);
  const due = input.enrollments.filter((e) => DUE_STATUSES.includes(e.status));
  const drafts: InvoiceDraft[] = [];
  for (const entity of input.entities) {
    const enrollments = due.filter((e) => e.billingEntityId === entity.id);
    const packs = input.packs.filter((p) => p.billingEntityId === entity.id);
    const raw: RawLine[] = [
      ...enrollments.flatMap(enrollmentLines),
      ...packs.map((p) => ({
        label: p.label,
        quantityThousandths: 1000,
        unitPriceCents: p.priceCents,
        inclTaxCents: p.priceCents,
        vatTreatmentId: p.vatTreatmentId,
        enrollmentId: null,
        lessonPackId: p.id,
      })),
    ];
    if (raw.length === 0) continue;
    const taxed = raw.some((l) => treatments.get(l.vatTreatmentId)?.category === "standard");
    if (taxed && NO_VAT_CHARGED.includes(entity.vatRegime))
      return {
        ok: false,
        message: `${entity.name} ne facture pas de TVA, mais un de ses cours ou carnets en porte : corrigez son traitement de TVA.`,
      };
    const vat = vatBreakdown(raw, input.treatments);
    const lines = raw.map((l, i): DraftLine => {
      const t = treatments.get(l.vatTreatmentId);
      if (!t) throw new RangeError(`Traitement de TVA inconnu : ${l.vatTreatmentId}`);
      return {
        ...l,
        exclTaxCents: vat.lines[i].exclTaxCents,
        vatCents: vat.lines[i].vatCents,
        vatCategory: t.category,
        vatRateBps: t.category === "standard" ? t.rateBps : 0,
        vatMention: t.category === "standard" ? null : t.mention,
      };
    });
    const sum = (k: "inclTaxCents" | "exclTaxCents" | "vatCents") => vat.byTreatment.reduce((s, g) => s + g[k], 0);
    drafts.push({
      billingEntityId: entity.id,
      lines,
      totalInclTaxCents: sum("inclTaxCents"),
      totalExclTaxCents: sum("exclTaxCents"),
      totalVatCents: sum("vatCents"),
      installments: installmentsOf(enrollments, packs),
    });
  }
  return { ok: true, drafts };
}

/** « Forfait 45 min + 1 h 00 — Zz Alice et Zz Bruno »: the package line of an enrollment. */
export function enrollmentLabel(durations: readonly number[], students: readonly string[]): string {
  const sorted = [...durations].sort((a, b) => a - b);
  const who = students.length > 0 ? ` — ${students.join(" et ")}` : "";
  return `Forfait ${combinationLabel(sorted)}${who}`;
}

/** « Carnet 5 séances · 2 personnes »: the line of a lesson pack. */
export function packLineLabel(p: { lessonCount: number; peopleCount: number }): string {
  const lessons = `${p.lessonCount} séance${p.lessonCount > 1 ? "s" : ""}`;
  const people = `${p.peopleCount} personne${p.peopleCount > 1 ? "s" : ""}`;
  return `Carnet ${lessons} · ${people}`;
}
