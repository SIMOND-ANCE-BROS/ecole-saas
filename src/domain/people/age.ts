/** Âge en années révolues au jour donné (dates `YYYY-MM-DD`, sans heure). */
export function ageAt(birthDate: string, day: string): number {
  const [yearN, monthN, dayN] = birthDate.split("-").map(Number);
  const [annee, month, j] = day.split("-").map(Number);
  const beforeBirthday = month < monthN || (month === monthN && j < dayN);
  return annee - yearN - (beforeBirthday ? 1 : 0);
}

const formatParis = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Date du jour à Paris, `YYYY-MM-DD` (le serveur peut tourner en UTC). */
export function todayInParis(now: Date = new Date()): string {
  return formatParis.format(now);
}
