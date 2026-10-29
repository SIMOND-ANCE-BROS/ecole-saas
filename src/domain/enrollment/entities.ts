import type { EnrollmentRequest } from "../tariff/types";

/**
 * Enrollments over the businesses of a school (#299, ADR 0006): a course is sold by
 * one billing entity and an enrollment never spans two. The courses chosen at the
 * front desk are split into one enrollment per entity, each priced on its own
 * combination of courses (#288 Q3 default). Siblings are counted over all the
 * payer's enrollments whatever their entity, each discount staying on its own
 * enrollment (#288 Q2 default): the tariff engine already works that way when it
 * receives every request of the payer.
 */

/** A chosen course with what pricing and splitting need. */
export type EntityCourse = {
  courseId: string;
  billingEntityId: string;
  disciplineId: string;
  durationMinutes: number;
};

/**
 * The courses grouped by entity, groups in `entityOrder` (the school's entities, the
 * default first), courses in the order given; an entity missing from the order comes
 * last. No courses: no group.
 */
export function groupByEntity<T extends { billingEntityId: string }>(
  courses: readonly T[],
  entityOrder: readonly string[],
): { billingEntityId: string; courses: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const c of courses) groups.set(c.billingEntityId, [...(groups.get(c.billingEntityId) ?? []), c]);
  const rank = (id: string) => {
    const i = entityOrder.indexOf(id);
    return i === -1 ? entityOrder.length : i;
  };
  // Array.prototype.sort is stable: unknown entities keep the order of their first course.
  return [...groups]
    .map(([billingEntityId, own]) => ({ billingEntityId, courses: own }))
    .sort((a, b) => rank(a.billingEntityId) - rank(b.billingEntityId));
}

/**
 * One tariff request per entity, referenced by the entity's id, with the same
 * students, audience and period. Without courses, a single request for the first
 * entity of the order, so that the engine says why it cannot be priced.
 */
export function requestsByEntity(
  entry: Pick<EnrollmentRequest, "studentIds" | "audience" | "period">,
  courses: readonly EntityCourse[],
  entityOrder: readonly string[],
): EnrollmentRequest[] {
  const groups = groupByEntity(courses, entityOrder);
  const base = { studentIds: entry.studentIds, audience: entry.audience, period: entry.period };
  if (groups.length === 0) return [{ reference: entityOrder[0] ?? "", ...base, courses: [] }];
  return groups.map((g) => ({
    reference: g.billingEntityId,
    ...base,
    courses: g.courses.map((c) => ({ disciplineId: c.disciplineId, durationMinutes: c.durationMinutes })),
  }));
}

/**
 * Why a course's entity cannot change, in French; null when it can. Its enrollments
 * belong to its entity (the database refuses an enrollment mixing two), and their
 * invoices will be issued by it; so do the lesson packs its private lessons were counted
 * on. The entity is set before the first enrollment or counted lesson.
 */
export function entityChangeRefusal(change: {
  from: string;
  to: string;
  enrollments: number;
  countedLessons: number;
}): string | null {
  if (change.from === change.to) return null;
  const end = " : l’entreprise qui le vend ne peut plus changer.";
  const n = change.enrollments;
  if (n > 0) return `Ce cours a ${n} inscription${n > 1 ? "s" : ""}${end}`;
  const c = change.countedLessons;
  if (c > 0) return `Ce cours a ${c} séance${c > 1 ? "s décomptées" : " décomptée"} d’un carnet${end}`;
  return null;
}
