/** Libellés des statuts d'inscription, communs aux fiches, aux listes et aux filtres (SQL compris). */
export const LIBELLES_STATUT_INSCRIPTION = {
  active: "Inscrit",
  essai: "À l’essai",
  liste_attente: "En attente",
  abandon: "Abandon",
  terminee: "Terminé",
} as const;

export type StatutInscription = keyof typeof LIBELLES_STATUT_INSCRIPTION;

/** Ordre de priorité quand un élève a plusieurs inscriptions dans la saison. */
export const PRIORITE_STATUT: StatutInscription[] = ["active", "essai", "liste_attente", "abandon", "terminee"];
