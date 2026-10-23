/**
 * Règles de l'équipe d'une école (#104) : on ne modifie pas son propre accès
 * (pas de verrouillage par erreur) et il reste toujours au moins une personne
 * active à la direction, seule à pouvoir gérer l'équipe.
 */

export type Role = "direction" | "accueil" | "professeur";
export type TeamMember = { id: string; role: Role; active: boolean };

/** Message de refus d'un changement de rôle ou d'activité, ou null s'il est permis. */
export function changeRefusal(
  members: TeamMember[],
  authorId: string,
  targetId: string,
  after: { role: Role; active: boolean },
): string | null {
  const target = members.find((m) => m.id === targetId);
  if (!target) return "Ce membre n’existe plus.";
  if (targetId === authorId)
    return "Vous ne pouvez pas modifier votre propre accès : demandez à une autre personne de la direction.";
  const directions = members.filter((m) =>
    m.id === targetId ? after.role === "direction" && after.active : m.role === "direction" && m.active,
  ).length;
  if (directions === 0) return "Il faut au moins une personne active à la direction.";
  return null;
}

/** Mot de passe choisi par la personne : longueur seulement (une phrase de passe vaut mieux qu'un mélange imposé). */
export function passwordRefusal(password: string, confirmation: string): string | null {
  if (password.length < 10) return "Choisissez au moins 10 caractères (une phrase de passe convient très bien).";
  if (password.length > 128) return "128 caractères au plus.";
  if (password !== confirmation) return "Les deux mots de passe ne sont pas identiques.";
  return null;
}
