import type { ScheduleCourse } from "@/db/planning";

export type ScheduleFilters = { discipline: string; site: string; roomId: string; instructorId: string };
export const EMPTY_FILTERS: ScheduleFilters = { discipline: "", site: "", roomId: "", instructorId: "" };

/** Les identifiants distinguent les salles homonymes de deux sites. */
export function filterSchedule<T extends Pick<ScheduleCourse, "discipline" | "site" | "roomId" | "instructorId">>(
  courses: T[],
  filters: ScheduleFilters,
): T[] {
  return courses.filter(
    (c) =>
      (!filters.discipline || c.discipline === filters.discipline) &&
      (!filters.site || c.site === filters.site) &&
      (!filters.roomId || c.roomId === filters.roomId) &&
      (!filters.instructorId || c.instructorId === filters.instructorId),
  );
}
