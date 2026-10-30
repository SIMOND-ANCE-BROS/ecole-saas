import { frenchDate } from "../../lib/dates";
import { addMonths } from "../invoicing/installments";
import type { Period } from "../tariff/types";

/**
 * Season quarters (#291): the periods a quarterly package is sold and cashed by. They are
 * data of each season (`season_quarter`, Paramètres › Saisons), never dates written here.
 */

export type QuarterDates = { label: string; startDate: string; endDate: string };
export type SeasonQuarter = QuarterDates & { id: string };

/** Quarters a new season gets until management edits them: three periods of three months… */
export const DEFAULT_QUARTER_COUNT = 3;
export const DEFAULT_QUARTER_MONTHS = 3;

const ordinal = (n: number) => (n === 1 ? "1er" : `${n}e`);
const firstOfMonth = (iso: string) => `${iso.slice(0, 8)}01`;
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const byStart = <Q extends QuarterDates>(a: Q, b: Q) => a.startDate.localeCompare(b.startDate);

/**
 * …ending with the season: the last one ends on the season's last day and each one starts on
 * the first day of a month, so a season from September to June gets October–December,
 * January–March and April–June (the school's answer: September is open house and trial
 * lessons, not a quarter). A quarter starting before the season is clipped to its first day;
 * one wholly before it is left out. Labels « 1er trimestre », « 2e trimestre »…
 */
export function defaultQuarters(season: { startDate: string; endDate: string }): QuarterDates[] {
  const lastMonth = firstOfMonth(season.endDate);
  const periods: { startDate: string; endDate: string }[] = [];
  for (let k = 0; k < DEFAULT_QUARTER_COUNT; k++) {
    const startDate = addMonths(lastMonth, -(k * DEFAULT_QUARTER_MONTHS + DEFAULT_QUARTER_MONTHS - 1));
    const endDate = k === 0 ? season.endDate : dayBefore(addMonths(lastMonth, -(k * DEFAULT_QUARTER_MONTHS) + 1));
    if (endDate < season.startDate) break;
    periods.unshift({ startDate: startDate < season.startDate ? season.startDate : startDate, endDate });
  }
  return periods.map((p, i) => ({ label: `${ordinal(i + 1)} trimestre`, ...p }));
}

/**
 * Quarters a quarterly enrollment covers from its enrollment day, in date order: the ones not
 * over yet. Open question #291 Q1, default until the school answers: a quarter already started
 * counts in full (« Un élève s’inscrit au trimestre le 15 novembre : paie-t-il le trimestre
 * octobre-décembre en entier ? »). Q2 default: enrolled for every remaining quarter.
 */
export function coveredQuarters<Q extends QuarterDates>(quarters: readonly Q[], enrolledOn: string): Q[] {
  return quarters.filter((q) => q.endDate >= enrolledOn).sort(byStart);
}

/** Why a quarterly enrollment made on `enrolledOn` cannot be saved, in French; null when it can. */
export function quarterEnrollmentRefusal(quarters: readonly QuarterDates[], enrolledOn: string): string | null {
  if (quarters.length === 0)
    return "Cette saison n’a pas de trimestres : définissez-les dans Paramètres › Saisons, ou choisissez l’année.";
  if (coveredQuarters(quarters, enrolledOn).length === 0)
    return "Plus aucun trimestre de la saison n’est à venir : choisissez l’année ou une autre formule.";
  return null;
}

/**
 * What an enrollment costs over its season. Its net price is one quarter's for a quarterly
 * package: the siblings discount is taken off each quarter alike (#291 Q3 default), and the
 * quarters all owe the same whole cents, so nothing is split nor rounded. Yearly and drop-in:
 * the net price once.
 */
export function seasonDueCents(e: { period: Period; netPriceCents: number; quarterCount: number }): number {
  return e.period === "quarter" ? e.netPriceCents * e.quarterCount : e.netPriceCents;
}

export type QuarterDue = { quarterId: string; label: string; dueOn: string; amountCents: number };

/**
 * One due amount per covered quarter, for the installments of the invoice (#302): the
 * quarter's price, cashed on the quarter's first day, or on the enrollment day for a quarter
 * already started (#291 Q2 default: each quarter due at its own cashing).
 */
export function quarterlyDues(
  covered: readonly SeasonQuarter[],
  quarterPriceCents: number,
  enrolledOn: string,
): QuarterDue[] {
  if (!Number.isInteger(quarterPriceCents) || quarterPriceCents < 0)
    throw new TypeError(`Montant invalide : ${quarterPriceCents}`);
  return [...covered].sort(byStart).map((q) => ({
    quarterId: q.id,
    label: q.label,
    dueOn: q.startDate > enrolledOn ? q.startDate : enrolledOn,
    amountCents: quarterPriceCents,
  }));
}

const month = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const monthOf = (iso: string) => month.format(new Date(`${iso}T00:00:00Z`));

/** The months a quarter spans, in French: « oct.–déc. », « janv. » for a quarter within one month. */
export function quarterMonths(q: { startDate: string; endDate: string }): string {
  const [from, to] = [monthOf(q.startDate), monthOf(q.endDate)];
  return from === to ? from : `${from}–${to}`;
}

/** Quarters that dates of a season would leave (partly) outside it. */
export function quartersOutside<Q extends QuarterDates>(
  quarters: readonly Q[],
  season: { startDate: string; endDate: string },
): Q[] {
  return quarters.filter((q) => q.startDate < season.startDate || q.endDate > season.endDate);
}

/**
 * Why a season's quarters cannot be saved, in French; null when they can. Each quarter lies
 * within the season, two never overlap (a gap is fine: holidays, an open-house month) and
 * labels differ. No quarter at all is allowed: a school may sell no quarterly package.
 */
export function quartersRefusal(
  quarters: readonly QuarterDates[],
  season: { startDate: string; endDate: string },
): string | null {
  const sorted = [...quarters].sort(byStart);
  const backwards = sorted.find((q) => q.endDate < q.startDate);
  if (backwards) return `Le trimestre « ${backwards.label} » finit avant de commencer.`;
  const [outside] = quartersOutside(sorted, season);
  if (outside)
    return `Le trimestre « ${outside.label} » sort de la saison (du ${frenchDate(season.startDate)} au ${frenchDate(season.endDate)}).`;
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].startDate <= sorted[i - 1].endDate)
      return `Les trimestres « ${sorted[i - 1].label} » et « ${sorted[i].label} » se chevauchent.`;
  const seen = new Set<string>();
  for (const q of sorted) {
    const key = q.label.trim().toLocaleLowerCase("fr");
    if (seen.has(key)) return `Deux trimestres s’appellent « ${q.label.trim()} ».`;
    seen.add(key);
  }
  return null;
}
