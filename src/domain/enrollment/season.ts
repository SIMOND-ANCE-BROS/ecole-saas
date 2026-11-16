/**
 * Which season the front desk may enroll in (#376 Q1, owner's decision of 2026-11-15): the
 * current season and later ones. In June, right after the gala, re-enrollments for the next
 * season start while the ending one is still current. A past season shows its enrollments but
 * takes no new one.
 */

type EnrollSeason = { id: string; label: string; endDate: string };

/**
 * Whether an enrollment may be made in `season` on `today`, `current` being the school's
 * current season (`currentSeason`): that one, or any season not ended yet. Read from the
 * end date, not from the current season's start: in the summer gap `currentSeason` falls back
 * to the latest season, and the season about to start must stay open (as `seasonDraftable`).
 */
export function mayEnrollIn(season: EnrollSeason, current: { id: string }, today: string): boolean {
  return season.id === current.id || season.endDate >= today;
}

/** Why an enrollment cannot be made in `season`, in French; null when it can. */
export function enrollSeasonRefusal(
  season: EnrollSeason,
  current: { id: string; label: string },
  today: string,
): string | null {
  return mayEnrollIn(season, current, today)
    ? null
    : `La saison ${season.label} est terminée : les inscriptions se font en ${current.label} ou dans une saison suivante.`;
}

/**
 * The record's « Inscrire » button for the season shown: it enrolls in that season, named
 * when it is not the current one. Null on a past season: no button.
 */
export function enrollButtonLabel(
  firstName: string,
  shown: EnrollSeason,
  current: { id: string },
  today: string,
): string | null {
  if (!mayEnrollIn(shown, current, today)) return null;
  return shown.id === current.id ? `Inscrire ${firstName}` : `Inscrire ${firstName} en ${shown.label}`;
}
