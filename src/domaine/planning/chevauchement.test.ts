import { describe, expect, it } from "vitest";
import { conflits, seChevauchent } from "./chevauchement";

const creneau = (jourSemaine: number | null, heureDebut: string, dureeMinutes: number) => ({ jourSemaine, heureDebut, dureeMinutes });

describe("seChevauchent", () => {
  it("détecte deux créneaux qui se recouvrent le même jour", () => {
    expect(seChevauchent(creneau(3, "17:00", 60), creneau(3, "17:30", 60))).toBe(true);
  });
  it("accepte deux créneaux qui se suivent", () => {
    expect(seChevauchent(creneau(3, "17:00", 60), creneau(3, "18:00", 60))).toBe(false);
  });
  it("ignore un autre jour et les stages", () => {
    expect(seChevauchent(creneau(3, "17:00", 60), creneau(4, "17:00", 60))).toBe(false);
    expect(seChevauchent(creneau(null, "17:00", 60), creneau(null, "17:00", 60))).toBe(false);
  });
});

describe("conflits", () => {
  const existants = [
    { id: "a", ...creneau(3, "17:00", 60), salleId: "studio", intervenantId: "camille" },
    { id: "b", ...creneau(3, "17:30", 60), salleId: "grande", intervenantId: "ines" },
    { id: "c", ...creneau(3, "17:15", 30), salleId: "studio", intervenantId: "ines" },
  ];

  it("signale la salle et l’intervenant déjà pris, sans le cours lui-même", () => {
    const cible = { id: "c", ...creneau(3, "17:15", 30), salleId: "studio", intervenantId: "ines" };
    expect(conflits(cible, existants)).toEqual([
      { id: "a", salle: true, intervenant: false },
      { id: "b", salle: false, intervenant: true },
    ]);
  });

  it("ne signale rien sans recouvrement", () => {
    expect(conflits({ id: null, ...creneau(1, "17:00", 60), salleId: "studio", intervenantId: "camille" }, existants)).toEqual([]);
  });
});
