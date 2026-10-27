/**
 * Planning link that keeps the chosen season (`?saison=`, #189). `season` is
 * undefined for the current season, which keeps the usual addresses.
 */
export function withSeason(href: string, season: string | undefined): string {
  if (!season) return href;
  return `${href}${href.includes("?") ? "&" : "?"}saison=${season}`;
}
