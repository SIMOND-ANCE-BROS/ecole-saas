import { split } from "../../lib/money";

export type ScheduleRequest = {
  amountCents: number;
  installmentCount: number;
  /** Date of the first installment, `YYYY-MM-DD`. */
  firstDate: string;
  /** Gap between two installments, in months (1 by default). */
  monthInterval?: number;
};

export type Installment = { rank: number; plannedDate: string; amountCents: number };

/**
 * Splits an amount into installments. Count, first date and interval are
 * parameters (specific to each school); the leftover cents go on the first
 * installment (`split`). Each date is computed from the first one, brought
 * back to the last day of the month if needed.
 */
export function computeSchedule(request: ScheduleRequest): Installment[] {
  const {
    amountCents: amountCents,
    installmentCount: installmentCount,
    firstDate: firstDate,
    monthInterval: monthInterval = 1,
  } = request;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new TypeError(`Montant invalide : ${amountCents}`);
  }
  if (!Number.isInteger(monthInterval) || monthInterval < 1) {
    throw new TypeError(`Intervalle invalide : ${monthInterval}`);
  }
  readDate(firstDate);

  return split(amountCents, installmentCount).map((amount, i) => ({
    rank: i + 1,
    plannedDate: addMonths(firstDate, i * monthInterval),
    amountCents: amount,
  }));
}

/** `YYYY-MM-DD` + n months, brought back to the last day of the month (31 January + 1 → 28 or 29 February). */
export function addMonths(date: string, month: number): string {
  const { annee, month: m, day: day } = readDate(date);
  const index = annee * 12 + (m - 1) + month;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${two(targetMonth)}-${two(targetDay)}`;
}

function readDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const [annee, month, day] = (match ?? []).slice(1).map(Number);
  if (!match || month < 1 || month > 12 || day < 1 || day > daysInMonth(annee, month)) {
    throw new TypeError(`Date invalide (YYYY-MM-DD attendu) : ${date}`);
  }
  return { annee, month: month, day: day };
}

function daysInMonth(annee: number, month: number): number {
  // Day 0 of the next month = last day of the month, in UTC to avoid any time zone effect.
  return new Date(Date.UTC(annee, month, 0)).getUTCDate();
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}
