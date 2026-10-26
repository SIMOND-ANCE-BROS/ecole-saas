/**
 * Rules for a school's team (#104): nobody changes their own access (no
 * accidental lock-out) and there is always at least one active person in
 * management, the only role able to manage the team.
 */

/** Member roles, in the order of the `member_role` database enum. */
export const ROLE_VALUES = ["director", "front_desk", "teacher"] as const;
export type Role = (typeof ROLE_VALUES)[number];
export type TeamMember = { id: string; role: Role; active: boolean };

/** Role names shown to the user. */
export const ROLE_LABELS: Record<Role, string> = {
  director: "Direction",
  front_desk: "Accueil",
  teacher: "Professeur",
};

/** Roles that can be given today; teacher accounts will come later (#22). */
export const INVITABLE_ROLES = ["front_desk", "director"] as const satisfies readonly Role[];

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
    m.id === targetId ? after.role === "director" && after.active : m.role === "director" && m.active,
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
