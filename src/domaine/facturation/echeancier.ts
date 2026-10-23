import { split } from "../../lib/montant";

export type ScheduleRequest = {
  amountCents: number;
  installmentCount: number;
  /** Date de la première échéance, `YYYY-MM-DD`. */
  firstDate: string;
  /** Écart entre deux échéances, en mois (1 par défaut). */
  monthInterval?: number;
};

export type Installment = { rank: number; plannedDate: string; amountCents: number };

/**
 * Découpe un montant en échéances. Nombre, première date et intervalle sont
 * des paramètres (propres à chaque école) ; les centimes restants vont sur la
 * première échéance (`repartir`). Chaque date est calculée depuis la première,
 * ramenée au dernier jour du mois si besoin.
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

/** `YYYY-MM-DD` + n mois, ramené au dernier jour du mois (31 janvier + 1 → 28 ou 29 février). */
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
  // Jour 0 du mois suivant = dernier jour du mois, en UTC pour éviter tout effet de fuseau.
  return new Date(Date.UTC(annee, month, 0)).getUTCDate();
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}
