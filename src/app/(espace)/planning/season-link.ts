/**
 * Planning link that keeps the chosen season (`?saison=`, #189). `season` is
 * undefined for the current season, which keeps the usual addresses.
 */
export function withSeason(href: string, season: string | undefined): string {
  if (!season) return href;
  return `${href}${href.includes("?") ? "&" : "?"}saison=${encodeURIComponent(season)}`;
}

/** `?saison=` value for a season: undefined for the current one. */
export function seasonParam(seasonId: string, currentId: string | undefined): string | undefined {
  return seasonId === currentId ? undefined : seasonId;
}

/** Title of the new-course page and panel: names the season when it is not the current one. */
export function newCourseTitle(label: string | undefined, isCurrent: boolean): string {
  return label && !isCurrent ? `Nouveau cours – saison ${label}` : "Nouveau cours";
}
