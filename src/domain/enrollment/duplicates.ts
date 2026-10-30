import { STATUS_PRIORITY, type EnrollmentStatus } from "./statuses";

/**
 * A student enrolled twice in the same course (#333). Pure functions, no database.
 *
 * Open question (#333, « Open questions »): whether management wants such an enrollment
 * refused or only warned about. Until the school answers, it is a warning: the form marks the
 * course « déjà inscrit » and saving asks for a confirmation (`DUPLICATE_POLICY`).
 */

/** Statuses for which a student already takes a course: a dropped or ended enrollment does not (#284). */
export const TAKEN_STATUSES = ["active", "trial", "waitlist"] as const satisfies readonly EnrollmentStatus[];

/** What enrolling a student again in a course they take does (#333): warn and ask, or refuse. Default: warn. */
export const DUPLICATE_POLICY: "warn" | "refuse" = "warn";

/** A course a student takes in the season, through one of their enrollments. */
export type TakenCourse = { studentId: string; courseId: string; status: EnrollmentStatus };

const taking = (status: EnrollmentStatus) => (TAKEN_STATUSES as readonly EnrollmentStatus[]).includes(status);

/**
 * The chosen courses each chosen student already takes in the season, once per student and
 * course, with the status that matters most (`STATUS_PRIORITY`), in the order of `taken`.
 */
export function alreadyTaken(
  studentIds: readonly string[],
  courseIds: readonly string[],
  taken: readonly TakenCourse[],
): TakenCourse[] {
  const best = new Map<string, TakenCourse>();
  for (const t of taken) {
    if (!taking(t.status) || !studentIds.includes(t.studentId) || !courseIds.includes(t.courseId)) continue;
    const key = `${t.studentId}|${t.courseId}`;
    const kept = best.get(key);
    if (!kept || STATUS_PRIORITY.indexOf(t.status) < STATUS_PRIORITY.indexOf(kept.status)) best.set(key, t);
  }
  return [...best.values()];
}

/**
 * Why saving is held back when `duplicates` chosen courses are already taken, in French;
 * null when it goes through. A warning (`DUPLICATE_POLICY`) lets a confirmed entry through.
 */
export function duplicateRefusal(duplicates: number, confirmed: boolean): string | null {
  if (duplicates === 0) return null;
  if (DUPLICATE_POLICY === "refuse")
    return "Ce danseur suit déjà un des cours choisis cette saison : retirez-le de la sélection.";
  if (confirmed) return null;
  return "Ce danseur suit déjà un des cours choisis cette saison : confirmez pour l’y inscrire une deuxième fois.";
}

/** A student's courses once per course and status (a duplicate enrolled by mistake shows once), in the order given. */
export function oneRowPerCourseAndStatus<T extends { id: string; status: EnrollmentStatus }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.id}|${r.status}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
