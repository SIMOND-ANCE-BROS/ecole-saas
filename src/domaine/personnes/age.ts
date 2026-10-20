/** Âge en années révolues au jour donné (dates `YYYY-MM-DD`, sans heure). */
export function ageAu(dateNaissance: string, jour: string): number {
  const [anneeN, moisN, jourN] = dateNaissance.split("-").map(Number);
  const [annee, mois, j] = jour.split("-").map(Number);
  const avantAnniversaire = mois < moisN || (mois === moisN && j < jourN);
  return annee - anneeN - (avantAnniversaire ? 1 : 0);
}

const formatParis = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Date du jour à Paris, `YYYY-MM-DD` (le serveur peut tourner en UTC). */
export function aujourdhuiAParis(maintenant: Date = new Date()): string {
  return formatParis.format(maintenant);
}
