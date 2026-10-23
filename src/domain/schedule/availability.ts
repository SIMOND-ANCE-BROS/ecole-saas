/**
 * Instructor availability: conflicts between lessons and unavailabilities,
 * free substitutes. Pure functions; course times are Paris times,
 * unavailabilities are instants.
 */

const MINUTE = 60_000;

/** Paris offset from UTC (in minutes) at a given instant. */
function parisShift(instant: number): number {
  const parties = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parties.year, +parties.month - 1, +parties.day, +parties.hour, +parties.minute);
  return Math.round((asUtc - instant) / MINUTE);
}

/** Instant (milliseconds) of a Paris time `HH:MM` on a day `YYYY-MM-DD`. */
export function instantParis(date: string, heure: string): number {
  const [a, m, j] = date.split("-").map(Number);
  const naive = Date.UTC(a, m - 1, j, Number(heure.slice(0, 2)), Number(heure.slice(3, 5)));
  // Two passes: the offset may change between the naive time and the real time.
  const first = naive - parisShift(naive) * MINUTE;
  return naive - parisShift(first) * MINUTE;
}

export type DatedLesson = {
  id: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  instructorId: string;
};
export type Unavailability = { instructorId: string; start: Date; end: Date };

export function lessonInterval(s: Pick<DatedLesson, "date" | "startTime" | "durationMinutes">): [number, number] {
  const start = instantParis(s.date, s.startTime);
  return [start, start + s.durationMinutes * MINUTE];
}

const overlaps = ([a1, a2]: [number, number], [b1, b2]: [number, number]) => a1 < b2 && b1 < a2;

/** Lessons whose instructor is unavailable during all or part of the slot. */
export function conflicts(
  lessons: DatedLesson[],
  unavailabilities: Unavailability[],
): { lessonId: string; unavailability: Unavailability }[] {
  return lessons.flatMap((s) => {
    const slot = lessonInterval(s);
    const i = unavailabilities.find(
      (x) => x.instructorId === s.instructorId && overlaps(slot, [x.start.getTime(), x.end.getTime()]),
    );
    return i ? [{ lessonId: s.id, unavailability: i }] : [];
  });
}

/**
 * Possible substitutes for a lesson, except its instructor: free ones first
 * (neither unavailable nor busy with another lesson at the same time), then
 * those who already teach the discipline, then the given order.
 */
export function freeSubstitutes(
  target: DatedLesson & { discipline: string },
  instructors: { id: string; disciplines: string[] }[],
  otherLessons: DatedLesson[],
  unavailabilities: Unavailability[],
): { id: string; free: boolean; pattern: "indisponible" | "autre séance" | null; taught: boolean }[] {
  const slot = lessonInterval(target);
  return instructors
    .filter((i) => i.id !== target.instructorId)
    .map((i, rank) => {
      const unavailable = unavailabilities.some(
        (x) => x.instructorId === i.id && overlaps(slot, [x.start.getTime(), x.end.getTime()]),
      );
      const busy = otherLessons.some(
        (s) => s.id !== target.id && s.instructorId === i.id && overlaps(slot, lessonInterval(s)),
      );
      const pattern = unavailable ? ("indisponible" as const) : busy ? ("autre séance" as const) : null;
      return {
        id: i.id,
        free: pattern === null,
        pattern: pattern,
        taught: i.disciplines.includes(target.discipline),
        rank: rank,
      };
    })
    .sort((a, b) => Number(b.free) - Number(a.free) || Number(b.taught) - Number(a.taught) || a.rank - b.rank)
    .map((r) => ({ id: r.id, free: r.free, pattern: r.pattern, taught: r.taught }));
}
