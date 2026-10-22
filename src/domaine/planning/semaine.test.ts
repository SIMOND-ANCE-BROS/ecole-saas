import { describe, expect, it } from "vitest";
import { ajouterJours, dateValide, joursDeLaSemaine, jourSemaineDe, lundiDe } from "./semaine";

describe("semaines", () => {
  it("jour de la semaine et lundi, y compris au changement d'heure", () => {
    expect(jourSemaineDe("2026-10-19")).toBe(1);
    expect(jourSemaineDe("2026-10-25")).toBe(7); // passage à l'heure d'hiver
    expect(lundiDe("2026-10-25")).toBe("2026-10-19");
    expect(lundiDe("2026-10-19")).toBe("2026-10-19");
    expect(lundiDe("2027-01-01")).toBe("2026-12-28");
  });

  it("jours de la semaine et décalages", () => {
    expect(joursDeLaSemaine("2026-12-28")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    expect(ajouterJours("2026-10-19", -7)).toBe("2026-10-12");
  });

  it("date d'adresse valide", () => {
    expect(dateValide("2026-10-19")).toBe("2026-10-19");
    expect(dateValide("2026-02-30")).toBeNull();
    expect(dateValide("19/10/2026")).toBeNull();
    expect(dateValide(["2026-10-19"])).toBeNull();
  });
});
