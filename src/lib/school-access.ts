import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schoolsOf } from "../db";
import { session } from "../db/schema";

export type MemberRole = "direction" | "accueil" | "professeur";

/** Ce dont une requête métier a besoin : qui, dans quelle école, avec quel rôle. */
export type SchoolContext = { userId: string; schoolId: string; role: MemberRole };

const uuid = z.uuid();

/**
 * Enregistre l'école choisie sur la session, seulement si l'utilisateur en est
 * membre actif et que la session lui appartient. L'identifiant proposé par le
 * navigateur n'est jamais utilisé tel quel : il doit figurer dans `schoolsOf`.
 */
export async function chooseSchool(sessionId: string, userId: string, schoolId: string): Promise<boolean> {
  if (!(await membership(userId, schoolId))) return false;
  const modified = await db
    .update(session)
    .set({ selectedSchoolId: schoolId, updatedAt: new Date() })
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .returning({ id: session.id });
  return modified.length === 1;
}

/**
 * Contexte de l'école courante, revérifié à chaque requête : null si aucune
 * école n'est choisie ou si l'accès a été retiré depuis.
 */
export async function contextFromSession(
  userId: string,
  selectedSchoolId: string | null | undefined,
): Promise<SchoolContext | null> {
  if (!selectedSchoolId) return null;
  const member = await membership(userId, selectedSchoolId);
  return member ? { userId, schoolId: selectedSchoolId, role: member.role } : null;
}

/** Identifiant de la session portant ce jeton (renvoyé par la connexion). */
export async function idDeSession(token: string): Promise<string | null> {
  const [row] = await db.select({ id: session.id }).from(session).where(eq(session.token, token));
  return row?.id ?? null;
}

async function membership(userId: string, schoolId: string) {
  if (!uuid.safeParse(schoolId).success) return null;
  const ecoles = await schoolsOf(userId);
  return ecoles.find((e) => e.id === schoolId) ?? null;
}
