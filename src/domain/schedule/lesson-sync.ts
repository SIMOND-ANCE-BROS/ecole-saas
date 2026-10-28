/**
 * Decisions of the lesson sync (#206), without database: which lessons to
 * create, which to remove, what a lesson removed by a closure keeps aside,
 * and what is given back when the closure no longer covers it.
 *
 * A lesson is identified by its course and its reference date: the
 * original date of a moved lesson, otherwise its date. Dates are
 * `YYYY-MM-DD`, times `HH:MM:SS`.
 */

import { closuresOf, type ScopedClosure } from "./closure-scope";
import { courseDates, type Period, type Recurrence } from "./lessons";

/** A lesson the season should have from `start` on, closures applied. */
export type ExpectedLesson = {
  courseId: string;
  date: string;
  /** the course's main instructor */ instructorId: string;
};

export type ExistingLesson = {
  id: string;
  courseId: string;
  reference: string;
  date: string;
  plannedDate: string | null;
  startTime: string | null;
  durationMinutes: number | null;
  instructorId: string;
  /** The course's main instructor today. */
  courseInstructorId: string;
  status: "planned" | "done" | "cancelled";
  attendanceSheet: boolean;
};

/** What a lesson removed by a closure had of its own. `instructorId`: a real substitute, or null. */
export type SuspendedLesson = {
  courseId: string;
  referenceDate: string;
  date: string;
  plannedDate: string | null;
  startTime: string | null;
  durationMinutes: number | null;
  instructorId: string | null;
};

export type NewLesson = {
  courseId: string;
  date: string;
  plannedDate: string | null;
  startTime: string | null;
  durationMinutes: number | null;
  instructorId: string;
};

export type SyncPlan = {
  insert: NewLesson[];
  /** Ids of the lessons to delete. */
  remove: string[];
  /** Kept rows no longer needed (given back, stale), deleted before `setAside` is written. */
  forget: { courseId: string; referenceDate: string }[];
  setAside: SuspendedLesson[];
};

const keyOf = (courseId: string, date: string) => `${courseId} ${date}`;

/** A course as the sync sees it: its recurrence, main instructor and room's site. */
export type SyncedCourse = { id: string; instructorId: string; siteId: string; recurrence: Recurrence | null };

/**
 * The lessons the season should have from `start` on, each course losing
 * the dates of the closures covering it (#200), and every day each course
 * meets on without closures (over the whole season: the « une semaine sur
 * deux » alternation is aligned on the first date). `closed`: whether a
 * closure takes a given day away from a course, as `courseDates` decides
 * (a one-off course ignores school-wide closures).
 */
export function seasonLessons(
  courses: SyncedCourse[],
  season: Period,
  closures: ScopedClosure[],
  start: string,
): { expected: ExpectedLesson[]; meets: Set<string>; closed: (courseId: string, date: string) => boolean } {
  const expected: ExpectedLesson[] = [];
  const meets = new Set<string>();
  const closedPeriods = new Map<string, Period[]>();
  for (const c of courses) {
    if (!c.recurrence) continue;
    const covering = closuresOf(closures, c);
    closedPeriods.set(c.id, c.recurrence.type === "dates" ? covering.scoped : [...covering.school, ...covering.scoped]);
    for (const date of courseDates(c.recurrence, season, covering))
      if (date >= start) expected.push({ courseId: c.id, date, instructorId: c.instructorId });
    for (const date of courseDates(c.recurrence, season, [])) meets.add(keyOf(c.id, date));
  }
  const closed = (courseId: string, date: string) =>
    (closedPeriods.get(courseId) ?? []).some((p) => p.start <= date && date <= p.end);
  return { expected, meets, closed };
}

export function planLessonSync(input: {
  /** First date the sync may change (season start, today, `since`). */
  start: string;
  today: string;
  expected: ExpectedLesson[];
  /** Keys `courseId date` of every day each course meets on, closures ignored, over the whole season. */
  meets: ReadonlySet<string>;
  existing: ExistingLesson[];
  suspended: SuspendedLesson[];
  /** Instructors who can still teach: a kept substitute who left is not given back. */
  activeInstructors: ReadonlySet<string>;
  /** Whether a closure takes this day away from the course (`seasonLessons`). */
  closed: (courseId: string, date: string) => boolean;
}): SyncPlan {
  const { start, today, expected, meets, existing, suspended, activeInstructors, closed } = input;
  const present = new Set(existing.map((e) => keyOf(e.courseId, e.reference)));
  const wanted = new Set(expected.map((a) => keyOf(a.courseId, a.date)));

  const removed = existing.filter(
    (e) =>
      e.reference >= start &&
      e.status === "planned" &&
      !e.attendanceSheet &&
      !wanted.has(keyOf(e.courseId, e.reference)),
  );
  const removedIds = new Set(removed.map((e) => e.id));

  // Removed by a closure (the course still meets that day) with something of its own: kept aside.
  const setAside = removed
    .filter((e) => meets.has(keyOf(e.courseId, e.reference)))
    .map((e) => ({
      courseId: e.courseId,
      referenceDate: e.reference,
      date: e.date,
      plannedDate: e.plannedDate,
      startTime: e.startTime,
      durationMinutes: e.durationMinutes,
      instructorId: e.instructorId !== e.courseInstructorId ? e.instructorId : null,
    }))
    .filter(
      (k) => k.plannedDate !== null || k.startTime !== null || k.durationMinutes !== null || k.instructorId !== null,
    )
    // A moved lesson and the lesson now on its original date share a key: one row per key in the upsert.
    .filter(
      (k, i, all) => all.findIndex((o) => o.courseId === k.courseId && o.referenceDate === k.referenceDate) === i,
    );

  // Past, or the course no longer meets that day, or its lesson is there: nothing left to give back.
  const kept = new Map(suspended.map((k) => [keyOf(k.courseId, k.referenceDate), k]));
  const forget = suspended
    .filter((k) => {
      const key = keyOf(k.courseId, k.referenceDate);
      return k.referenceDate < today || (k.referenceDate >= start && (!meets.has(key) || present.has(key)));
    })
    .map((k) => ({ courseId: k.courseId, referenceDate: k.referenceDate }));

  // Dates each course already has a lesson on, once the removals are done.
  const taken = new Set(existing.filter((e) => !removedIds.has(e.id)).map((e) => keyOf(e.courseId, e.date)));
  const insert: NewLesson[] = [];
  for (const a of expected) {
    const key = keyOf(a.courseId, a.date);
    if (present.has(key)) continue;
    const k = kept.get(key);
    const substitute = k?.instructorId && activeInstructors.has(k.instructorId) ? k.instructorId : null;
    const instructorId = substitute ?? a.instructorId;
    if (k) forget.push({ courseId: k.courseId, referenceDate: k.referenceDate });
    // Its new date taken meanwhile by another lesson of the course, or closed: the plain lesson, with its
    // substitute only, so that no lesson is planned on a closed day.
    const lesson =
      k && !taken.has(keyOf(a.courseId, k.date)) && !closed(a.courseId, k.date)
        ? {
            ...a,
            date: k.date,
            plannedDate: k.plannedDate,
            startTime: k.startTime,
            durationMinutes: k.durationMinutes,
            instructorId,
          }
        : { ...a, plannedDate: null, startTime: null, durationMinutes: null, instructorId };
    taken.add(keyOf(lesson.courseId, lesson.date));
    insert.push(lesson);
  }

  return { insert, remove: removed.map((e) => e.id), forget, setAside };
}
