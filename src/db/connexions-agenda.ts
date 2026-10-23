import { and, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Fournisseur } from "../connecteurs/agenda/oauth";
import type { Tx } from "./index";
import { calendarConnection, unavailability, instructor } from "./schema";

/** Agendas connectés des intervenants, toujours avec la transaction d'`avecEcole()` (RLS). */

const ECOLE_COURANTE = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const estUuid = (v: string) => z.uuid().safeParse(v).success;

export type EtatConnexion = {
  fournisseur: Fournisseur;
  compte: string | null;
  derniereSynchro: Date | null;
  erreur: string | null;
};

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
    .select({ id: instructor.id })
    .from(instructor)
    .where(and(eq(instructor.id, intervenantId), eq(instructor.active, true)));
  if (!i) return false;
  const colonnes = { provider: c.fournisseur, account: c.compte, encryptedToken: c.jetonChiffre };
  await tx
    .insert(calendarConnection)
    .values({ ...colonnes, instructorId: intervenantId, schoolId: ECOLE_COURANTE })
    .onConflictDoUpdate({
      target: calendarConnection.instructorId,
      set: { ...colonnes, lastSyncedAt: null, error: null, createdAt: sql`now()` },
    });
  return true;
}

export async function etatConnexion(tx: Tx, intervenantId: string): Promise<EtatConnexion | null> {
  if (!estUuid(intervenantId)) return null;
  const [c] = await tx
    .select({
      fournisseur: calendarConnection.provider,
      compte: calendarConnection.account,
      derniereSynchro: calendarConnection.lastSyncedAt,
      erreur: calendarConnection.error,
    })
    .from(calendarConnection)
    .where(eq(calendarConnection.instructorId, intervenantId));
  return c ?? null;
}

/** Pour la synchronisation seulement : jeton chiffré compris. */
export async function lireConnexion(tx: Tx, intervenantId: string) {
  if (!estUuid(intervenantId)) return null;
  const [c] = await tx
    .select({ fournisseur: calendarConnection.provider, jetonChiffre: calendarConnection.encryptedToken })
    .from(calendarConnection)
    .innerJoin(instructor, eq(instructor.id, calendarConnection.instructorId))
    .where(and(eq(calendarConnection.instructorId, intervenantId), eq(instructor.active, true)));
  return c ?? null;
}

export async function intervenantsConnectes(tx: Tx): Promise<string[]> {
  const lignes = await tx
    .select({ id: calendarConnection.instructorId })
    .from(calendarConnection)
    .innerJoin(instructor, eq(instructor.id, calendarConnection.instructorId))
    .where(eq(instructor.active, true));
  return lignes.map((c) => c.id);
}

/** Résultat d'une synchronisation ; un jeton renouvelé par le fournisseur remplace l'ancien. */
export async function noterSynchro(
  tx: Tx,
  intervenantId: string,
  r: { erreur: string | null; jetonChiffre?: string },
): Promise<void> {
  await tx
    .update(calendarConnection)
    .set({
      error: r.erreur,
      ...(r.erreur ? {} : { lastSyncedAt: sql`now()` }),
      ...(r.jetonChiffre ? { encryptedToken: r.jetonChiffre } : {}),
    })
    .where(eq(calendarConnection.instructorId, intervenantId));
}

/** Déconnecte l'agenda et retire les plages à venir qui en venaient (les saisies restent). */
export async function supprimerConnexion(tx: Tx, intervenantId: string): Promise<boolean> {
  if (!estUuid(intervenantId)) return false;
  const lignes = await tx
    .delete(calendarConnection)
    .where(eq(calendarConnection.instructorId, intervenantId))
    .returning({ id: calendarConnection.id });
  await tx
    .delete(unavailability)
    .where(
      and(
        eq(unavailability.instructorId, intervenantId),
        ne(unavailability.source, "saisie"),
        gt(unavailability.endsAt, sql`now()`),
      ),
    );
  return lignes.length === 1;
}
