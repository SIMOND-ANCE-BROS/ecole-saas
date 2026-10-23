import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { type ContexteEcole, contexteDepuisSession, type RoleMembre } from "./acces-ecole";
import { auth } from "./auth";

/**
 * Couche d'accès (DAL) : à appeler dans chaque page et chaque server action
 * protégée, au plus près des données (pas dans un layout, qui n'est pas
 * réexécuté à chaque navigation). Mise en cache le temps d'un rendu.
 */

/** Session valide (vérifiée en base), sinon redirection vers la connexion. */
export const sessionCourante = cache(async () => {
  const resultat = await auth.api.getSession({ headers: await headers() });
  if (!resultat) redirect("/connexion");
  return resultat;
});

/**
 * École courante, prise sur la session côté serveur et revérifiée (membre
 * actif) ; sinon redirection vers le choix de l'école. À passer à avecEcole().
 */
export const contexteEcole = cache(async (): Promise<ContexteEcole> => {
  const { session, user } = await sessionCourante();
  const contexte = await contexteDepuisSession(user.id, session.selectedSchoolId);
  if (!contexte) redirect("/ecoles");
  return contexte;
});

/** École courante, à condition d'avoir l'un des rôles demandés. */
export async function exigerRole(...roles: RoleMembre[]): Promise<ContexteEcole> {
  const contexte = await contexteEcole();
  if (!roles.includes(contexte.role)) redirect("/");
  return contexte;
}
