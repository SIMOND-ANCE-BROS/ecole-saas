import { and, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Fournisseur } from "../connecteurs/agenda/oauth";
import type { Tx } from "./index";
import { connexionAgenda, indisponibilite, intervenant } from "./schema";

/** Agendas connectés des intervenants, toujours avec la transaction d'`avecEcole()` (RLS). */

const ECOLE_COURANTE = sql`nullif(current_setting('app.ecole_id', true), '')::uuid`;
const estUuid = (v: string) => z.uuid().safeParse(v).success;

export type EtatConnexion = { fournisseur: Fournisseur; compte: string | null; derniereSynchro: Date | null; erreur: string | null };

/**
 * Enregistre (ou remplace) l'agenda connecté d'un intervenant actif ; le jeton
 * arrive déjà chiffré. false si l'intervenant n'existe pas ou n'est plus actif.
 */
export async function enregistrerConnexion(
  tx: Tx,
  intervenantId: string,
  c: { fournisseur: Fournisseur; compte: string | null; jetonChiffre: string },
): Promise<boolean> {
  if (!estUuid(intervenantId)) return false;
  const [i] = await tx
    .select({ id: intervenant.id })
    .from(intervenant)
    .where(and(eq(intervenant.id, intervenantId), eq(intervenant.actif, true)));
  if (!i) return false;
  await tx
    .insert(connexionAgenda)
    .values({ ...c, intervenantId, ecoleId: ECOLE_COURANTE })
    .onConflictDoUpdate({
      target: connexionAgenda.intervenantId,
      set: { ...c, derniereSynchro: null, erreur: null, creeLe: sql`now()` },
    });
  return true;
}

export async function etatConnexion(tx: Tx, intervenantId: string): Promise<EtatConnexion | null> {
  if (!estUuid(intervenantId)) return null;
  const [c] = await tx
    .select({
      fournisseur: connexionAgenda.fournisseur,
      compte: connexionAgenda.compte,
      derniereSynchro: connexionAgenda.derniereSynchro,
      erreur: connexionAgenda.erreur,
    })
    .from(connexionAgenda)
    .where(eq(connexionAgenda.intervenantId, intervenantId));
  return c ?? null;
}

/** Pour la synchronisation seulement : jeton chiffré compris. */
export async function lireConnexion(tx: Tx, intervenantId: string) {
  if (!estUuid(intervenantId)) return null;
  const [c] = await tx
    .select({ fournisseur: connexionAgenda.fournisseur, jetonChiffre: connexionAgenda.jetonChiffre })
    .from(connexionAgenda)
    .innerJoin(intervenant, eq(intervenant.id, connexionAgenda.intervenantId))
    .where(and(eq(connexionAgenda.intervenantId, intervenantId), eq(intervenant.actif, true)));
  return c ?? null;
}

export async function intervenantsConnectes(tx: Tx): Promise<string[]> {
  const lignes = await tx
    .select({ id: connexionAgenda.intervenantId })
    .from(connexionAgenda)
    .innerJoin(intervenant, eq(intervenant.id, connexionAgenda.intervenantId))
    .where(eq(intervenant.actif, true));
  return lignes.map((c) => c.id);
}

/** Résultat d'une synchronisation ; un jeton renouvelé par le fournisseur remplace l'ancien. */
export async function noterSynchro(tx: Tx, intervenantId: string, r: { erreur: string | null; jetonChiffre?: string }): Promise<void> {
  await tx
    .update(connexionAgenda)
    .set({
      erreur: r.erreur,
      ...(r.erreur ? {} : { derniereSynchro: sql`now()` }),
      ...(r.jetonChiffre ? { jetonChiffre: r.jetonChiffre } : {}),
    })
    .where(eq(connexionAgenda.intervenantId, intervenantId));
}

/** Déconnecte l'agenda et retire les plages à venir qui en venaient (les saisies restent). */
export async function supprimerConnexion(tx: Tx, intervenantId: string): Promise<boolean> {
  if (!estUuid(intervenantId)) return false;
  const lignes = await tx.delete(connexionAgenda).where(eq(connexionAgenda.intervenantId, intervenantId)).returning({ id: connexionAgenda.id });
  await tx
    .delete(indisponibilite)
    .where(and(eq(indisponibilite.intervenantId, intervenantId), ne(indisponibilite.origine, "saisie"), gt(indisponibilite.fin, sql`now()`)));
  return lignes.length === 1;
}
