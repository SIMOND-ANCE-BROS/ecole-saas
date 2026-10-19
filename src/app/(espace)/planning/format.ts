/** Mise en forme des créneaux, commune au planning et au détail d'un cours. */

export const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/** Heure de fin `HH:MM` d'un créneau. */
export function fin(heure: string, duree: number): string {
  const [h, m] = heure.split(":").map(Number);
  const total = h * 60 + m + duree;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function ages(min: number | null, max: number | null): string | null {
  if (min && max) return `${min} à ${max} ans`;
  if (min) return `dès ${min} ans`;
  if (max) return `jusqu’à ${max} ans`;
  return null;
}
