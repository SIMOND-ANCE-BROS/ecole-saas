import { describe, expect, it } from "vitest";
import { icsCalendar } from "./ical";

const base = {
  name: "Cours de Camille, École de démonstration",
  generatedAt: new Date("2026-10-20T08:00:00Z"),
  lessons: [
    {
      id: "s1",
      date: "2026-11-04",
      startTime: "14:00",
      durationMinutes: 45,
      title: "Éveil",
      place: "Petite salle, Site Centre, 3 place de la Mairie",
      annulee: false,
    },
  ],
};

const rows = (ics: string) => ics.split("\r\n");

describe("agendaIcs", () => {
  it("produit un calendrier RFC 5545 avec fins de ligne CRLF et le fuseau de Paris", () => {
    const ics = icsCalendar(base);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.includes("\n") && !ics.replace(/\r\n/g, "").includes("\n")).toBe(true);
    const l = rows(ics);
    expect(l.slice(0, 4)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//ecole-saas//agenda//FR",
      "CALSCALE:GREGORIAN",
    ]);
    expect(l).toContain("BEGIN:VTIMEZONE");
    expect(l).toContain("TZID:Europe/Paris");
    expect(l).toContain("X-WR-CALNAME:Cours de Camille\\, École de démonstration");
  });

  it("décrit chaque séance : identifiant stable, horaires locaux, lieu échappé", () => {
    const l = rows(icsCalendar(base));
    expect(l).toContain("UID:seance-s1@ecole-saas");
    expect(l).toContain("DTSTAMP:20261020T080000Z");
    expect(l).toContain("DTSTART;TZID=Europe/Paris:20261104T140000");
    expect(l).toContain("DTEND;TZID=Europe/Paris:20261104T144500");
    expect(l).toContain("SUMMARY:Éveil");
    expect(l).toContain("STATUS:CONFIRMED");
    expect(l.find((x) => x.startsWith("LOCATION:"))).toBe(
      "LOCATION:Petite salle\\, Site Centre\\, 3 place de la Mairie",
    );
  });

  it("marque une séance annulée, et passe minuit sans erreur", () => {
    const l = rows(
      icsCalendar({
        ...base,
        lessons: [{ ...base.lessons[0], startTime: "23:30", durationMinutes: 90, annulee: true }],
      }),
    );
    expect(l).toContain("STATUS:CANCELLED");
    expect(l).toContain("DTEND;TZID=Europe/Paris:20261105T010000");
  });

  it("échappe les points-virgules, barres obliques inverses et retours à la ligne", () => {
    const l = rows(icsCalendar({ ...base, lessons: [{ ...base.lessons[0], title: "Jazz; niveau 2\\3\nadultes" }] }));
    expect(l).toContain("SUMMARY:Jazz\; niveau 2\\\\3\\nadultes");
  });

  it("replie les lignes au-delà de 75 octets sans couper un caractère accentué", () => {
    const title = "é".repeat(60); // 120 bytes in UTF-8
    const l = rows(icsCalendar({ ...base, lessons: [{ ...base.lessons[0], title }] }));
    const start = l.findIndex((x) => x.startsWith("SUMMARY:"));
    const collapsed = [
      l[start],
      ...l.slice(start + 1).filter((_, i, t) => t.slice(0, i + 1).every((x) => x.startsWith(" "))),
    ];
    expect(collapsed.length).toBeGreaterThan(1);
    expect(collapsed.every((x) => new TextEncoder().encode(x).length <= 75)).toBe(true);
    expect(collapsed.map((x, i) => (i === 0 ? x : x.slice(1))).join("")).toBe(`SUMMARY:${title}`);
  });
});
