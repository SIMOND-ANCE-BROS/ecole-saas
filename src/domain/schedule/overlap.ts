/** Overlap of weekly slots (regular courses; a workshop has no weekday). */

export type Slot = {
  /** 1 = Monday … 7 = Sunday; null for a workshop. */
  weekday: number | null;
  /** `HH:MM` */
  startTime: string;
  durationMinutes: number;
  /**
   * Lesson dates of the course when known (#96): two courses then only overlap
   * on a shared date, so alternate weeks or disjoint periods do not clash.
   */
  lessonDates?: readonly string[];
};

const minutes = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

export function overlaps(a: Slot, b: Slot): boolean {
  if (!sameDay(a, b)) return false;
  const [da, db] = [minutes(a.startTime), minutes(b.startTime)];
  return da < db + b.durationMinutes && db < da + a.durationMinutes;
}

function sameDay(a: Slot, b: Slot): boolean {
  if (a.lessonDates && b.lessonDates) {
    const dates = new Set(a.lessonDates);
    return b.lessonDates.some((d) => dates.has(d));
  }
  return a.weekday !== null && a.weekday === b.weekday;
}

type PlacedCourse = Slot & { id: string | null; roomId: string; instructorId: string };

/** Courses already using the same room or the same instructor in the slot of `target`. */
export function conflicts(target: PlacedCourse, existing: PlacedCourse[]) {
  return existing
    .filter((c) => c.id !== target.id && overlaps(target, c))
    .map((c) => ({
      id: c.id as string,
      room: c.roomId === target.roomId,
      instructor: c.instructorId === target.instructorId,
    }))
    .filter((c) => c.room || c.instructor);
}
