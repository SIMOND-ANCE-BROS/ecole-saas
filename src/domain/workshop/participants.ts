import type { EnrollmentStatus } from "../enrollment/statuses";

/**
 * A workshop's participants (#398): since #297 they are signed up (`workshop_signup_person`),
 * not enrolled. On the course's list and on its lessons' attendance sheets they stand next to
 * any enrolled student, and they count in its headcount, like an active enrollment: a sign-up
 * has no trial, waitlist or drop-out (a mistake is cancelled, removing it).
 */
export const SIGNUP_LIST_STATUS = "active" as const satisfies EnrollmentStatus;

type Named = { name: string; firstName: string | null };

// A missing first name last, as PostgreSQL sorts NULL in ascending order.
const byFirstName = (a: string | null, b: string | null) =>
  a === null || b === null ? (a === null ? 1 : 0) - (b === null ? 1 : 0) : a.localeCompare(b, "fr");

const byName = (a: Named, b: Named) => a.name.localeCompare(b.name, "fr") || byFirstName(a.firstName, b.firstName);

/**
 * Enrolled students and signed-up ones in one list, by last then first name, then by student id
 * so equal names keep a stable order. Without sign-ups the enrolled list is kept as given
 * (already sorted by the database). A student both enrolled and signed up is listed twice
 * here: `oneRowPerStudent` keeps one row afterwards.
 */
export function withSignups<T extends Named>(
  enrolled: readonly T[],
  signedUp: readonly T[],
  studentOf: (row: T) => string,
): T[] {
  if (signedUp.length === 0) return [...enrolled];
  return [...enrolled, ...signedUp].sort((a, b) => byName(a, b) || studentOf(a).localeCompare(studentOf(b)));
}
