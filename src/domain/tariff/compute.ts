import { applyRate, formatEuros } from "../../lib/money";
import type {
  ChosenCourse,
  EnrollmentRequest,
  TariffRequest,
  DiscountDetail,
  TariffRow,
  Period,
  Audience,
  DiscountRule,
  EnrollmentResult,
  TariffError,
  TariffResult,
} from "./types";

/**
 * Computes the price of a payer's enrollments for a season, with the detail
 * shown at the front desk: package chosen, discounts applied or rejected.
 *
 * - The package is the tariff grid row whose combination of durations is
 *   exactly that of the chosen courses; a row reserved for a discipline wins
 *   when all courses are of that discipline. Missing combination: error, the
 *   front desk enters the price.
 * - Each discount is rounded to the cent on its own enrollment; the totals
 *   are the sum of the rows.
 */
export function computeTariff(request: TariffRequest): TariffResult {
  request.discounts.forEach(checkRule);

  const packages = request.enrollments.map((enrollment) => packageOf(enrollment, request.grid));
  const enrollments = request.enrollments.map((enrollment, i) => price(enrollment, packages[i], packages, request));
  const priced = enrollments.filter((r) => r.status === "ok");
  const sum = (key: "grossPriceCents" | "discountCents" | "netPriceCents") =>
    priced.reduce((total, r) => total + r[key], 0);

  return {
    enrollments,
    grossTotalCents: sum("grossPriceCents"),
    totalDiscountCents: sum("discountCents"),
    netTotalCents: sum("netPriceCents"),
    full: priced.length === enrollments.length,
  };
}

/** The grid row pricing an enrollment, or why there is none. */
type Package = { status: "ok"; row: TariffRow; combination: number[] } | { status: "error"; error: TariffError };

function packageOf(enrollment: EnrollmentRequest, grid: readonly TariffRow[]): Package {
  if (enrollment.courses.length === 0) {
    return {
      status: "error",
      error: { code: "no_courses", message: "Aucun cours choisi : impossible de déterminer le forfait." },
    };
  }
  const combination = sort(enrollment.courses.map((c) => c.durationMinutes));
  const row = findRow(grid, enrollment, combination);
  if (!row) {
    return {
      status: "error",
      error: {
        code: "missing_combination",
        message:
          `Aucun forfait « ${PUBLIC_LABEL[enrollment.audience]} » ${PERIOD_LABEL[enrollment.period]} ` +
          `pour ${combinationLabel(combination)} : prix à saisir par l’accueil.`,
      },
    };
  }
  return { status: "ok", row, combination };
}

function price(
  enrollment: EnrollmentRequest,
  pkg: Package,
  packages: readonly Package[],
  request: TariffRequest,
): EnrollmentResult {
  const { reference } = enrollment;
  if (pkg.status === "error") return { reference, status: "error", error: pkg.error };
  const { row, combination } = pkg;

  const grossPriceCents = row.priceCents;
  let remaining = grossPriceCents;
  const discounts = request.discounts.map((rule): DiscountDetail => {
    const decision = evaluate(rule, enrollment, request.enrollments, packages);
    if (decision.status === "rejected") {
      return { code: rule.code, status: "rejected", amountCents: 0, reason: decision.reason };
    }
    const amount = Math.min(discountAmount(rule, grossPriceCents), remaining);
    remaining -= amount;
    return { code: rule.code, status: "applied", amountCents: amount, reason: decision.reason };
  });
  const discountCents = grossPriceCents - remaining;

  return {
    reference,
    status: "ok",
    tariffRowId: row.id,
    packageLabel: combinationLabel(combination),
    grossPriceCents,
    discounts,
    discountCents,
    netPriceCents: grossPriceCents - discountCents,
  };
}

function findRow(
  grid: readonly TariffRow[],
  enrollment: EnrollmentRequest,
  combination: number[],
): TariffRow | undefined {
  const candidates = grid.filter(
    (l) =>
      l.audience === enrollment.audience &&
      l.period === enrollment.period &&
      sameDurations(sort(l.combination), combination),
  );
  const discipline = disciplineUnique(enrollment.courses);
  return (
    (discipline !== null ? candidates.find((l) => l.disciplineId === discipline) : undefined) ??
    candidates.find((l) => l.disciplineId === null)
  );
}

type Decision = { status: "applied" | "rejected"; reason: string };

