import { DAY_NAMES } from "./days";
import type { Period } from "./lessons";

/**
 * What a closure covers (#200): the whole school (holidays, the default),
 * some sites (« Bons Amis fermé ») or some courses (« Jazz ado annulé pour
 * le gala »). A covered lesson is treated exactly like during the holidays.
 */
export type ClosureScope =
  | { kind: "school" }
  | { kind: "sites"; siteIds: readonly string[] }
  | { kind: "courses"; courseIds: readonly string[] };

/**
 * A closure with its scope. Its dates sit under `period` on purpose: a scoped
 * closure is not a `Period`, so it cannot be handed to a function that would
 * apply it to every course.
 */
export type ScopedClosure = { period: Period; scope: ClosureScope };

/** The course a closure is checked against: its id (none while it is created) and its room's site. */
export type ClosedCourse = { id?: string | null; siteId?: string | null };

/** Whether a closure of this scope covers the course. */
export function covers(scope: ClosureScope, c: ClosedCourse): boolean {
  switch (scope.kind) {
    case "school":
      return true;
    case "sites":
      return !!c.siteId && scope.siteIds.includes(c.siteId);
    case "courses":
      return !!c.id && scope.courseIds.includes(c.id);
  }
}

/**
 * A course as a closure names it, for the director to tell it apart from the
 * others of the season: « Jazz débutant – mardi 18:00 – Salle 1 ».
 */
export function closedCourseLabel(c: {
  discipline: string;
  level: string | null;
  weekday: number | null;
  /** `HH:MM` */
  startTime: string;
  room: string;
}): string {
  const name = c.level ? `${c.discipline} ${c.level}` : c.discipline;
  const day = c.weekday ? DAY_NAMES[c.weekday] : "dates précises";
  return `${name} – ${day} ${c.startTime} – ${c.room}`;
}

/**
 * Periods of the closures that cover the course, split as `courseDates()`
 * applies them: school-wide ones, and the ones aimed at its site or at itself.
 */
export function closuresOf(closures: ScopedClosure[], c: ClosedCourse): { school: Period[]; scoped: Period[] } {
  const covering = closures.filter((f) => covers(f.scope, c));
  return {
    school: covering.filter((f) => f.scope.kind === "school").map((f) => f.period),
    scoped: covering.filter((f) => f.scope.kind !== "school").map((f) => f.period),
  };
}
