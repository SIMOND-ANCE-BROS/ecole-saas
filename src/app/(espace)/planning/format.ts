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

const jourMois = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const jourCourt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const date = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Date courte : « 26 oct. » (avec le jour : « lun. 26 oct. »). */
export const dateCourte = (iso: string, avecJour = false) => (avecJour ? jourCourt : jourMois).format(date(iso));

type AvecRecurrence = {
  recurrence: "hebdomadaire" | "quinzaine" | "dates";
  jourSemaine: number | null;
  dateDebut: string | null;
  dateFin: string | null;
  dates: string[];
};

/** « Chaque lundi », « Un lundi sur deux, du 1 nov. au 17 nov. », « Le sam. 24 oct., le dim. 25 oct. » (#90). */
export function recurrenceTexte(c: AvecRecurrence): string {
  if (c.recurrence === "dates") {
    if (c.dates.length === 0) return "Aucune date";
    return `Le ${c.dates.map((d) => dateCourte(d, true)).join(", le ")}`;
  }
  const jour = (JOURS[c.jourSemaine ?? 0] ?? "").toLowerCase();
  const base = c.recurrence === "quinzaine" ? `Un ${jour} sur deux` : `Chaque ${jour}`;
  if (c.dateDebut && c.dateFin) return `${base}, du ${dateCourte(c.dateDebut)} au ${dateCourte(c.dateFin)}`;
  if (c.dateDebut) return `${base}, à partir du ${dateCourte(c.dateDebut)}`;
  if (c.dateFin) return `${base}, jusqu’au ${dateCourte(c.dateFin)}`;
  return base;
}

/** Étiquette courte d'un bloc de l'agenda : rien pour un cours de chaque semaine, toute la saison. */
export function marqueRecurrence(c: AvecRecurrence): string | null {
  const parts = [c.recurrence === "quinzaine" ? "1 sem. sur 2" : null, c.dateDebut || c.dateFin ? `${c.dateDebut ? dateCourte(c.dateDebut) : "…"} → ${c.dateFin ? dateCourte(c.dateFin) : "…"}` : null];
  return parts.filter(Boolean).join(", ") || null;
}
