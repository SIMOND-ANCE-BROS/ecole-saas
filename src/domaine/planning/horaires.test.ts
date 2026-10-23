import { describe, expect, it } from "vitest";
import { calendarFrame, type Hours, outsideHours, openRanges } from "./horaires";

const ROLLET: Hours[] = [1, 2, 3, 4, 5]
  .map((j) => ({ weekday: j, opening: "16:30", closure: "22:00" }))
  .concat({ weekday: 6, opening: "09:00", closure: "13:00" });
const AMIS: Hours[] = [{ weekday: 3, opening: "10:00", closure: "18:00" }];
const course = (weekday: number | null, startTime: string, durationMinutes = 60) => ({
  id: `${weekday}-${startTime}`,
  weekday: weekday,
  startTime: startTime,
  durationMinutes: durationMinutes,
});

describe("cadreAgenda", () => {
  it("sans horaires : du lundi au samedi, plage d'après les cours (comportement d'avant)", () => {
    expect(calendarFrame([], [course(7, "10:00")])).toEqual({
      days: [1, 2, 3, 4, 5, 6, 7],
      start: 9 * 60,
      end: 21 * 60,
    });
  });

  it("jours ouverts des sites et plage de la première ouverture à la dernière fermeture", () => {
    expect(calendarFrame([...ROLLET, ...AMIS], [])).toEqual({ days: [1, 2, 3, 4, 5, 6], start: 9 * 60, end: 22 * 60 });
  });

  it("élargi à un cours existant hors horaires (jour ou heure), arrondi à l'heure", () => {
    expect(calendarFrame(AMIS, [course(7, "08:15", 30), course(3, "18:00", 75)])).toEqual({
      days: [3, 7],
      start: 8 * 60,
      end: 20 * 60,
    });
  });
});

describe("plagesOuvertes", () => {
  it("fusionne les plages de plusieurs sites qui se chevauchent", () => {
    expect(openRanges([...ROLLET, ...AMIS], 3)).toEqual([{ start: 600, end: 1320 }]);
    expect(openRanges(ROLLET, 7)).toEqual([]);
  });
});

describe("horsHoraires", () => {
  it("rien à dire dans les horaires, ou sans horaires", () => {
    expect(outsideHours({ weekday: 1, startTime: "17:00", durationMinutes: 60 }, ROLLET)).toBeNull();
    expect(outsideHours({ weekday: 7, startTime: "03:00", durationMinutes: 60 }, [])).toBeNull();
  });

  it("jour fermé, ou créneau qui dépasse", () => {
    expect(outsideHours({ weekday: 7, startTime: "10:00", durationMinutes: 60 }, ROLLET)).toBe(
      "Le site est fermé le dimanche.",
    );
    expect(outsideHours({ weekday: 1, startTime: "21:30", durationMinutes: 60 }, ROLLET)).toBe(
      "En dehors des horaires du site le lundi (16:30–22:00).",
    );
    expect(outsideHours({ weekday: 6, startTime: "08:45", durationMinutes: 60 }, ROLLET)).toBe(
      "En dehors des horaires du site le samedi (09:00–13:00).",
    );
  });
});
