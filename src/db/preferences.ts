import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { member, listPreference } from "./schema";

/**
 * Disposition des colonnes des listes, propre à chaque membre (#89). Le
 * membre est retrouvé par son compte dans l'école courante (RLS) : un compte
 * membre de deux écoles a une disposition par école. La validation des
 * colonnes revient à l'appelant (`lireDisposition`).
 */

const ECOLE_COURANTE = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

/** Colonnes enregistrées par ce compte pour cette liste, ou null (disposition par défaut). */
export async function lirePreference(tx: Tx, userId: string, liste: string): Promise<string[] | null> {
  const [p] = await tx
    .select({ colonnes: listPreference.columns })
    .from(listPreference)
    .innerJoin(member, eq(member.id, listPreference.memberId))
    .where(and(eq(member.userId, userId), eq(listPreference.list, liste)));
  return p?.colonnes ?? null;
}

/** Enregistre (ou remplace) la disposition ; false si le compte n'est pas membre de l'école courante. */
export async function enregistrerPreference(
  tx: Tx,
  userId: string,
  liste: string,
  colonnes: string[],
): Promise<boolean> {
  const [m] = await tx.select({ id: member.id }).from(member).where(eq(member.userId, userId));
  if (!m) return false;
  await tx
    .insert(listPreference)
    .values({ schoolId: ECOLE_COURANTE, memberId: m.id, list: liste, columns: colonnes })
    .onConflictDoUpdate({
      target: [listPreference.memberId, listPreference.list],
      set: { columns: colonnes, updatedAt: sql`now()` },
    });
  return true;
}
