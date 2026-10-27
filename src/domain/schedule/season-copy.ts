/**
 * Copying the planning of one season into another (#190). Decided with the
 * owner: everything is copied except dates. A regular course keeps its day,
 * time, length, room, instructor, discipline, type, level, ages and places,
 * but not its period (`start_date`/`end_date`, dates of the old season); a
 * course held on specific dates is not copied at all. Management then edits
 * what changes.
 */

/** Course columns copied as they are; the season and the period are not. */
export const COPIED_COLUMNS = [
  "disciplineId",
  "roomId",
  "instructorId",
  "type",
  "level",
  "ageMin",
  "ageMax",
  "recurrence",
  "weekday",
  "startTime",
  "durationMinutes",
  "maxCapacity",
] as const;

/** What the plan needs to know about a course. */
export type CopiedCourse = {
  recurrence: "weekly" | "biweekly" | "dates";
  disciplineId: string;
  roomId: string;
  weekday: number | null;
  /** `HH:MM` or `HH:MM:SS` */
  startTime: string;
  instructorActive: boolean;
};

type Slot = Pick<CopiedCourse, "disciplineId" | "roomId" | "weekday" | "startTime">;

export type SeasonCopyPlan<C> = {
  /** Courses to create in the target season. */
  copied: C[];
  /** Held on specific dates: not copied. */
  oneOff: C[];
  /** Same discipline, day, time and room already in the target season: not copied again. */
  alreadyThere: C[];
  /** Among `copied`: the instructor is no longer active, to be replaced. */
  inactiveInstructor: C[];
};

const key = (c: Slot) => `${c.disciplineId} ${c.weekday} ${c.startTime.slice(0, 5)} ${c.roomId}`;

/**
 * Splits the source season's courses: copied, skipped because held on
 * specific dates, skipped because the target already has the same course (a
 * second copy adds nothing). A course whose instructor is inactive is copied
 * and flagged.
 */
export function planSeasonCopy<C extends CopiedCourse>(source: C[], target: Slot[]): SeasonCopyPlan<C> {
  const present = new Set(target.map(key));
  const oneOff = source.filter((c) => c.recurrence === "dates");
  const regular = source.filter((c) => c.recurrence !== "dates");
  const alreadyThere = regular.filter((c) => present.has(key(c)));
  const copied = regular.filter((c) => !present.has(key(c)));
  return { copied, oneOff, alreadyThere, inactiveInstructor: copied.filter((c) => !c.instructorActive) };
}
