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

type SeasonForCopy = { id: string; label: string; startDate: string };

/**
 * « Copier » button of the planning (#190), so that the direction is never in
 * doubt: a season with courses followed by an empty one offers to copy into
 * that next empty season (« Copier vers 2027-2028 »); otherwise the season
 * shown is the one to fill, from a season chosen on the copy page.
 */
export function copyLink(
  shown: SeasonForCopy,
  seasons: SeasonForCopy[],
  courses: ReadonlyMap<string, number>,
  currentId: string | undefined,
): { href: string; label: string } {
  const emptyLater = seasons
    .filter((s) => s.startDate > shown.startDate && !courses.get(s.id))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (courses.get(shown.id) && emptyLater)
    return {
      href: withSeason(
        `/planning/copier?depuis=${encodeURIComponent(shown.id)}`,
        seasonParam(emptyLater.id, currentId),
      ),
      label: `Copier vers ${emptyLater.label}`,
    };
  return { href: withSeason("/planning/copier", seasonParam(shown.id, currentId)), label: "Copier un planning" };
}

/** `?copie=` of the planning after a copy: a count up to the season's courses, otherwise nothing to confirm. */
export function copiedCount(param: unknown, seasonCourses: number): number {
  const n = typeof param === "string" && /^\d{1,4}$/.test(param) ? Number(param) : 0;
  return n >= 1 && n <= seasonCourses ? n : 0;
}
