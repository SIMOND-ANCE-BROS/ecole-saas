import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, ecolesDe } from "../db";
import { session } from "../db/schema";

export type RoleMembre = "direction" | "accueil" | "professeur";

/** Ce dont une requête métier a besoin : qui, dans quelle école, avec quel rôle. */
export type ContexteEcole = { userId: string; ecoleId: string; role: RoleMembre };

const uuid = z.uuid();

/**
 * Enregistre l'école choisie sur la session, seulement si l'utilisateur en est
 * membre actif et que la session lui appartient. L'identifiant proposé par le
 * navigateur n'est jamais utilisé tel quel : il doit figurer dans `ecolesDe`.
 */
export async function choisirEcole(sessionId: string, userId: string, ecoleId: string): Promise<boolean> {
  if (!(await appartenance(userId, ecoleId))) return false;
  const modifiees = await db
    .update(session)
    .set({ ecoleChoisie: ecoleId, updatedAt: new Date() })
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .returning({ id: session.id });
  return modifiees.length === 1;
}

/**
 * Contexte de l'école courante, revérifié à chaque requête : null si aucune
 * école n'est choisie ou si l'accès a été retiré depuis.
 */
export async function contexteDepuisSession(
  userId: string,
  ecoleChoisie: string | null | undefined,
): Promise<ContexteEcole | null> {
  if (!ecoleChoisie) return null;
  const membre = await appartenance(userId, ecoleChoisie);
  return membre ? { userId, ecoleId: ecoleChoisie, role: membre.role } : null;
}

/** Identifiant de la session portant ce jeton (renvoyé par la connexion). */
export async function idDeSession(jeton: string): Promise<string | null> {
  const [ligne] = await db.select({ id: session.id }).from(session).where(eq(session.token, jeton));
  return ligne?.id ?? null;
}

async function appartenance(userId: string, ecoleId: string) {
  if (!uuid.safeParse(ecoleId).success) return null;
  const ecoles = await ecolesDe(userId);
  return ecoles.find((e) => e.id === ecoleId) ?? null;
}
