/**
 * Rules for a school's team (#104): nobody changes their own access (no
 * accidental lock-out) and there is always at least one active person in
 * management, the only role able to manage the team.
 */

export type Role = "direction" | "accueil" | "professeur";
export type TeamMember = { id: string; role: Role; active: boolean };

/** Refusal message for a change of role or active status, or null if it is allowed. */
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

/** Password chosen by the person: length only (a passphrase beats an imposed mix of characters). */
export function passwordRefusal(password: string, confirmation: string): string | null {
  if (password.length < 10) return "Choisissez au moins 10 caractères (une phrase de passe convient très bien).";
  if (password.length > 128) return "128 caractères au plus.";
  if (password !== confirmation) return "Les deux mots de passe ne sont pas identiques.";
  return null;
}
