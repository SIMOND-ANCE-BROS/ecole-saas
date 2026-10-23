import { describe, expect, it } from "vitest";
import { cadreAgenda, type Horaire, horsHoraires, plagesOuvertes } from "./horaires";

const ROLLET: Horaire[] = [1, 2, 3, 4, 5]
  .map((j) => ({ jourSemaine: j, ouverture: "16:30", fermeture: "22:00" }))
  .concat({ jourSemaine: 6, ouverture: "09:00", fermeture: "13:00" });
const AMIS: Horaire[] = [{ jourSemaine: 3, ouverture: "10:00", fermeture: "18:00" }];
const cours = (jourSemaine: number | null, heureDebut: string, dureeMinutes = 60) => ({
  id: `${jourSemaine}-${heureDebut}`,
  jourSemaine,
  heureDebut,
  dureeMinutes,
});

describe("cadreAgenda", () => {
  it("sans horaires : du lundi au samedi, plage d'après les cours (comportement d'avant)", () => {
    expect(cadreAgenda([], [cours(7, "10:00")])).toEqual({ jours: [1, 2, 3, 4, 5, 6, 7], debut: 9 * 60, fin: 21 * 60 });
  });

  it("jours ouverts des sites et plage de la première ouverture à la dernière fermeture", () => {
    expect(cadreAgenda([...ROLLET, ...AMIS], [])).toEqual({ jours: [1, 2, 3, 4, 5, 6], debut: 9 * 60, fin: 22 * 60 });
  });

  it("élargi à un cours existant hors horaires (jour ou heure), arrondi à l'heure", () => {
    expect(cadreAgenda(AMIS, [cours(7, "08:15", 30), cours(3, "18:00", 75)])).toEqual({
      jours: [3, 7],
      debut: 8 * 60,
      fin: 20 * 60,
    });
  });
});

describe("plagesOuvertes", () => {
  it("fusionne les plages de plusieurs sites qui se chevauchent", () => {
    expect(plagesOuvertes([...ROLLET, ...AMIS], 3)).toEqual([{ debut: 600, fin: 1320 }]);
    expect(plagesOuvertes(ROLLET, 7)).toEqual([]);
  });
});

describe("horsHoraires", () => {
  it("rien à dire dans les horaires, ou sans horaires", () => {
    expect(horsHoraires({ jourSemaine: 1, heureDebut: "17:00", dureeMinutes: 60 }, ROLLET)).toBeNull();
    expect(horsHoraires({ jourSemaine: 7, heureDebut: "03:00", dureeMinutes: 60 }, [])).toBeNull();
  });

  it("jour fermé, ou créneau qui dépasse", () => {
    expect(horsHoraires({ jourSemaine: 7, heureDebut: "10:00", dureeMinutes: 60 }, ROLLET)).toBe(
      "Le site est fermé le dimanche.",
    );
    expect(horsHoraires({ jourSemaine: 1, heureDebut: "21:30", dureeMinutes: 60 }, ROLLET)).toBe(
      "En dehors des horaires du site le lundi (16:30–22:00).",
    );
    expect(horsHoraires({ jourSemaine: 6, heureDebut: "08:45", dureeMinutes: 60 }, ROLLET)).toBe(
      "En dehors des horaires du site le samedi (09:00–13:00).",
    );
  });
});
