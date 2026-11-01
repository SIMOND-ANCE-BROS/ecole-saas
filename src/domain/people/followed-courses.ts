/**
 * A student's courses on their record (#362): those of the season the record shows on top, the
 * others below (older, or later: a re-enrollment for the next season, in June). Without a season
 * shown (a school without seasons), the most recent season's courses, listed first, are on top.
 */
export function coursesBySeason<C extends { seasonId: string; season: string }>(
  courses: readonly C[],
  shown: { id: string; label: string } | null,
): { label: string | undefined; shown: C[]; others: C[] } {
  const seasonId = shown?.id ?? courses[0]?.seasonId;
  return {
    label: shown?.label ?? courses[0]?.season,
    shown: courses.filter((c) => c.seasonId === seasonId),
    others: courses.filter((c) => c.seasonId !== seasonId),
  };
}
