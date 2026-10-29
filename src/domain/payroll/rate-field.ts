/** The course form's instructor rate field and rate labels (#191, #268), pure. */

import { formatEuros, typedEuros } from "../../lib/money";
import { courseRateAllowed, type PayMode } from "./rate";

/** Rate unit according to the pay mode. */
export const PAY_UNITS = { hourly: "heure", per_lesson: "séance", monthly_flat: "mois" } as const;

/** A course's own rate with the pay mode it was typed in. */
export type StoredRate = { cents: number; payMode: PayMode };

/**
 * « 45,50 € / heure »; a rate stored for a monthly flat instructor has no unit
 * of its own: « 30,00 €, tarif non utilisé (forfait mensuel) » (#192, #268).
 */
export const courseRateLabel = (rate: StoredRate) =>
  rate.payMode === "monthly_flat"
    ? `${formatEuros(rate.cents)}, tarif non utilisé (forfait mensuel)`
    : `${formatEuros(rate.cents)} / ${PAY_UNITS[rate.payMode]}`;

export type RateFieldState = {
  /** Pay mode of the instructor chosen in the form; undefined: not known. */
  payMode: PayMode | undefined;
  /** The chosen instructor is the course's saved one. */
  ownInstructor: boolean;
  /** The course's stored rate; null: none, or a new course. */
  saved: StoredRate | null;
  /** The field as typed. */
  typed: string;
  /** The director asked to keep the amount but in the current pay mode (« Convertir au mode actuel »). */
  convert: boolean;
};

export type RateField = {
  /** The instructor's pay mode takes a rate per course. */
  allowed: boolean;
  /** A rate stored for a monthly flat instructor: the field stays so that it can be emptied (#192 Q2). */
  unused: boolean;
  /** Unit of a rate of the instructor's older pay mode, left untouched: shown, kept as it is (#268). */
  oldUnit: PayMode | null;
  /** Unit of the amount in the field; null: none to show (« € » alone). */
  shownUnit: PayMode | null;
  /** What the form sends: undefined lets the server keep (same instructor) or drop (new one) the stored rate. */
  sent: string | undefined;
};

/** What the rate field shows and sends. */
export function rateField(s: RateFieldState): RateField {
  const allowed = s.payMode !== undefined && courseRateAllowed(s.payMode);
  const saved = s.ownInstructor ? s.saved : null;
  const untouched = saved !== null && s.typed === typedEuros(saved.cents) && !s.convert;
  const unused = !allowed && saved !== null;
  // A rate typed in another pay mode than the instructor's current one.
  const stale = allowed && saved !== null && saved.payMode !== s.payMode;
  const oldUnit = stale && untouched ? saved.payMode : null;
  const unit = oldUnit ?? (allowed ? s.payMode : unused && untouched ? saved.payMode : undefined);
  // A monthly flat "unit" is no unit of a rate per course.
  const shownUnit = unit === undefined || unit === "monthly_flat" ? null : unit;
  const sent = allowed && !stale ? s.typed : (stale || unused) && !untouched ? s.typed : undefined;
  return { allowed, unused, oldUnit, shownUnit, sent };
}
