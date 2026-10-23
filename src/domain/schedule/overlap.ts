/** Recouvrement de créneaux hebdomadaires (cours réguliers ; un stage n'a pas de jour). */

export type Slot = {
  /** 1 = lundi … 7 = dimanche ; null pour un stage. */
  weekday: number | null;
  /** `HH:MM` */
  startTime: string;
  durationMinutes: number;
};

const minutes = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

export function overlaps(a: Slot, b: Slot): boolean {
  if (a.weekday === null || a.weekday !== b.weekday) return false;
  const [da, db] = [minutes(a.startTime), minutes(b.startTime)];
  return da < db + b.durationMinutes && db < da + a.durationMinutes;
}

type PlacedCourse = Slot & { id: string | null; roomId: string; instructorId: string };

/** Cours qui occupent déjà la même salle ou le même intervenant sur le créneau de `cible`. */
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
