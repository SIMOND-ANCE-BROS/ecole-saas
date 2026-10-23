import { dayBounds, type CalendarCourse, toMinutes } from "./calendar";
import { DAY_NAMES } from "./days";

/**
 * Opening days and hours of the sites (#90). A site without entered hours
 * imposes nothing: the calendar then keeps its Monday-to-Saturday week and
 * its range computed from the courses.
 */

/** Opening of a day: `HH:MM` times, day 1 = Monday … 7 = Sunday. */
export type Hours = { weekday: number; opening: string; closure: string };

/** Open ranges of a day (in minutes), merged when several sites overlap. */
export function openRanges(hours: Hours[], day: number): { start: number; end: number }[] {
  const ranges = hours
    .filter((h) => h.weekday === day)
    .map((h) => ({ start: toMinutes(h.opening), end: toMinutes(h.closure) }))
    .sort((a, b) => a.start - b.start);
  const r: { start: number; end: number }[] = [];
  for (const p of ranges) {
    const last = r.at(-1);
    if (last && p.start <= last.end) last.end = Math.max(last.end, p.end);
    else r.push({ ...p });
  }
  return r;
}

/**
 * Calendar frame for the hours of the displayed sites: open days (plus those
 * where a course already exists), range from the earliest opening to the
 * latest closing, widened to courses that fall outside it, in full hours.
 */
export function calendarFrame(
  hours: Hours[],
  courses: CalendarCourse[],
): { days: number[]; start: number; end: number } {
  const weekly = courses.filter((c) => c.weekday !== null);
  if (hours.length === 0) {
    const { start: start, end: end } = dayBounds(courses);
    return { days: [1, 2, 3, 4, 5, 6, ...(weekly.some((c) => c.weekday === 7) ? [7] : [])], start: start, end: end };
  }
  const days = [...new Set([...hours.map((h) => h.weekday), ...weekly.map((c) => c.weekday as number)])].sort(
    (a, b) => a - b,
  );
  const start = Math.min(...hours.map((h) => toMinutes(h.opening)), ...weekly.map((c) => toMinutes(c.startTime)));
  const end = Math.max(
    ...hours.map((h) => toMinutes(h.closure)),
    ...weekly.map((c) => toMinutes(c.startTime) + c.durationMinutes),
  );
  return { days, start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
}

/**
 * Message if a weekly slot falls outside its site's hours; null if it fits,
 * or if the site has no hours (nothing to check).
 */
export function outsideHours(
  slot: { weekday: number; startTime: string; durationMinutes: number },
  hours: Hours[],
): string | null {
  if (hours.length === 0) return null;
  const ranges = openRanges(hours, slot.weekday);
  if (ranges.length === 0) return `Le site est fermé le ${DAY_NAMES[slot.weekday]}.`;
  const start = toMinutes(slot.startTime);
  const end = start + slot.durationMinutes;
  if (ranges.some((p) => p.start <= start && end <= p.end)) return null;
  const h = hours.find((x) => x.weekday === slot.weekday)!;
  return `En dehors des horaires du site le ${DAY_NAMES[slot.weekday]} (${h.opening}–${h.closure}).`;
}
