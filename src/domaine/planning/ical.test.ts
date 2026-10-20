import { describe, expect, it } from "vitest";
import { agendaIcs } from "./ical";

const base = {
  nom: "Cours de Camille, École de démonstration",
  genereLe: new Date("2026-10-20T08:00:00Z"),
  seances: [
    {
      id: "s1",
      date: "2026-11-04",
      heureDebut: "14:00",
      dureeMinutes: 45,
      titre: "Éveil",
      lieu: "Petite salle, Site Centre, 3 place de la Mairie",
      annulee: false,
    },
  ],
};

const lignes = (ics: string) => ics.split("\r\n");

describe("agendaIcs", () => {
  it("produit un calendrier RFC 5545 avec fins de ligne CRLF et le fuseau de Paris", () => {
    const ics = agendaIcs(base);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.includes("\n") && !ics.replace(/\r\n/g, "").includes("\n")).toBe(true);
    const l = lignes(ics);
    expect(l.slice(0, 4)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ecole-saas//agenda//FR", "CALSCALE:GREGORIAN"]);
    expect(l).toContain("BEGIN:VTIMEZONE");
    expect(l).toContain("TZID:Europe/Paris");
    expect(l).toContain("X-WR-CALNAME:Cours de Camille\\, École de démonstration");
  });

  it("décrit chaque séance : identifiant stable, horaires locaux, lieu échappé", () => {
    const l = lignes(agendaIcs(base));
    expect(l).toContain("UID:seance-s1@ecole-saas");
    expect(l).toContain("DTSTAMP:20261020T080000Z");
    expect(l).toContain("DTSTART;TZID=Europe/Paris:20261104T140000");
    expect(l).toContain("DTEND;TZID=Europe/Paris:20261104T144500");
    expect(l).toContain("SUMMARY:Éveil");
    expect(l).toContain("STATUS:CONFIRMED");
    expect(l.find((x) => x.startsWith("LOCATION:"))).toBe("LOCATION:Petite salle\\, Site Centre\\, 3 place de la Mairie");
  });

  it("marque une séance annulée, et passe minuit sans erreur", () => {
    const l = lignes(
      agendaIcs({ ...base, seances: [{ ...base.seances[0], heureDebut: "23:30", dureeMinutes: 90, annulee: true }] }),
    );
    expect(l).toContain("STATUS:CANCELLED");
    expect(l).toContain("DTEND;TZID=Europe/Paris:20261105T010000");
  });

  it("échappe les points-virgules, barres obliques inverses et retours à la ligne", () => {
    const l = lignes(agendaIcs({ ...base, seances: [{ ...base.seances[0], titre: "Jazz; niveau 2\\3\nadultes" }] }));
    expect(l).toContain("SUMMARY:Jazz\; niveau 2\\\\3\\nadultes");
  });

  it("replie les lignes au-delà de 75 octets sans couper un caractère accentué", () => {
    const titre = "é".repeat(60); // 120 octets en UTF-8
    const l = lignes(agendaIcs({ ...base, seances: [{ ...base.seances[0], titre }] }));
    const debut = l.findIndex((x) => x.startsWith("SUMMARY:"));
    const repliees = [l[debut], ...l.slice(debut + 1).filter((_, i, t) => t.slice(0, i + 1).every((x) => x.startsWith(" ")))];
    expect(repliees.length).toBeGreaterThan(1);
    expect(repliees.every((x) => new TextEncoder().encode(x).length <= 75)).toBe(true);
    expect(repliees.map((x, i) => (i === 0 ? x : x.slice(1))).join("")).toBe(`SUMMARY:${titre}`);
  });
});
