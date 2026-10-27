import { addDays } from "./week";

type SeasonDates = { id: string; startDate: string; endDate: string };

/**
 * Season the planning shows (#189). `week` is the Monday of the week asked
 * for (`?semaine=`), null when none or an invalid one was given; `overlapping`
 * is the first season sharing a day with that week.
 *
 * - no week, or a week sharing a day with the chosen season: that season;
 * - a week in another season: that one, and the address must follow (`moved`);
 * - a week in no season (summer gap): the chosen one, with a notice (`outside`).
 */
export function shownSeason<S extends SeasonDates>(
  asked: S | null,
  week: string | null,
  overlapping: S | null,
): { season: S | null; moved: boolean; outside: boolean } {
  if (!asked || !week || (asked.startDate <= addDays(week, 6) && asked.endDate >= week))
    return { season: asked, moved: false, outside: false };
  if (overlapping && overlapping.id !== asked.id) return { season: overlapping, moved: true, outside: false };
  return { season: asked, moved: false, outside: true };
}
