import { describe, expect, it } from "vitest";
import { snap, dayBounds, arrange, toTime, toMinutes } from "./calendar";

const c = (id: string, weekday: number | null, startTime: string, durationMinutes: number) => ({
  id,
  weekday: weekday,
  startTime: startTime,
  durationMinutes: durationMinutes,
});

describe("heures", () => {
  it("convertit HH:MM en minutes et l’inverse", () => {
    expect(toMinutes("17:45")).toBe(1065);
    expect(toTime(1065)).toBe("17:45");
    expect(toTime(9 * 60)).toBe("09:00");
  });

  it("aimante au quart d’heure le plus proche", () => {
    expect(snap(1067)).toBe(1065);
    expect(snap(1073)).toBe(1080);
    expect(snap(1067, 30)).toBe(1080);
  });
});

describe("bornesJournee", () => {
  it("couvre tous les cours, à l’heure pleine, avec une plage par défaut", () => {
    expect(dayBounds([])).toEqual({ start: 9 * 60, end: 21 * 60 });
    expect(dayBounds([c("a", 1, "07:30", 60), c("b", 3, "21:15", 90)])).toEqual({ start: 7 * 60, end: 23 * 60 });
  });
});

describe("disposer", () => {
  it("met côte à côte les cours simultanés d’un même jour, et seuls ceux-là", () => {
    const courses = [
      c("jazz", 3, "17:00", 60),
      c("zumba", 3, "17:30", 60),
      c("salsa", 3, "18:15", 60), // overlaps zumba only
      c("eveil", 3, "14:00", 45), // alone
      c("lundi", 1, "17:00", 60), // another day
    ];
    const d = arrange(courses);
    expect(d.get("eveil")).toEqual({ column: 0, columns: 1 });
    expect(d.get("lundi")).toEqual({ column: 0, columns: 1 });
    expect(d.get("jazz")).toEqual({ column: 0, columns: 2 });
    expect(d.get("zumba")).toEqual({ column: 1, columns: 2 });
    // salsa takes the column freed by jazz, in the same two-column group.
    expect(d.get("salsa")).toEqual({ column: 0, columns: 2 });
  });

  it("ignore les stages (sans jour)", () => {
    expect(arrange([c("stage", null, "10:00", 60)]).size).toBe(0);
  });
});
