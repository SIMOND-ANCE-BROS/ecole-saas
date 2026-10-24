/** Enrollment status labels, shared by records, lists and filters (SQL included). */
export const ENROLLMENT_STATUS_LABELS = {
  active: "Inscrit",
  trial: "À l’essai",
  waitlist: "En attente",
  dropped: "Abandon",
  ended: "Terminé",
} as const;

export type EnrollmentStatus = keyof typeof ENROLLMENT_STATUS_LABELS;

/** Priority order when a student has several enrollments in the season. */
export const STATUS_PRIORITY: EnrollmentStatus[] = ["active", "trial", "waitlist", "dropped", "ended"];