function evaluate(
  rule: DiscountRule,
  enrollment: EnrollmentRequest,
  all: readonly EnrollmentRequest[],
  packages: readonly Package[],
): Decision {
  if (rule.code !== "fratrie") {
    return { status: "rejected", reason: "Type de réduction non pris en charge par le moteur de tarif" };
  }

  const eligible = (p: Audience) => rule.audiences.length === 0 || rule.audiences.includes(p);
  if (!eligible(enrollment.audience)) {
    const audiences = rule.audiences.map((p) => PUBLIC_LABEL[p]).join(", ");
    return {
      status: "rejected",
      reason: rule.audiences.length === 1 ? `Réservée au public ${audiences}` : `Réservée aux publics ${audiences}`,
    };
  }

  // Distinct students of the payer in an eligible audience, including those whose
  // package is to be entered by hand or is a two-disciplines package (#155 Q1).
  const ranked = rankedStudents(all, packages, (i) => eligible(i.audience));
  const countLabel = `${ranked.length} ${studentWord(rule, ranked.length)} du même payeur`;
  if (ranked.length < rule.minStudents) {
    return { status: "rejected", reason: `${countLabel}, ${rule.minStudents} requis` };
  }

  // #290: the students ranked before `fromRank`, most expensive package first, pay full price.
  const fullPrice = new Set(ranked.slice(0, rule.fromRank - 1));
  if (enrollment.studentIds.some((id) => fullPrice.has(id))) {
    const highest =
      fullPrice.size === 1 ? "forfait le plus élevé" : `un des ${fullPrice.size} forfaits les plus élevés`;
    return { status: "rejected", reason: `Plein tarif : ${highest} des ${countLabel}` };
  }

  if (!rule.combinableWithMultiDiscipline && new Set(enrollment.courses.map((c) => c.disciplineId)).size >= 2) {
    return { status: "rejected", reason: "Non cumulable avec un forfait 2 disciplines" };
  }

  return { status: "applied", reason: `${countLabel} : −${value(rule)}` };
}

/**
 * Distinct students of the `included` enrollments, from the most expensive to the cheapest
 * (#290). A student's price is the sum of their packages (a child enrolled with both
 * businesses has two); a package to be entered by hand has no grid price and ranks its
 * students first, as paying full price. Ties keep the order the students first appear in
 * `all`: callers give the saved enrollments first, oldest first, so a newcomer at the same
 * price never takes the full price over from a sibling already enrolled.
 */
function rankedStudents(
  all: readonly EnrollmentRequest[],
  packages: readonly Package[],
  included: (e: EnrollmentRequest) => boolean,
): string[] {
  const prices = new Map<string, number>();
  all.forEach((e, i) => {
    if (!included(e)) return;
    const pkg = packages[i];
    const cents = pkg.status === "ok" ? pkg.row.priceCents : Number.POSITIVE_INFINITY;
    for (const id of e.studentIds) prices.set(id, (prices.get(id) ?? 0) + cents);
  });
  // A Map keeps insertion order and the sort is stable: ties stay in order of appearance.
  return [...prices.entries()].sort(([, a], [, b]) => b - a).map(([id]) => id);
}

function discountAmount(rule: DiscountRule, priceCents: number): number {
  return rule.rateBps !== null ? applyRate(priceCents, rule.rateBps) : (rule.amountCents as number);
}

/** A misconfigured discount is a data error, not a case to display. */
function checkRule(rule: DiscountRule) {
  if ((rule.rateBps === null) === (rule.amountCents === null)) {
    throw new TypeError(`Réduction « ${rule.code} » : renseigner un taux ou un montant, pas les deux`);
  }
  if (!Number.isInteger(rule.fromRank) || rule.fromRank < 1) {
    throw new TypeError(`Réduction « ${rule.code} » : rang de départ invalide (${rule.fromRank})`);
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const PUBLIC_LABEL: Record<Audience, string> = {
  child: "enfant",
  adult: "adulte",
  couple: "couple",
  student: "étudiant",
};

const PERIOD_LABEL: Record<Period, string> = {
  quarter: "au trimestre",
  year: "à l’année",
  single: "à l’unité",
};

/** « enfant(s) » if the rule targets children only, « danseur(s) » otherwise. */
function studentWord(rule: DiscountRule, count: number): string {
  const name = rule.audiences.length === 1 && rule.audiences[0] === "child" ? "enfant" : "danseur";
  return count > 1 ? `${name}s` : name;
}

function value(rule: DiscountRule): string {
  return rule.rateBps !== null
    ? `${(rule.rateBps / 100).toLocaleString("fr-FR")} %`
    : formatEuros(rule.amountCents as number);
}

/** [45, 60] → « 45 min + 1 h 00 » */
export function combinationLabel(combination: readonly number[]): string {
  return combination
    .map((m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`))
    .join(" + ");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sort(durations: readonly number[]): number[] {
  for (const d of durations) {
    if (!Number.isInteger(d) || d <= 0) throw new TypeError(`Durée de cours invalide : ${d}`);
  }
  return [...durations].sort((a, b) => a - b);
}

function sameDurations(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i]);
}

/** The discipline shared by all courses, or null if they mix several. */
function disciplineUnique(courses: readonly ChosenCourse[]): string | null {
  const disciplines = new Set(courses.map((c) => c.disciplineId));
  return disciplines.size === 1 ? [...disciplines][0] : null;
}
