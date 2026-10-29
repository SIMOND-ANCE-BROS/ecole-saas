import { closuresOf, type ClosedCourse, type ScopedClosure } from "./closure-scope";

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
  start,
  end,
  weekday,
  closures,
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
 * What lesson dates are computed from: the season and its closures, each with
 * its scope (#200). Dates before `from` (today) are left out: a lesson already
 * given can no longer clash.
 */
export type SeasonCalendar = { period: Period; closures: ScopedClosure[]; from: string };

/**
 * Lesson dates of a stored course; undefined without a recurrence (regular
 * course without a day). `id` and `siteId` say which site or course closures
 * apply to it; without them only the school-wide closures do.
 */
export function lessonDatesOf(
  c: Parameters<typeof recurrenceOf>[0] & ClosedCourse,
  calendar: SeasonCalendar,
): string[] | undefined {
  const r = recurrenceOf(c);
  // The whole season first: the « une semaine sur deux » alternation is anchored on its first date.
  return r
    ? courseDates(r, calendar.period, closuresOf(calendar.closures, c)).filter((d) => d >= calendar.from)
    : undefined;
}

/**
 * Whether the course meets on `date` when no closure applies: a partial
 * closure (#200) is only shown on the days it actually takes a lesson away.
 */
export function meetsOn(c: Parameters<typeof recurrenceOf>[0], season: Period, date: string): boolean {
  const r = recurrenceOf(c);
  return !!r && courseDates(r, season, []).includes(date);
}

/**
 * Lesson dates of a course in the season. A closure removes the lesson of a
 * regular course without shifting the alternation of an "every other week"
 * course (anchored on its first date). Specific dates ignore school-wide
 * closures, since a workshop often takes place during the holidays, but not
 * a closure of their site or one naming the course (#200).
 *
 * `closures`: school-wide closures, or the split given by `closuresOf()`.
 */
export function courseDates(
  r: Recurrence,
  season: Period,
  closures: Period[] | { school: Period[]; scoped: Period[] },
): string[] {
  const { school, scoped } = Array.isArray(closures) ? { school: closures, scoped: [] } : closures;
  const open = (date: string, periods: Period[]) => !periods.some((f) => f.start <= date && date <= f.end);
  if (r.type === "dates")
    return [...new Set(r.dates)].filter((d) => season.start <= d && d <= season.end && open(d, scoped)).sort();
  const start = r.startDate && r.startDate > season.start ? r.startDate : season.start;
  const end = r.endDate && r.endDate < season.end ? r.endDate : season.end;
  if (start > end) return [];
  const all = lessonDates({ start, end, weekday: r.weekday, closures: [] });
  const retained = r.type === "biweekly" ? all.filter((_, i) => i % 2 === 0) : all;
  return retained.filter((date) => open(date, school) && open(date, scoped));
}

/**
 * Whether new season dates swap the weeks of a « une semaine sur deux »
 * course (#270): its alternation is aligned on its first date, which the
 * season's start moves when the course has no start of its own after it.
 * Swapped weeks would replace every upcoming lesson of the course; a course
 * ended by then (before today or its new first date) has none left.
 */
export function biweeklySwapped(r: Recurrence | null, before: Period, after: Period, today: string): boolean {
  if (r?.type !== "biweekly") return false;
  const first = (season: Period) => {
    const start = r.startDate && r.startDate > season.start ? r.startDate : season.start;
    return lessonDates({ start, end: toIso(toDay(start) + 6 * ONE_DAY), weekday: r.weekday, closures: [] })[0];
  };
  const firstAfter = first(after);
  if (r.endDate && r.endDate < (firstAfter > today ? firstAfter : today)) return false;
  const weeks = Math.round((toDay(firstAfter) - toDay(first(before))) / (7 * ONE_DAY));
  return weeks % 2 !== 0;
}
