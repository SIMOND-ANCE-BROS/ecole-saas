/** Age in completed years on the given day (`YYYY-MM-DD` dates, no time). */
export function ageAt(birthDate: string, day: string): number {
  const [yearN, monthN, dayN] = birthDate.split("-").map(Number);
  const [year, month, j] = day.split("-").map(Number);
  const beforeBirthday = month < monthN || (month === monthN && j < dayN);
  return year - yearN - (beforeBirthday ? 1 : 0);
}

/** Under 18 on the given day; false when the birth date is unknown. */
export function isMinor(birthDate: string | null, day: string): boolean {
  return birthDate !== null && ageAt(birthDate, day) < 18;
}

const formatParis = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in Paris, `YYYY-MM-DD` (the server may run in UTC). */
export function todayInParis(now: Date = new Date()): string {
  return formatParis.format(now);
}
