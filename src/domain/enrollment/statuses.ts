/** Libellés des statuts d'inscription, communs aux fiches, aux listes et aux filtres (SQL compris). */
export const ENROLLMENT_STATUS_LABELS = {
  active: "Inscrit",
  essai: "À l’essai",
  liste_attente: "En attente",
  abandon: "Abandon",
  terminee: "Terminé",
} as const;

export type EnrollmentStatus = keyof typeof ENROLLMENT_STATUS_LABELS;

/** Ordre de priorité quand un élève a plusieurs inscriptions dans la saison. */
export const STATUS_PRIORITY: EnrollmentStatus[] = ["active", "essai", "liste_attente", "abandon", "terminee"];
