import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { type SchoolContext, contextFromSession, type MemberRole } from "./school-access";
import { auth } from "./auth";

/**
 * Couche d'accès (DAL) : à appeler dans chaque page et chaque server action
 * protégée, au plus près des données (pas dans un layout, qui n'est pas
 * réexécuté à chaque navigation). Mise en cache le temps d'un rendu.
 */

/** Session valide (vérifiée en base), sinon redirection vers la connexion. */
export const currentSession = cache(async () => {
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result) redirect("/connexion");
  return result;
});

/**
 * École courante, prise sur la session côté serveur et revérifiée (membre
 * actif) ; sinon redirection vers le choix de l'école. À passer à withSchool().
 */
export const schoolContext = cache(async (): Promise<SchoolContext> => {
  const { session, user } = await currentSession();
  const context = await contextFromSession(user.id, session.selectedSchoolId);
  if (!context) redirect("/ecoles");
  return context;
});

/** École courante, à condition d'avoir l'un des rôles demandés. */
export async function requireRole(...roles: MemberRole[]): Promise<SchoolContext> {
  const context = await schoolContext();
  if (!roles.includes(context.role)) redirect("/");
  return context;
}
