import { describe, expect, it } from "vitest";
import { conflicts, overlaps } from "./chevauchement";

const slot = (weekday: number | null, startTime: string, durationMinutes: number) => ({
  weekday: weekday,
  startTime: startTime,
  durationMinutes: durationMinutes,
});

describe("seChevauchent", () => {
  it("détecte deux créneaux qui se recouvrent le même jour", () => {
    expect(overlaps(slot(3, "17:00", 60), slot(3, "17:30", 60))).toBe(true);
  });
  it("accepte deux créneaux qui se suivent", () => {
    expect(overlaps(slot(3, "17:00", 60), slot(3, "18:00", 60))).toBe(false);
  });
  it("ignore un autre jour et les stages", () => {
    expect(overlaps(slot(3, "17:00", 60), slot(4, "17:00", 60))).toBe(false);
    expect(overlaps(slot(null, "17:00", 60), slot(null, "17:00", 60))).toBe(false);
  });
});

describe("conflits", () => {
  const existing = [
    { id: "a", ...slot(3, "17:00", 60), roomId: "studio", instructorId: "camille" },
    { id: "b", ...slot(3, "17:30", 60), roomId: "grande", instructorId: "ines" },
    { id: "c", ...slot(3, "17:15", 30), roomId: "studio", instructorId: "ines" },
  ];

  it("signale la salle et l’intervenant déjà pris, sans le cours lui-même", () => {
    const target = { id: "c", ...slot(3, "17:15", 30), roomId: "studio", instructorId: "ines" };
    expect(conflicts(target, existing)).toEqual([
      { id: "a", room: true, instructor: false },
      { id: "b", room: false, instructor: true },
    ]);
  });

  it("ne signale rien sans recouvrement", () => {
    expect(
      conflicts({ id: null, ...slot(1, "17:00", 60), roomId: "studio", instructorId: "camille" }, existing),
    ).toEqual([]);
  });
});
