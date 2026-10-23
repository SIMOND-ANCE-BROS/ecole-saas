import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { nomAffiche } from "./personnes";
import { enrollment, person } from "./schema";

/** Lectures du tableau de bord, toujours avec la transaction d'`avecEcole()` (RLS). */

export type ChiffresSaison = { inscriptions: number; danseurs: number; totalNetCentimes: number };

/** Inscriptions actives de la saison, danseurs distincts inscrits, montant total inscrit. */
export async function chiffresSaison(tx: Tx, saisonId: string): Promise<ChiffresSaison> {
  const [ligne] = await tx
    .select({
      inscriptions: sql<number>`count(*)::int`,
      totalNetCentimes: sql<number>`coalesce(sum(${enrollment.netPriceCents}), 0)::int`,
      danseurs: sql<number>`(
        SELECT count(DISTINCT ic.student_id)::int FROM enrollment_course ic
        JOIN enrollment i ON i.id = ic.enrollment_id
        WHERE i.season_id = ${saisonId} AND i.status = 'active'
      )`,
    })
    .from(enrollment)
    .where(and(eq(enrollment.seasonId, saisonId), eq(enrollment.status, "active")));
  return ligne;
}

export type DerniereInscription = {
  id: string;
  payeurId: string;
  /** Nom du payeur. */
  payeur: string;
  danseurs: string;
  prixNetCentimes: number;
};

/** Dernières inscriptions de la saison, les plus récentes d'abord. */
export async function dernieresInscriptions(tx: Tx, saisonId: string, nombre = 8): Promise<DerniereInscription[]> {
  const lignes = await tx
    .select({
      id: enrollment.id,
      payeurId: enrollment.payerId,
      nom: person.lastName,
      prenom: person.firstName,
      raisonSociale: person.companyName,
      prixNetCentimes: enrollment.netPriceCents,
      danseurs: sql<string | null>`(
        SELECT string_agg(DISTINCT coalesce(d.first_name, d.last_name), ' et ') FROM enrollment_course ic
        JOIN person d ON d.id = ic.student_id
        WHERE ic.enrollment_id = ${enrollment}.${sql.identifier("id")}
      )`,
    })
    .from(enrollment)
    .innerJoin(person, eq(person.id, enrollment.payerId))
    .where(and(eq(enrollment.seasonId, saisonId), eq(enrollment.status, "active")))
    .orderBy(desc(enrollment.createdAt))
    .limit(nombre);

  return lignes.map((l) => ({
    id: l.id,
    payeurId: l.payeurId,
    payeur: nomAffiche(l),
    danseurs: l.danseurs ?? "—",
    prixNetCentimes: l.prixNetCentimes ?? 0,
  }));
}
