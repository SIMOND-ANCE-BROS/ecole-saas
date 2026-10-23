import type { ScheduleCourse } from "@/db/schedule";

export type ScheduleFilters = { discipline: string; site: string; roomId: string; instructorId: string };
export const EMPTY_FILTERS: ScheduleFilters = { discipline: "", site: "", roomId: "", instructorId: "" };

/** The ids tell apart rooms with the same name on two sites. */
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
