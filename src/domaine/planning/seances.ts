/**
 * Dates des séances d'un cours hebdomadaire. Les jours fériés ne sont pas
 * déduits automatiquement : l'école les saisit comme fermetures, au même
 * titre que les vacances, car chaque école décide d'ouvrir ou non.
 */

export type Periode = { debut: string; fin: string };

const UN_JOUR = 86_400_000;
const versJour = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const versIso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Dates `YYYY-MM-DD` du `jourSemaine` (1 = lundi … 7 = dimanche) entre `debut` et `fin` inclus, hors fermetures. */
export function datesDesSeances({
  debut,
  fin,
  jourSemaine,
  fermetures,
}: Periode & { jourSemaine: number; fermetures: Periode[] }): string[] {
  const depart = versJour(debut);
  const jourIso = ((new Date(depart).getUTCDay() + 6) % 7) + 1;
  const dates: string[] = [];
  for (let t = depart + (((jourSemaine - jourIso + 7) % 7) * UN_JOUR); t <= versJour(fin); t += 7 * UN_JOUR) {
    const date = versIso(t);
    if (!fermetures.some((f) => f.debut <= date && date <= f.fin)) dates.push(date);
  }
  return dates;
}
