import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { membre, preferenceListe } from "./schema";

/**
 * Disposition des colonnes des listes, propre à chaque membre (#89). Le
 * membre est retrouvé par son compte dans l'école courante (RLS) : un compte
 * membre de deux écoles a une disposition par école. La validation des
 * colonnes revient à l'appelant (`lireDisposition`).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.ecole_id', true), '')::uuid`;

/** Colonnes enregistrées par ce compte pour cette liste, ou null (disposition par défaut). */
export async function lirePreference(tx: Tx, userId: string, liste: string): Promise<string[] | null> {
  const [p] = await tx
    .select({ colonnes: preferenceListe.colonnes })
    .from(preferenceListe)
    .innerJoin(membre, eq(membre.id, preferenceListe.membreId))
    .where(and(eq(membre.userId, userId), eq(preferenceListe.liste, liste)));
  return p?.colonnes ?? null;
}

/** Enregistre (ou remplace) la disposition ; false si le compte n'est pas membre de l'école courante. */
export async function enregistrerPreference(tx: Tx, userId: string, liste: string, colonnes: string[]): Promise<boolean> {
  const [m] = await tx.select({ id: membre.id }).from(membre).where(eq(membre.userId, userId));
  if (!m) return false;
  await tx
    .insert(preferenceListe)
    .values({ ecoleId: ECOLE_COURANTE, membreId: m.id, liste, colonnes })
    .onConflictDoUpdate({ target: [preferenceListe.membreId, preferenceListe.liste], set: { colonnes, modifieLe: sql`now()` } });
  return true;
}
