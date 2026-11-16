import { formatEuros } from "../../lib/money";
import { computeSchedule } from "./installments";

/**
 * The school's installment plans (#176): how many installments a family may choose for its
 * yearly packages (lesson packs and drop-in packages are paid in one installment, #436), the
 * day of the month they are due, the rounding unit, all school data (`installment_plan_setting`). The
 * last installment falls on or before the season's end (owner decision, 2026-11-15). Pure
 * functions, no database.
 */
export type InstallmentPlanSetting = {
  /** Installment counts offered, ascending: [1, 3, 10]. */
  counts: readonly number[];
  /** Day of the month every installment is due, 1 to 28 (every month has it). */
  dueDay: number;
  /** Every installment but the first is a multiple of it (100: to the euro). */
  roundingUnitCents: number;
};

/** A school with no setting row: one installment, due on the 1st, to the cent. */
export const DEFAULT_INSTALLMENT_PLANS: InstallmentPlanSetting = { counts: [1], dueDay: 1, roundingUnitCents: 1 };

export const MAX_INSTALLMENTS = 12;
export const MAX_DUE_DAY = 28;
/** Rounding units the settings screen offers: to the cent, to the euro. */
export const ROUNDING_UNITS = [1, 100] as const;

/** Why a setting cannot be saved, in French; null when it can. Mirrors the table's checks. */
export function planSettingRefusal(s: InstallmentPlanSetting): string | null {
  if (s.counts.length === 0) return "Proposez au moins un plan de paiement.";
  if (s.counts.some((c) => !Number.isInteger(c) || c < 1 || c > MAX_INSTALLMENTS))
    return `Un plan compte de 1 à ${MAX_INSTALLMENTS} échéances.`;
  if (new Set(s.counts).size !== s.counts.length) return "Chaque plan n’est proposé qu’une fois.";
  if (!Number.isInteger(s.dueDay) || s.dueDay < 1 || s.dueDay > MAX_DUE_DAY)
    return `Le jour d’échéance va du 1er au ${MAX_DUE_DAY} du mois.`;
  if (!(ROUNDING_UNITS as readonly number[]).includes(s.roundingUnitCents)) return "Arrondi inconnu.";
  return null;
}

/** The counts ascending, each once: how a setting is saved. */
export const sortedCounts = (counts: readonly number[]) => [...new Set(counts)].sort((a, b) => a - b);

/** The first `dueDay` of a month on or after `from` (`YYYY-MM-DD`). */
export function firstDueDate(from: string, dueDay: number): string {
  const [year, month, day] = from.split("-").map(Number);
  const two = (n: number) => String(n).padStart(2, "0");
  if (day <= dueDay) return `${year}-${two(month)}-${two(dueDay)}`;
  return month === 12 ? `${year + 1}-01-${two(dueDay)}` : `${year}-${two(month + 1)}-${two(dueDay)}`;
}

export type PlanWindow = {
  season: { startDate: string; endDate: string };
  /** The day of the drafting, `YYYY-MM-DD` in Europe/Paris. */
  today: string;
};

/**
 * When a plan's installments fall: monthly, the last on or before the season's end. Drafted
 * during the season, from the first due day on or after today. Drafted before it starts (June
 * re-enrollments, #436), from the due day of the season's first month (the 5th of September
 * for a season starting on the 13th), never before today: nothing is due before the season's
 * month. When no due day is left in the season (an ended season, #380 Q2), a single
 * installment dated from today.
 */
function planDates(setting: InstallmentPlanSetting, w: PlanWindow) {
  const firstMonth = `${w.season.startDate.slice(0, 8)}01`;
  const from = w.today >= w.season.startDate || w.today > firstMonth ? w.today : firstMonth;
  const first = firstDueDate(from, setting.dueDay);
  return first > w.season.endDate ? { first: from, last: null } : { first, last: w.season.endDate };
}

/** The first installment's date of a plan drafted on `w.today` (#436): what the record says. */
export function planStart(setting: InstallmentPlanSetting, w: PlanWindow): string {
  return planDates(setting, w).first;
}

/** Whether the season has no due day left (ended, #380): a single installment dated today. */
export function noDueDayLeft(setting: InstallmentPlanSetting, w: PlanWindow): boolean {
  return planDates(setting, w).last === null;
}

/**
 * The offered counts whose installments all fall within the season (#176 Q3): what the record
 * offers. A count that does not fit is not offered, never shortened. Only one installment
 * when the season has no due day left (#380 Q2), even if the school offers no one-off plan.
 */
export function plansThatFit(setting: InstallmentPlanSetting, w: PlanWindow): number[] {
  const { first, last } = planDates(setting, w);
  if (last === null) return [1];
  return sortedCounts(setting.counts).filter((count) => monthsFrom(first, count - 1) <= last);
}

/** `first` + n months on the due day (≤ 28: never brought back to a shorter month). */
function monthsFrom(first: string, n: number): string {
  const [year, month, day] = first.split("-").map(Number);
  const index = year * 12 + (month - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type PlanInstallment = { dueOn: string; amountCents: number };
export type PlanResult = { ok: true; installments: PlanInstallment[] } | { ok: false; message: string };

/**
 * An amount's installments under a plan of `count` (#176): due on the setting's day each
 * month, rounded to its unit with the rest on the first, within the season. Refused, in
 * French, when the count is not offered, does not fit the season or splits the amount into
 * installments of 0. Nothing to split (0 €) gives no installment.
 */
export function planSchedule(input: {
  amountCents: number;
  count: number;
  setting: InstallmentPlanSetting;
  window: PlanWindow;
}): PlanResult {
  const { amountCents, count, setting, window } = input;
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new TypeError(`Montant invalide : ${amountCents}`);
  if (!plansThatFit(setting, window).includes(count))
    return !setting.counts.includes(count)
      ? { ok: false, message: `Le paiement en ${count} fois n’est pas proposé par l’école.` }
      : {
          ok: false,
          message: `Le paiement en ${count} fois finirait après la fin de la saison : choisissez moins d’échéances.`,
        };
  if (amountCents === 0) return { ok: true, installments: [] };
  const { first, last } = planDates(setting, window);
  try {
    const schedule = computeSchedule({
      amountCents,
      installmentCount: count,
      firstDate: first,
      roundingUnitCents: setting.roundingUnitCents,
      lastDate: last ?? undefined,
    });
    return { ok: true, installments: schedule.map((i) => ({ dueOn: i.plannedDate, amountCents: i.amountCents })) };
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    return {
      ok: false,
      message: `${formatEuros(amountCents)} ne se partagent pas en ${count} échéances : choisissez moins d’échéances.`,
    };
  }
}

/** « en 3 fois », « en une fois »: a plan as the record names it. */
export const planLabel = (count: number) => (count === 1 ? "en une fois" : `en ${count} fois`);
