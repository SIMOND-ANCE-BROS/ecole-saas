/**
 * Règles de l'équipe d'une école (#104) : on ne modifie pas son propre accès
 * (pas de verrouillage par erreur) et il reste toujours au moins une personne
 * active à la direction, seule à pouvoir gérer l'équipe.
 */

export type Role = "direction" | "accueil" | "professeur";
export type MembreEquipe = { id: string; role: Role; actif: boolean };

/** Message de refus d'un changement de rôle ou d'activité, ou null s'il est permis. */
export function refusChangement(membres: MembreEquipe[], auteurId: string, cibleId: string, apres: { role: Role; actif: boolean }): string | null {
  const cible = membres.find((m) => m.id === cibleId);
  if (!cible) return "Ce membre n’existe plus.";
  if (cibleId === auteurId) return "Vous ne pouvez pas modifier votre propre accès : demandez à une autre personne de la direction.";
  const directions = membres.filter((m) => (m.id === cibleId ? apres.role === "direction" && apres.actif : m.role === "direction" && m.actif)).length;
  if (directions === 0) return "Il faut au moins une personne active à la direction.";
  return null;
}

/** Mot de passe choisi par la personne : longueur seulement (une phrase de passe vaut mieux qu'un mélange imposé). */
export function refusMotDePasse(motDePasse: string, confirmation: string): string | null {
  if (motDePasse.length < 10) return "Choisissez au moins 10 caractères (une phrase de passe convient très bien).";
  if (motDePasse.length > 128) return "128 caractères au plus.";
  if (motDePasse !== confirmation) return "Les deux mots de passe ne sont pas identiques.";
  return null;
}
