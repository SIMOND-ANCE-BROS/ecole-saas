/**
 * Copying the planning of one season into another (#190). Decided with the
 * owner: everything is copied except dates. A regular course keeps its day,
 * time, length, room, instructor, discipline, type, level, ages and places,
 * but not its period (`start_date`/`end_date`, dates of the old season); a
 * course held on specific dates is not copied at all. Management then edits
 * what changes. The columns copied are listed in `src/db/season-copy.ts`.
 */

/** What the plan needs to know about a course. */
export type CopiedCourse = {
  recurrence: "weekly" | "biweekly" | "dates";
  disciplineId: string;
  roomId: string;
  weekday: number | null;
  /** `HH:MM` or `HH:MM:SS` */
  startTime: string;
  startDate: string | null;
  endDate: string | null;
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
  /** Among `copied`, to check after the copy: */
  check: {
    /** the instructor is no longer active; */
    inactiveInstructor: C[];
    /** a limited period in the old season, not carried over: the course runs the whole new season; */
    periodDropped: C[];
    /** every other week: the alternation restarts from the new season's first week; */
    biweekly: C[];
    /** the target season has another course in that room, on that day and at that time. */
    roomTaken: C[];
  };
};

const time = (t: string) => t.slice(0, 5);
const room = (c: Slot) => `${c.roomId} ${c.weekday} ${time(c.startTime)}`;
const key = (c: Slot) => `${c.disciplineId} ${room(c)}`;

/**
 * Splits the source season's courses: copied, skipped because held on
 * specific dates, skipped because the target already has the same course (a
 * second copy adds nothing). Copied courses that management must check are
 * flagged, never left out.
 */
export function planSeasonCopy<C extends CopiedCourse>(source: C[], target: Slot[]): SeasonCopyPlan<C> {
  const present = new Set(target.map(key));
  const rooms = new Set(target.map(room));
  const oneOff = source.filter((c) => c.recurrence === "dates");
  const regular = source.filter((c) => c.recurrence !== "dates");
  const alreadyThere = regular.filter((c) => present.has(key(c)));
  const copied = regular.filter((c) => !present.has(key(c)));
  return {
    copied,
    oneOff,
    alreadyThere,
    check: {
      inactiveInstructor: copied.filter((c) => !c.instructorActive),
      periodDropped: copied.filter((c) => c.startDate !== null || c.endDate !== null),
      biweekly: copied.filter((c) => c.recurrence === "biweekly"),
      roomTaken: copied.filter((c) => rooms.has(room(c))),
    },
  };
}
