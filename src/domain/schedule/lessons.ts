/**
 * Lesson dates of a weekly course. Public holidays are not deducted
 * automatically: the school enters them as closures, just like holidays,
 * because each school decides whether to open or not.
 */

export type Period = { start: string; end: string };

const ONE_DAY = 86_400_000;
const toDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** `YYYY-MM-DD` dates of `weekday` (1 = Monday … 7 = Sunday) between `start` and `end` inclusive, closures excluded. */
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
 * Recurrence of a course (#90): every week or every other week, over the
 * whole season or a period (`startDate`, `endDate`), or on specific dates
 * (workshop, one-off course).
 */
export type Recurrence =
  | { type: "weekly" | "biweekly"; weekday: number; startDate: string | null; endDate: string | null }
  | { type: "dates"; dates: string[] };

/** Recurrence of a stored course (`dates`: its one-off dates). */
export function recurrenceOf(c: {
  recurrence: "weekly" | "biweekly" | "dates";
  weekday: number | null;
  startDate: string | null;
  endDate: string | null;
  dates: string[];
}): Recurrence | null {
  if (c.recurrence === "dates") return { type: "dates", dates: c.dates };
  return c.weekday === null
    ? null
    : { type: c.recurrence, weekday: c.weekday, startDate: c.startDate, endDate: c.endDate };
}

/**
 * What lesson dates are computed from: the season and its closures. Dates before
 * `from` (today) are left out: a lesson already given can no longer clash.
 */
export type SeasonCalendar = { period: Period; closures: Period[]; from: string };

/** Lesson dates of a stored course; undefined without a recurrence (regular course without a day). */
export function lessonDatesOf(c: Parameters<typeof recurrenceOf>[0], calendar: SeasonCalendar): string[] | undefined {
  const r = recurrenceOf(c);
  // The whole season first: the « une semaine sur deux » alternation is anchored on its first date.
  return r ? courseDates(r, calendar.period, calendar.closures).filter((d) => d >= calendar.from) : undefined;
}

/**
 * Lesson dates of a course in the season. A closure removes the lesson of a
 * regular course without shifting the alternation of an "every other week"
 * course (anchored on its first date). Specific dates ignore closures: a
 * workshop often takes place during the holidays.
 */
export function courseDates(r: Recurrence, season: Period, closures: Period[]): string[] {
  if (r.type === "dates") return [...new Set(r.dates)].filter((d) => season.start <= d && d <= season.end).sort();
  const start = r.startDate && r.startDate > season.start ? r.startDate : season.start;
  const end = r.endDate && r.endDate < season.end ? r.endDate : season.end;
  if (start > end) return [];
  const toutes = lessonDates({ start, end, weekday: r.weekday, closures: [] });
  const retained = r.type === "biweekly" ? toutes.filter((_, i) => i % 2 === 0) : toutes;
  return retained.filter((date) => !closures.some((f) => f.start <= date && date <= f.end));
}
