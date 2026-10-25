/**
 * iCalendar subscription (RFC 5545) to an instructor's lessons: readable by
 * Google Calendar, Outlook and Apple Calendar. Pure function; the generation
 * time is supplied by the caller.
 */

export type CalendarLesson = {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM`, Paris time */
  startTime: string;
  durationMinutes: number;
  title: string;
  place: string;
  cancelled: boolean;
};

const TIME_ZONE = "Europe/Paris";

/** European summer time rules (last Sunday of March and of October). */
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${TIME_ZONE}`,
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

const escape = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds a line into chunks of at most 75 bytes, without splitting a character. */
function collapse(row: string): string[] {
  const chunks: string[] = [];
  let current = "";
  let octets = 0;
  for (const character of row) {
    const size = new TextEncoder().encode(character).length;
    const limit = chunks.length === 0 ? 75 : 74; // the continuation space counts
    if (octets + size > limit) {
      chunks.push(current);
      current = "";
      octets = 0;
    }
    current += character;
    octets += size;
  }
  chunks.push(current);
  return chunks.map((m, i) => (i === 0 ? m : ` ${m}`));
}

/** Local date and time `YYYYMMDDTHHMMSS`, minutes added without going through a time zone. */
function local(date: string, time: string, extraMinutes = 0): string {
  const [a, m, j] = date.split("-").map(Number);
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + extraMinutes;
  const day = new Date(Date.UTC(a, m - 1, j) + Math.floor(total / 1440) * 86_400_000);
  const two = (n: number) => String(n).padStart(2, "0");
  const remaining = total % 1440;
  return `${day.getUTCFullYear()}${two(day.getUTCMonth() + 1)}${two(day.getUTCDate())}T${two(Math.floor(remaining / 60))}${two(remaining % 60)}00`;
}

const utc = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

export function icsCalendar({
  name: name,
  generatedAt: generatedAt,
  lessons: lessons,
}: {
  name: string;
  generatedAt: Date;
  lessons: CalendarLesson[];
}): string {
  const rows = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ecole-saas//agenda//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(name)}`,
    `X-WR-TIMEZONE:${TIME_ZONE}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...VTIMEZONE,
    ...lessons.flatMap((s) => [
      "BEGIN:VEVENT",
      `UID:seance-${s.id}@ecole-saas`,
      `DTSTAMP:${utc(generatedAt)}`,
      `DTSTART;TZID=${TIME_ZONE}:${local(s.date, s.startTime)}`,
      `DTEND;TZID=${TIME_ZONE}:${local(s.date, s.startTime, s.durationMinutes)}`,
      `SUMMARY:${escape(s.title)}`,
      `LOCATION:${escape(s.place)}`,
      `STATUS:${s.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return `${rows.flatMap(collapse).join("\r\n")}\r\n`;
}
