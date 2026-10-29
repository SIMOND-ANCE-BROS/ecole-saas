/** Months of instructor statements (#285): `YYYY-MM` strings, computed in UTC to avoid time-zone shifts. */

/** Valid `YYYY-MM` month (URL parameter), otherwise null. */
export function validMonth(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return null;
  const month = Number(m[2]);
  return Number(m[1]) >= 2000 && month >= 1 && month <= 12 ? v : null;
}

/** Month of a `YYYY-MM-DD` date. */
export const monthOf = (date: string) => date.slice(0, 7);

/** First and last day of a month, `YYYY-MM-DD`. */
export function monthBounds(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** The month `n` months after (or before, `n` < 0). */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const monthName = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

/** « octobre 2027 ». */
export const monthLabel = (month: string) => monthName.format(new Date(`${month}-01T00:00:00Z`));

/** « d’octobre 2027 », « de septembre 2027 »: the French elision before a vowel (avril, août, octobre). */
export function ofMonth(month: string): string {
  const label = monthLabel(month);
  return /^[aeiouy]/.test(label) ? `d’${label}` : `de ${label}`;
}
