/**
 * Closing only the children's or only the adults' courses for a holiday
 * (#295): the founding school closes children's and teens' courses for the
 * whole school holidays but adults' ones for part of them only. Which week is
 * management's choice for each holiday (data, no rule here).
 *
 * The audience is a shortcut to tick courses: the closure keeps the scope
 * « courses » (#200) with the ticked list, resolved when it is saved and still
 * editable course by course.
 */

import { courseDates, recurrenceOf, type Period } from "./lessons";

/** The course facts an audience is read from: its type and age range. */
export type AudienceCourse = {
  id: string;
  type: "group" | "private" | "competition" | "workshop";
  ageMin: number | null;
  ageMax: number | null;
};

/** `undecided`: no age range, or one with both minors and adults: management ticks it or not. */
export type CourseAudience = "children" | "adults" | "undecided";

/** Who a closure is meant for, as management picks it: « enfants et ados », « adultes », « tous ». */
export type AudiencePick = "children" | "adults" | "all";

/** Legal majority (as `isMinor`): a course whose ages all sit below it is a children's or teens' course. */
const ADULT_AGE = 18;

/**
 * The audience of a course from its age range, or null for a course an
 * audience never ticks. Default until the school answers (#295 Q2): only group
 * courses follow the holidays by audience; private lessons, competition
 * training and workshops are closed course by course if need be.
 */
export function audienceOf(c: AudienceCourse): CourseAudience | null {
  if (c.type !== "group") return null;
  if (c.ageMax !== null && c.ageMax < ADULT_AGE) return "children";
  if (c.ageMin !== null && c.ageMin >= ADULT_AGE) return "adults";
  // Default (#295 Q3): a course mixing teens and adults is not given a side, management decides.
  return "undecided";
}

/**
 * The courses an audience ticks, in the given order, and the group courses
 * left to decide: listed apart, never ticked by « enfants et ados » nor
 * « adultes ». « Tous » ticks every group course.
 */
export function pickByAudience(
  courses: readonly AudienceCourse[],
  pick: AudiencePick,
): { courseIds: string[]; undecidedIds: string[] } {
  const courseIds: string[] = [];
  const undecidedIds: string[] = [];
  for (const c of courses) {
    const audience = audienceOf(c);
    if (audience === null) continue;
    if (pick === "all" || audience === pick) courseIds.push(c.id);
    else if (audience === "undecided") undecidedIds.push(c.id);
  }
  return { courseIds, undecidedIds };
}

/**
 * Whether the course has a lesson within `period` (closures aside): an
 * audience only ticks the courses a closure of those dates takes a lesson
 * from, so the closure does not name courses it leaves untouched.
 */
export function meetsDuring(c: Parameters<typeof recurrenceOf>[0], season: Period, period: Period): boolean {
  const r = recurrenceOf(c);
  // The whole season: the « une semaine sur deux » alternation is anchored on its first date.
  return !!r && courseDates(r, season, []).some((d) => period.start <= d && d <= period.end);
}
