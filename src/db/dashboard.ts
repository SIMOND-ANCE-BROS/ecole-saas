import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { displayedName } from "./people";
import { enrollment, person } from "./schema";
import { quarterCountSql } from "./enrollments";
import { seasonDueCents } from "../domain/enrollment/quarters";

/** Dashboard reads, always within the `withSchool()` transaction (RLS). */

export type SeasonFigures = { enrollments: number; students: number; netTotalCents: number };

/**
 * Active enrollments of the season, distinct enrolled students, total enrolled amount: what
 * they cost over the season, a quarterly one once per covered quarter (#291).
 */
export async function seasonFigures(tx: Tx, seasonId: string): Promise<SeasonFigures> {
  const rows = await tx
    .select({
      period: enrollment.period,
      netPriceCents: sql<number>`${enrollment.netPriceCents}::int`,
      quarterCount: quarterCountSql,
    })
    .from(enrollment)
    .where(and(eq(enrollment.seasonId, seasonId), eq(enrollment.status, "active")));
  const [{ students }] = await tx.execute<{ students: number }>(sql`
    SELECT count(DISTINCT ic.student_id)::int AS students FROM enrollment_course ic
    JOIN enrollment i ON i.id = ic.enrollment_id
    WHERE i.season_id = ${seasonId} AND i.status = 'active'`);
  return {
    enrollments: rows.length,
    students,
    netTotalCents: rows.reduce((total, r) => total + seasonDueCents(r), 0),
  };
}

export type LastEnrollment = {
  id: string;
  payerId: string;
  /** Payer's name. */
  payer: string;
  students: string;
  netPriceCents: number;
};

/** Latest enrollments of the season, most recent first. */
export async function lastEnrollments(tx: Tx, seasonId: string, limit = 8): Promise<LastEnrollment[]> {
  const rows = await tx
    .select({
      id: enrollment.id,
      payerId: enrollment.payerId,
      name: person.lastName,
      firstName: person.firstName,
      companyName: person.companyName,
      netPriceCents: enrollment.netPriceCents,
      students: sql<string | null>`(
        SELECT string_agg(DISTINCT coalesce(d.first_name, d.last_name), ' et ') FROM enrollment_course ic
        JOIN person d ON d.id = ic.student_id
        WHERE ic.enrollment_id = ${enrollment}.${sql.identifier("id")}
      )`,
    })
    .from(enrollment)
    .innerJoin(person, eq(person.id, enrollment.payerId))
    .where(and(eq(enrollment.seasonId, seasonId), eq(enrollment.status, "active")))
    .orderBy(desc(enrollment.createdAt))
    .limit(limit);

  return rows.map((l) => ({
    id: l.id,
    payerId: l.payerId,
    payer: displayedName(l),
    students: l.students ?? "—",
    netPriceCents: l.netPriceCents ?? 0,
  }));
}
