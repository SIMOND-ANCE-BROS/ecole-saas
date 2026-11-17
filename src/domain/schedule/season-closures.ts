import { frenchDate } from "../../lib/dates";

/** Dates of a season or a closure (`YYYY-MM-DD`, both included). */
export type SeasonDates = { startDate: string; endDate: string };

/** A closure as the season edit checks it: its label and dates (`YYYY-MM-DD`, both included). */
export type DatedClosure = { label: string; startDate: string; endDate: string };

/**
 * Whether a closure falls (even partly) outside a season's dates (#193, #194): the one rule,
 * used when a closure is added and when a season's dates change. A closure on the very bounds
 * is inside.
 */
export function isOutsideSeason(c: SeasonDates, season: SeasonDates): boolean {
  return c.startDate < season.startDate || c.endDate > season.endDate;
}

/** The closures new season dates would leave (partly) outside, by start date then label. */
export function closuresOutside<C extends DatedClosure>(closures: readonly C[], season: SeasonDates): C[] {
  return closures
    .filter((c) => isOutsideSeason(c, season))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.label.localeCompare(b.label, "fr"));
}

/** « Zz Gala (du 28/06/2027 au 05/07/2027) », « Zz Rentrée (le 25/08/2026) ». */
function named(c: DatedClosure): string {
  return c.startDate === c.endDate
    ? `${c.label} (le ${frenchDate(c.startDate)})`
    : `${c.label} (du ${frenchDate(c.startDate)} au ${frenchDate(c.endDate)})`;
}

/**
 * Why new season dates are refused because of its closures, in French; null when every closure
 * stays inside (#194, owner decision 2026-11-15). Shortening a season past a closure is refused,
 * naming each closure that would fall outside with its dates: management deletes those closures
 * first (a closure cannot be edited: it is deleted, then created again with the right dates).
 * Nothing is clipped or deleted automatically.
 */
export function seasonClosuresRefusal(closures: readonly DatedClosure[], season: SeasonDates): string | null {
  const outside = closuresOutside(closures, season);
  if (outside.length === 0) return null;
  const names = outside.map(named).join(", ");
  return outside.length === 1
    ? `Cette fermeture sortirait de la saison : ${names}. Supprimez-la dans Planning › Fermetures, puis recréez-la avec les bonnes dates.`
    : `Ces fermetures sortiraient de la saison : ${names}. Supprimez-les dans Planning › Fermetures, puis recréez-les avec les bonnes dates.`;
}
