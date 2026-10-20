import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { nomAffiche } from "./personnes";
import { inscription, personne } from "./schema";

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
  /** Nom du payeur. */
  payeur: string;
  danseurs: string;
  prixNetCentimes: number;
};

/** Dernières inscriptions de la saison, les plus récentes d'abord. */
export async function dernieresInscriptions(tx: Tx, saisonId: string, nombre = 8): Promise<DerniereInscription[]> {
  const lignes = await tx
    .select({
      id: inscription.id,
      payeurId: inscription.payeurId,
      nom: personne.nom,
      prenom: personne.prenom,
      raisonSociale: personne.raisonSociale,
      prixNetCentimes: inscription.prixNetCentimes,
      danseurs: sql<string | null>`(
        SELECT string_agg(DISTINCT coalesce(d.prenom, d.nom), ' et ') FROM inscription_cours ic
        JOIN personne d ON d.id = ic.danseur_id
        WHERE ic.inscription_id = ${inscription}.${sql.identifier("id")}
      )`,
    })
    .from(inscription)
    .innerJoin(personne, eq(personne.id, inscription.payeurId))
    .where(and(eq(inscription.saisonId, saisonId), eq(inscription.statut, "active")))
    .orderBy(desc(inscription.creeLe))
    .limit(nombre);

  return lignes.map((l) => ({
    id: l.id,
    payeurId: l.payeurId,
    payeur: nomAffiche(l),
    danseurs: l.danseurs ?? "—",
    prixNetCentimes: l.prixNetCentimes ?? 0,
  }));
}
