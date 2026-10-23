import { applyRate, formatEuros } from "../../lib/money";
import type {
  ChosenCourse,
  EnrollmentRequest,
  TariffRequest,
  DiscountDetail,
  TariffRow,
  Period,
  Public,
  DiscountRule,
  EnrollmentResult,
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

  const enrollments = request.enrollments.map((enrollment) => price(enrollment, request));
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

function price(enrollment: EnrollmentRequest, request: TariffRequest): EnrollmentResult {
  const { reference, courses: cours } = enrollment;
  if (cours.length === 0) {
    return {
      reference,
      status: "erreur",
      error: { code: "aucun_cours", message: "Aucun cours choisi : impossible de déterminer le forfait." },
    };
  }

  const combination = sort(cours.map((c) => c.durationMinutes));
  const row = findRow(request.grid, enrollment, combination);
  if (!row) {
    return {
      reference,
      status: "erreur",
      error: {
        code: "combinaison_absente",
        message:
          `Aucun forfait « ${PUBLIC_LABEL[enrollment.audience]} » ${PERIOD_LABEL[enrollment.period]} ` +
          `pour ${combinationLabel(combination)} : prix à saisir par l’accueil.`,
      },
    };
  }

  const grossPriceCents = row.priceCents;
  let remaining = grossPriceCents;
  const discounts = request.discounts.map((rule): DiscountDetail => {
    const decision = evaluate(rule, enrollment, request.enrollments);
    if (decision.status === "ecartee") {
      return { code: rule.code, status: "ecartee", amountCents: 0, pattern: decision.pattern };
    }
    const amount = Math.min(discountAmount(rule, grossPriceCents), remaining);
    remaining -= amount;
    return { code: rule.code, status: "appliquee", amountCents: amount, pattern: decision.pattern };
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
    (discipline !== null && candidates.find((l) => l.disciplineId === discipline)) ||
    candidates.find((l) => l.disciplineId === null)
  );
}

type Decision = { status: "appliquee" | "ecartee"; pattern: string };

function evaluate(rule: DiscountRule, enrollment: EnrollmentRequest, toutes: readonly EnrollmentRequest[]): Decision {
  if (rule.code !== "fratrie") {
    return { status: "ecartee", pattern: "Type de réduction non pris en charge par le moteur de tarif" };
  }

  const eligible = (p: Public) => rule.audiences.length === 0 || rule.audiences.includes(p);
  if (!eligible(enrollment.audience)) {
    const audiences = rule.audiences.map((p) => PUBLIC_LABEL[p]).join(", ");
    return {
      status: "ecartee",
      pattern: rule.audiences.length === 1 ? `Réservée au public ${audiences}` : `Réservée aux publics ${audiences}`,
    };
  }

  // Distinct students of the payer in an eligible audience, including those whose
  // package is to be entered by hand or is a two-disciplines package.
  const students = new Set(toutes.filter((i) => eligible(i.audience)).flatMap((i) => i.studentIds));
  const countLabel = `${students.size} ${studentWord(rule, students.size)} du même payeur`;
  if (students.size < rule.minStudents) {
    return { status: "ecartee", pattern: `${countLabel}, ${rule.minStudents} requis` };
  }

  if (!rule.combinableWithMultiDiscipline && new Set(enrollment.courses.map((c) => c.disciplineId)).size >= 2) {
    return { status: "ecartee", pattern: "Non cumulable avec un forfait 2 disciplines" };
  }

  return { status: "appliquee", pattern: `${countLabel} : -${value(rule)}` };
}

function discountAmount(rule: DiscountRule, priceCents: number): number {
  return rule.rateBps !== null ? applyRate(priceCents, rule.rateBps) : (rule.amountCents as number);
}

/** A misconfigured discount is a data error, not a case to display. */
function checkRule(rule: DiscountRule) {
  if ((rule.rateBps === null) === (rule.amountCents === null)) {
    throw new TypeError(`Réduction « ${rule.code} » : renseigner un taux ou un montant, pas les deux`);
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const PUBLIC_LABEL: Record<Public, string> = {
  enfant: "enfant",
  adulte: "adulte",
  couple: "couple",
  etudiant: "étudiant",
};

const PERIOD_LABEL: Record<Period, string> = {
  trimestre: "au trimestre",
  annee: "à l’année",
  unite: "à l’unité",
};

/** « enfant(s) » if the rule targets children only, « danseur(s) » otherwise. */
function studentWord(rule: DiscountRule, count: number): string {
  const name = rule.audiences.length === 1 && rule.audiences[0] === "enfant" ? "enfant" : "danseur";
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
