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
  for (let t = depart + ((jourSemaine - jourIso + 7) % 7) * UN_JOUR; t <= versJour(fin); t += 7 * UN_JOUR) {
    const date = versIso(t);
    if (!fermetures.some((f) => f.debut <= date && date <= f.fin)) dates.push(date);
  }
  return dates;
}

/**
 * Récurrence d'un cours (#90) : chaque semaine ou une semaine sur deux, sur
 * toute la saison ou une période (`dateDebut`, `dateFin`), ou à des dates
 * précises (stage, cours exceptionnel).
 */
export type Recurrence =
  | { type: "hebdomadaire" | "quinzaine"; jourSemaine: number; dateDebut: string | null; dateFin: string | null }
  | { type: "dates"; dates: string[] };

/**
 * Dates des séances d'un cours dans la saison. Une fermeture supprime la
 * séance d'un cours régulier sans décaler l'alternance d'un cours « une
 * semaine sur deux » (calée sur sa première date). Les dates précises ne
 * tiennent pas compte des fermetures : un stage a souvent lieu pendant les
 * vacances.
 */
export function datesDuCours(r: Recurrence, saison: Periode, fermetures: Periode[]): string[] {
  if (r.type === "dates") return [...new Set(r.dates)].filter((d) => saison.debut <= d && d <= saison.fin).sort();
  const debut = r.dateDebut && r.dateDebut > saison.debut ? r.dateDebut : saison.debut;
  const fin = r.dateFin && r.dateFin < saison.fin ? r.dateFin : saison.fin;
  if (debut > fin) return [];
  const toutes = datesDesSeances({ debut, fin, jourSemaine: r.jourSemaine, fermetures: [] });
  const retenues = r.type === "quinzaine" ? toutes.filter((_, i) => i % 2 === 0) : toutes;
  return retenues.filter((date) => !fermetures.some((f) => f.debut <= date && date <= f.fin));
}
