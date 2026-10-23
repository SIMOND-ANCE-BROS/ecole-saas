/**
 * Dates des séances d'un cours hebdomadaire. Les jours fériés ne sont pas
 * déduits automatiquement : l'école les saisit comme fermetures, au même
 * titre que les vacances, car chaque école décide d'ouvrir ou non.
 */

export type Period = { start: string; end: string };

const ONE_DAY = 86_400_000;
const toDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Dates `YYYY-MM-DD` du `jourSemaine` (1 = lundi … 7 = dimanche) entre `debut` et `fin` inclus, hors fermetures. */
export function lessonDates({
  start: start,
  end: end,
  weekday: weekday,
  closures: closures,
}: Period & { weekday: number; closures: Period[] }): string[] {
  const origin = toDay(start);
  const isoDay = ((new Date(origin).getUTCDay() + 6) % 7) + 1;
  const dates: string[] = [];
  for (let t = origin + ((weekday - isoDay + 7) % 7) * ONE_DAY; t <= toDay(end); t += 7 * ONE_DAY) {
    const date = toIso(t);
    if (!closures.some((f) => f.start <= date && date <= f.end)) dates.push(date);
  }
  return dates;
}

/**
 * Récurrence d'un cours (#90) : chaque semaine ou une semaine sur deux, sur
 * toute la saison ou une période (`dateDebut`, `dateFin`), ou à des dates
 * précises (stage, cours exceptionnel).
 */
export type Recurrence =
  | { type: "hebdomadaire" | "quinzaine"; weekday: number; startDate: string | null; endDate: string | null }
  | { type: "dates"; dates: string[] };

/**
 * Dates des séances d'un cours dans la saison. Une fermeture supprime la
 * séance d'un cours régulier sans décaler l'alternance d'un cours « une
 * semaine sur deux » (calée sur sa première date). Les dates précises ne
 * tiennent pas compte des fermetures : un stage a souvent lieu pendant les
 * vacances.
 */
export function courseDates(r: Recurrence, season: Period, closures: Period[]): string[] {
  if (r.type === "dates") return [...new Set(r.dates)].filter((d) => season.start <= d && d <= season.end).sort();
  const start = r.startDate && r.startDate > season.start ? r.startDate : season.start;
  const end = r.endDate && r.endDate < season.end ? r.endDate : season.end;
  if (start > end) return [];
  const toutes = lessonDates({ start, end, weekday: r.weekday, closures: [] });
  const retained = r.type === "quinzaine" ? toutes.filter((_, i) => i % 2 === 0) : toutes;
  return retained.filter((date) => !closures.some((f) => f.start <= date && date <= f.end));
}
