import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { inscription, payeur } from "./schema";

/** Lectures du tableau de bord, toujours avec la transaction d'`avecEcole()` (RLS). */

export type ChiffresSaison = { inscriptions: number; danseurs: number; totalNetCentimes: number };

/** Inscriptions actives de la saison, danseurs distincts inscrits, montant total inscrit. */
export async function chiffresSaison(tx: Tx, saisonId: string): Promise<ChiffresSaison> {
  const [ligne] = await tx
    .select({
      inscriptions: sql<number>`count(*)::int`,
      totalNetCentimes: sql<number>`coalesce(sum(${inscription.prixNetCentimes}), 0)::int`,
      danseurs: sql<number>`(
        SELECT count(DISTINCT ic.danseur_id)::int FROM inscription_cours ic
        JOIN inscription i ON i.id = ic.inscription_id
        WHERE i.saison_id = ${saisonId} AND i.statut = 'active'
      )`,
    })
    .from(inscription)
    .where(and(eq(inscription.saisonId, saisonId), eq(inscription.statut, "active")));
  return ligne;
}

export type DerniereInscription = {
  id: string;
  payeurId: string;
  famille: string;
  danseurs: string;
  prixNetCentimes: number;
};

/** Dernières inscriptions de la saison, les plus récentes d'abord. */
export async function dernieresInscriptions(tx: Tx, saisonId: string, nombre = 8): Promise<DerniereInscription[]> {
  const lignes = await tx
    .select({
      id: inscription.id,
      payeurId: inscription.payeurId,
      nom: payeur.nom,
      prenom: payeur.prenom,
      raisonSociale: payeur.raisonSociale,
      prixNetCentimes: inscription.prixNetCentimes,
      danseurs: sql<string | null>`(
        SELECT string_agg(DISTINCT d.prenom, ' et ') FROM inscription_cours ic
        JOIN danseur d ON d.id = ic.danseur_id
        WHERE ic.inscription_id = ${inscription}.${sql.identifier("id")}
      )`,
    })
    .from(inscription)
    .innerJoin(payeur, eq(payeur.id, inscription.payeurId))
    .where(and(eq(inscription.saisonId, saisonId), eq(inscription.statut, "active")))
    .orderBy(desc(inscription.creeLe))
    .limit(nombre);

  return lignes.map((l) => ({
    id: l.id,
    payeurId: l.payeurId,
    famille: l.raisonSociale ?? [l.nom, l.prenom].filter(Boolean).join(" "),
    danseurs: l.danseurs ?? "—",
    prixNetCentimes: l.prixNetCentimes ?? 0,
  }));
}
