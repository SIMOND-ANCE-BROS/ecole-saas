/** Mise en forme des créneaux, commune au planning et au détail d'un cours. */

export const DAYS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/** Heure de fin `HH:MM` d'un créneau. */
export function end(heure: string, duration: number): string {
  const [h, m] = heure.split(":").map(Number);
  const total = h * 60 + m + duration;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function ages(min: number | null, max: number | null): string | null {
  if (min && max) return `${min} à ${max} ans`;
  if (min) return `dès ${min} ans`;
  if (max) return `jusqu’à ${max} ans`;
  return null;
}

const monthDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const date = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Date courte : « 26 oct. » (avec le jour : « lun. 26 oct. »). */
export const shortDate = (iso: string, withDay = false) => (withDay ? shortDay : monthDay).format(date(iso));

type WithRecurrence = {
  recurrence: "hebdomadaire" | "quinzaine" | "dates";
  weekday: number | null;
  startDate: string | null;
  endDate: string | null;
  dates: string[];
};

/** « Chaque lundi », « Un lundi sur deux, du 1 nov. au 17 nov. », « Le sam. 24 oct., le dim. 25 oct. » (#90). */
export function recurrenceText(c: WithRecurrence): string {
  if (c.recurrence === "dates") {
    if (c.dates.length === 0) return "Aucune date";
    return `Le ${c.dates.map((d) => shortDate(d, true)).join(", le ")}`;
  }
  const day = (DAYS[c.weekday ?? 0] ?? "").toLowerCase();
  const base = c.recurrence === "quinzaine" ? `Un ${day} sur deux` : `Chaque ${day}`;
  if (c.startDate && c.endDate) return `${base}, du ${shortDate(c.startDate)} au ${shortDate(c.endDate)}`;
  if (c.startDate) return `${base}, à partir du ${shortDate(c.startDate)}`;
  if (c.endDate) return `${base}, jusqu’au ${shortDate(c.endDate)}`;
  return base;
}

/** Étiquette courte d'un bloc de l'agenda : rien pour un cours de chaque semaine, toute la saison. */
export function recurrenceBadge(c: WithRecurrence): string | null {
  const parts = [
    c.recurrence === "quinzaine" ? "1 sem. sur 2" : null,
    c.startDate || c.endDate
      ? `${c.startDate ? shortDate(c.startDate) : "…"} → ${c.endDate ? shortDate(c.endDate) : "…"}`
      : null,
  ];
  return parts.filter(Boolean).join(", ") || null;
}
