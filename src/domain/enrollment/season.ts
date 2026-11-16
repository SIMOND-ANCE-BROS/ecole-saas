/**
 * Which season the front desk may enroll in (#376 Q1, owner's decision of 2026-11-15): the
 * current season and later ones. In June, right after the gala, re-enrollments for the next
 * season start while the ending one is still current. A past season shows its enrollments but
 * takes no new one.
 */

type SeasonStart = { id: string; label: string; startDate: string };

/** Whether an enrollment may be made in `season`, `current` being the school's current season. */
export function mayEnrollIn(season: SeasonStart, current: SeasonStart): boolean {
  return season.startDate >= current.startDate;
}

/** Why an enrollment cannot be made in `season`, in French; null when it can. */
export function enrollSeasonRefusal(season: SeasonStart, current: SeasonStart): string | null {
  return mayEnrollIn(season, current)
    ? null
    : `La saison ${season.label} est passée : on inscrit en ${current.label} ou dans une saison suivante.`;
}

/**
 * The record's « Inscrire » button for the season shown: it enrolls in that season, named
 * when it is not the current one. Null on a past season: no button.
 */
export function enrollButtonLabel(firstName: string, shown: SeasonStart, current: SeasonStart): string | null {
  if (!mayEnrollIn(shown, current)) return null;
  return shown.id === current.id ? `Inscrire ${firstName}` : `Inscrire ${firstName} en ${shown.label}`;
}
