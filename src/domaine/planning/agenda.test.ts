import { describe, expect, it } from "vitest";
import { aimanter, bornesJournee, disposer, versHeure, versMinutes } from "./agenda";

const c = (id: string, jourSemaine: number | null, heureDebut: string, dureeMinutes: number) => ({ id, jourSemaine, heureDebut, dureeMinutes });

describe("heures", () => {
  it("convertit HH:MM en minutes et l’inverse", () => {
    expect(versMinutes("17:45")).toBe(1065);
    expect(versHeure(1065)).toBe("17:45");
    expect(versHeure(9 * 60)).toBe("09:00");
  });

  it("aimante au quart d’heure le plus proche", () => {
    expect(aimanter(1067)).toBe(1065);
    expect(aimanter(1073)).toBe(1080);
    expect(aimanter(1067, 30)).toBe(1080);
  });
});

describe("bornesJournee", () => {
  it("couvre tous les cours, à l’heure pleine, avec une plage par défaut", () => {
    expect(bornesJournee([])).toEqual({ debut: 9 * 60, fin: 21 * 60 });
    expect(bornesJournee([c("a", 1, "07:30", 60), c("b", 3, "21:15", 90)])).toEqual({ debut: 7 * 60, fin: 23 * 60 });
  });
});

describe("disposer", () => {
  it("met côte à côte les cours simultanés d’un même jour, et seuls ceux-là", () => {
    const cours = [
      c("jazz", 3, "17:00", 60),
      c("zumba", 3, "17:30", 60),
      c("salsa", 3, "18:15", 60), // chevauche zumba seulement
      c("eveil", 3, "14:00", 45), // seul
      c("lundi", 1, "17:00", 60), // autre jour
    ];
    const d = disposer(cours);
    expect(d.get("eveil")).toEqual({ colonne: 0, colonnes: 1 });
    expect(d.get("lundi")).toEqual({ colonne: 0, colonnes: 1 });
    expect(d.get("jazz")).toEqual({ colonne: 0, colonnes: 2 });
    expect(d.get("zumba")).toEqual({ colonne: 1, colonnes: 2 });
    // salsa reprend la colonne libérée par jazz, dans le même groupe à deux colonnes.
    expect(d.get("salsa")).toEqual({ colonne: 0, colonnes: 2 });
  });

  it("ignore les stages (sans jour)", () => {
    expect(disposer([c("stage", null, "10:00", 60)]).size).toBe(0);
  });
});
