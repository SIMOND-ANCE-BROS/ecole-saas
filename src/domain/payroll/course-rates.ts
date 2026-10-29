/** Per-course rates on the instructor page (#276), pure. Amounts in integer cents. */

import { parseEuros, typedEuros } from "../../lib/money";
import { courseRateAllowed, rateInCurrentUnit, seasonBlocksPayModeChange, type PayMode } from "./rate";
import { courseRateLabel, type StoredRate } from "./rate-field";

/**
 * Whether a course's rate can still be set from the instructor page: courses
 * of the current and future seasons (ending today or later, in Paris). Past
 * seasons keep their rates untouched as history (#192 Q5), as for a change of
 * pay mode.
 */
export const courseRateEditable = (seasonEndDate: string, today: string) =>
  seasonBlocksPayModeChange(seasonEndDate, today);

/**
 * The instructor page's two lists, in the given order: every course of the
 * current and future seasons (with or without a rate of its own), and the
 * courses of past seasons that kept a rate of their own (history).
 */
export function courseRateSections<T extends { seasonEndDate: string; rate: StoredRate | null }>(
  courses: readonly T[],
  today: string,
): { editable: T[]; history: T[] } {
  const editable: T[] = [];
  const history: T[] = [];
  for (const c of courses) {
    if (courseRateEditable(c.seasonEndDate, today)) editable.push(c);
    else if (c.rate !== null) history.push(c);
  }
  return { editable, history };
}

/** What the instructor page shows for one course's rate. */
export type ShownRate = {
  /** « Tarif habituel », « 45,50 € / heure »… */
  label: string;
  /** Said under the amount when it is not the rate paid today; null: none. */
  note: string | null;
  /** No rate of its own: the instructor's usual rate applies (named once, above the list). */
  usual: boolean;
};

/**
 * The course's rate as the instructor page shows it: « Tarif habituel » when
 * it has none (its amount is said once, above the list), else its own rate in
 * the unit it was typed in (#268), with a word when that unit is no longer the
 * instructor's pay mode.
 */
export function shownRate(rate: StoredRate | null, payMode: PayMode): ShownRate {
  if (rate === null) return { label: "Tarif habituel", note: null, usual: true };
  const label = courseRateLabel(rate);
  // A monthly flat "unit" already says it is not used.
  if (rate.payMode === "monthly_flat" || rateInCurrentUnit(rate.payMode, payMode))
    return { label, note: null, usual: false };
  return {
    label,
    note: courseRateAllowed(payMode) ? "ancien mode de rémunération" : "non appliqué (forfait mensuel)",
    usual: false,
  };
}

/**
 * Amount the in-place field starts with: the course's own rate when it is in
 * the instructor's current unit; empty otherwise, since an older unit's amount
 * would be read in the new one (#268).
 */
export const rateEditStart = (rate: StoredRate | null, payMode: PayMode) =>
  rate !== null && rateInCurrentUnit(rate.payMode, payMode) ? typedEuros(rate.cents) : "";

/**
 * Whether what is typed would leave the stored rate as it is: nothing to save.
 * Compared with the stored rate, not with the field's starting value: an older
 * unit's rate starts empty (`rateEditStart`), and emptying it is a change (it
 * clears it), as is any amount, which the server then stores in the current
 * unit. « 45,5 », « 45.50 » and « 45,50 » are the same amount; an unreadable
 * one is a change, which the server refuses with its message.
 */
export function rateEditUnchanged(stored: StoredRate | null, payMode: PayMode, typed: string): boolean {
  const t = typed.trim();
  if (t === "") return stored === null;
  return stored !== null && rateInCurrentUnit(stored.payMode, payMode) && parseEuros(t) === stored.cents;
}
