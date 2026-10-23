/** Weeks of the dated schedule (#90): `YYYY-MM-DD` dates, computed in UTC to avoid summer time shifts. */

const ONE_DAY = 86_400_000;
const toDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** 1 = Monday … 7 = Sunday. */
export const weekdayOf = (iso: string) => ((new Date(toDay(iso)).getUTCDay() + 6) % 7) + 1;

export const addDays = (iso: string, n: number) => toIso(toDay(iso) + n * ONE_DAY);

/** Monday of the week containing `iso`. */
export const mondayOf = (iso: string) => addDays(iso, 1 - weekdayOf(iso));

/** The seven dates of the week starting on Monday `monday`. */
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** Valid `YYYY-MM-DD` date, otherwise null (URL parameter). */
export function validDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return toIso(toDay(v)) === v ? v : null;
}
