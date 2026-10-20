/** Semaines du planning daté (#90) : dates `YYYY-MM-DD`, calculs en UTC pour éviter les décalages d'heure d'été. */

const UN_JOUR = 86_400_000;
const versJour = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const versIso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** 1 = lundi … 7 = dimanche. */
export const jourSemaineDe = (iso: string) => ((new Date(versJour(iso)).getUTCDay() + 6) % 7) + 1;

export const ajouterJours = (iso: string, n: number) => versIso(versJour(iso) + n * UN_JOUR);

/** Lundi de la semaine qui contient `iso`. */
export const lundiDe = (iso: string) => ajouterJours(iso, 1 - jourSemaineDe(iso));

/** Les sept dates de la semaine qui commence le lundi `lundi`. */
export const joursDeLaSemaine = (lundi: string) => Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));

/** Date valide `YYYY-MM-DD`, sinon null (paramètre d'adresse). */
export function dateValide(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return versIso(versJour(v)) === v ? v : null;
}
