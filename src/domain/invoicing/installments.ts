export type ScheduleRequest = {
  amountCents: number;
  installmentCount: number;
  /** Date of the first installment, `YYYY-MM-DD`. */
  firstDate: string;
  /** Gap between two installments, in months (1 by default). */
  monthInterval?: number;
  /**
   * Every installment but the first is a whole multiple of this unit (#176 Q2: 100, rounded to
   * the euro); the remainder, cents included, goes on the first. 1 by default: to the cent.
   */
  roundingUnitCents?: number;
  /** Latest date the last installment may fall on, `YYYY-MM-DD` (#176 Q3: the season's end). */
  lastDate?: string;
};

export type Installment = { rank: number; plannedDate: string; amountCents: number };

/**
 * Splits an amount into installments. Count, first date, interval, rounding unit and last date
 * are parameters (school settings, #176): every installment but the first is the amount's
 * share rounded down to `roundingUnitCents`, the first takes the rest, so the installments
 * add up to the amount to the cent. Each date is computed from the first one, brought back to
 * the last day of the month if needed. A RangeError when the last installment would fall
 * after `lastDate`, or when the rounding leaves an installment of 0 (amount too small): the
 * callers offer only the plans that fit (`planSchedule`).
 */
export function computeSchedule(request: ScheduleRequest): Installment[] {
  const { amountCents, installmentCount, firstDate, monthInterval = 1, roundingUnitCents = 1, lastDate } = request;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new TypeError(`Montant invalide : ${amountCents}`);
  }
  if (!Number.isInteger(installmentCount) || installmentCount < 1) {
    throw new TypeError(`Nombre d’échéances invalide : ${installmentCount}`);
  }
  if (!Number.isInteger(monthInterval) || monthInterval < 1) {
    throw new TypeError(`Intervalle invalide : ${monthInterval}`);
  }
  if (!Number.isInteger(roundingUnitCents) || roundingUnitCents < 1) {
    throw new TypeError(`Arrondi invalide : ${roundingUnitCents}`);
  }
  readDate(firstDate);
  if (lastDate !== undefined) readDate(lastDate);

  // Integer division of two positive integers: no floating-point amount.
  const base = Math.trunc(amountCents / (installmentCount * roundingUnitCents)) * roundingUnitCents;
  if (installmentCount > 1 && base === 0) {
    throw new RangeError(`Montant trop petit pour ${installmentCount} échéances : ${amountCents}`);
  }
  const installments = Array.from({ length: installmentCount }, (_, i) => ({
    rank: i + 1,
    plannedDate: addMonths(firstDate, i * monthInterval),
    amountCents: i === 0 ? amountCents - base * (installmentCount - 1) : base,
  }));
  const last = installments[installments.length - 1].plannedDate;
  if (lastDate !== undefined && last > lastDate) {
    throw new RangeError(`Dernière échéance le ${last}, après le ${lastDate}`);
  }
  return installments;
}

/** `YYYY-MM-DD` + n months, brought back to the last day of the month (31 January + 1 → 28 or 29 February). */
export function addMonths(date: string, month: number): string {
  const { year, month: m, day } = readDate(date);
  const index = year * 12 + (m - 1) + month;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${two(targetMonth)}-${two(targetDay)}`;
}

function readDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const [year, month, day] = (match ?? []).slice(1).map(Number);
  if (!match || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new TypeError(`Date invalide (YYYY-MM-DD attendu) : ${date}`);
  }
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month = last day of the month, in UTC to avoid any time zone effect.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}
