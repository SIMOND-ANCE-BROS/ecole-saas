import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { nomAffiche } from "./personnes";
import { enrollment, person } from "./schema";

/** Lectures du tableau de bord, toujours avec la transaction d'`avecEcole()` (RLS). */

export type SeasonFigures = { enrollments: number; students: number; netTotalCents: number };

/** Inscriptions actives de la saison, danseurs distincts inscrits, montant total inscrit. */
export async function seasonFigures(tx: Tx, seasonId: string): Promise<SeasonFigures> {
  const [row] = await tx
    .select({
      enrollments: sql<number>`count(*)::int`,
      netTotalCents: sql<number>`coalesce(sum(${enrollment.netPriceCents}), 0)::int`,
      students: sql<number>`(
        SELECT count(DISTINCT ic.student_id)::int FROM enrollment_course ic
        JOIN enrollment i ON i.id = ic.enrollment_id
        WHERE i.season_id = ${seasonId} AND i.status = 'active'
      )`,
    })
    .from(enrollment)
    .where(and(eq(enrollment.seasonId, seasonId), eq(enrollment.status, "active")));
  return row;
}

export type LastEnrollment = {
  id: string;
  payerId: string;
  /** Nom du payeur. */
  payer: string;
  students: string;
  netPriceCents: number;
};

/** Dernières inscriptions de la saison, les plus récentes d'abord. */
export async function lastEnrollments(tx: Tx, seasonId: string, nombre = 8): Promise<LastEnrollment[]> {
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
    .limit(nombre);

  return rows.map((l) => ({
    id: l.id,
    payerId: l.payerId,
    payer: nomAffiche(l),
    students: l.students ?? "—",
    netPriceCents: l.netPriceCents ?? 0,
  }));
}
