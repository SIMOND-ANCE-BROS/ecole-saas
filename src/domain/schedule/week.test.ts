import { describe, expect, it } from "vitest";
import { addDays, validDate, weekDays, weekdayOf, mondayOf } from "./week";

describe("semaines", () => {
  it("jour de la semaine et lundi, y compris au changement d'heure", () => {
    expect(weekdayOf("2026-10-19")).toBe(1);
    expect(weekdayOf("2026-10-25")).toBe(7); // passage à l'heure d'hiver
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });

  it("jours de la semaine et décalages", () => {
    expect(weekDays("2026-12-28")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    expect(addDays("2026-10-19", -7)).toBe("2026-10-12");
  });

  it("date d'adresse valide", () => {
    expect(validDate("2026-10-19")).toBe("2026-10-19");
    expect(validDate("2026-02-30")).toBeNull();
    expect(validDate("19/10/2026")).toBeNull();
    expect(validDate(["2026-10-19"])).toBeNull();
  });
});
