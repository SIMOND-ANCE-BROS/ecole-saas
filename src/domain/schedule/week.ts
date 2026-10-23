/** Semaines du planning daté (#90) : dates `YYYY-MM-DD`, calculs en UTC pour éviter les décalages d'heure d'été. */

const ONE_DAY = 86_400_000;
const toDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** 1 = lundi … 7 = dimanche. */
export const weekdayOf = (iso: string) => ((new Date(toDay(iso)).getUTCDay() + 6) % 7) + 1;

export const addDays = (iso: string, n: number) => toIso(toDay(iso) + n * ONE_DAY);

/** Lundi de la semaine qui contient `iso`. */
export const mondayOf = (iso: string) => addDays(iso, 1 - weekdayOf(iso));

/** Les sept dates de la semaine qui commence le lundi `lundi`. */
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** Date valide `YYYY-MM-DD`, sinon null (paramètre d'adresse). */
export function validDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return toIso(toDay(v)) === v ? v : null;
}
