/** Enrollment status labels, shared by records, lists and filters (SQL included). */
export const ENROLLMENT_STATUS_LABELS = {
  active: "Inscrit",
  essai: "À l’essai",
  liste_attente: "En attente",
  abandon: "Abandon",
  terminee: "Terminé",
} as const;

export type EnrollmentStatus = keyof typeof ENROLLMENT_STATUS_LABELS;

/** Priority order when a student has several enrollments in the season. */
export const STATUS_PRIORITY: EnrollmentStatus[] = ["active", "essai", "liste_attente", "abandon", "terminee"];
