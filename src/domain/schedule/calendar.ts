/**
 * Layout of the schedule in calendar view: shared time axis, courses placed
 * at their time, simultaneous courses side by side. Pure functions, in
 * minutes since midnight (Paris time of the courses).
 */

export type CalendarCourse = { id: string; weekday: number | null; startTime: string; durationMinutes: number };

export const toMinutes = (heure: string) => Number(heure.slice(0, 2)) * 60 + Number(heure.slice(3, 5));
export const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Rounds to the nearest step (quarter of an hour by default). */
export const snap = (minutes: number, pas = 15) => Math.round(minutes / pas) * pas;

/** Displayed time range: from the full hour before the first course to the one after the last; 9:00–21:00 without courses. */
export function dayBounds(courses: CalendarCourse[]): { start: number; end: number } {
  const weekly = courses.filter((c) => c.weekday !== null);
  if (weekly.length === 0) return { start: 9 * 60, end: 21 * 60 };
  const start = Math.min(9 * 60, ...weekly.map((c) => toMinutes(c.startTime)));
  const end = Math.max(21 * 60, ...weekly.map((c) => toMinutes(c.startTime) + c.durationMinutes));
  return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
}

/**
 * Column of each course within its day: overlapping courses form a group
 * split into as many columns as needed; a course takes the first column
 * free at its time.
 */
export function arrange(courses: CalendarCourse[]): Map<string, { column: number; columns: number }> {
  const result = new Map<string, { column: number; columns: number }>();
  const byDay = new Map<number, CalendarCourse[]>();
  for (const c of courses) if (c.weekday !== null) byDay.set(c.weekday, [...(byDay.get(c.weekday) ?? []), c]);

  for (const ofDay of byDay.values()) {
    const sorted = [...ofDay].sort(
      (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime) || b.durationMinutes - a.durationMinutes,
    );
    let group: { id: string; column: number }[] = [];
    let columnEnds: number[] = [];
    let groupEnd = -1;
    const close = () => {
      for (const g of group) result.set(g.id, { column: g.column, columns: columnEnds.length });
      group = [];
      columnEnds = [];
    };
    for (const c of sorted) {
      const start = toMinutes(c.startTime);
      const end = start + c.durationMinutes;
      if (start >= groupEnd) close();
      let column = columnEnds.findIndex((f) => f <= start);
      if (column === -1) column = columnEnds.push(end) - 1;
      else columnEnds[column] = end;
      group.push({ id: c.id, column });
      groupEnd = Math.max(groupEnd, end);
    }
    close();
  }
  return result;
}
