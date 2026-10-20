/**
 * Abonnement iCalendar (RFC 5545) aux séances d'un intervenant : lisible par
 * Google Agenda, Outlook et Apple Calendrier. Fonction pure ; l'heure de
 * génération est fournie par l'appelant.
 */

export type SeanceAgenda = {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM`, heure de Paris */
  heureDebut: string;
  dureeMinutes: number;
  titre: string;
  lieu: string;
  annulee: boolean;
};

const FUSEAU = "Europe/Paris";

/** Règles de l'heure d'été européenne (dernier dimanche de mars et d'octobre). */
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${FUSEAU}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

const echapper = (texte: string) => texte.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Replie une ligne en morceaux de 75 octets au plus, sans couper un caractère. */
function replier(ligne: string): string[] {
  const morceaux: string[] = [];
  let courant = "";
  let octets = 0;
  for (const caractere of ligne) {
    const taille = new TextEncoder().encode(caractere).length;
    const limite = morceaux.length === 0 ? 75 : 74; // l'espace de continuation compte
    if (octets + taille > limite) {
      morceaux.push(courant);
      courant = "";
      octets = 0;
    }
    courant += caractere;
    octets += taille;
  }
  morceaux.push(courant);
  return morceaux.map((m, i) => (i === 0 ? m : ` ${m}`));
}

/** Date et heure locales `YYYYMMDDTHHMMSS`, minutes ajoutées sans passer par un fuseau. */
function local(date: string, heure: string, minutesEnPlus = 0): string {
  const [a, m, j] = date.split("-").map(Number);
  const total = Number(heure.slice(0, 2)) * 60 + Number(heure.slice(3, 5)) + minutesEnPlus;
  const jour = new Date(Date.UTC(a, m - 1, j) + Math.floor(total / 1440) * 86_400_000);
  const deux = (n: number) => String(n).padStart(2, "0");
  const reste = total % 1440;
  return `${jour.getUTCFullYear()}${deux(jour.getUTCMonth() + 1)}${deux(jour.getUTCDate())}T${deux(Math.floor(reste / 60))}${deux(reste % 60)}00`;
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function agendaIcs({ nom, genereLe, seances }: { nom: string; genereLe: Date; seances: SeanceAgenda[] }): string {
  const lignes = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ecole-saas//agenda//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${echapper(nom)}`,
    `X-WR-TIMEZONE:${FUSEAU}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...VTIMEZONE,
    ...seances.flatMap((s) => [
      "BEGIN:VEVENT",
      `UID:seance-${s.id}@ecole-saas`,
      `DTSTAMP:${utc(genereLe)}`,
      `DTSTART;TZID=${FUSEAU}:${local(s.date, s.heureDebut)}`,
      `DTEND;TZID=${FUSEAU}:${local(s.date, s.heureDebut, s.dureeMinutes)}`,
      `SUMMARY:${echapper(s.titre)}`,
      `LOCATION:${echapper(s.lieu)}`,
      `STATUS:${s.annulee ? "CANCELLED" : "CONFIRMED"}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return `${lignes.flatMap(replier).join("\r\n")}\r\n`;
}
