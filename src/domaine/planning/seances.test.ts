import { describe, expect, it } from "vitest";
import { datesDesSeances } from "./seances";

describe("datesDesSeances", () => {
  it("donne chaque mercredi de la période, bornes comprises", () => {
    expect(datesDesSeances({ debut: "2026-09-02", fin: "2026-09-30", jourSemaine: 3, fermetures: [] })).toEqual([
      "2026-09-02",
      "2026-09-09",
      "2026-09-16",
      "2026-09-23",
      "2026-09-30",
    ]);
  });

  it("commence au premier jour voulu après le début", () => {
    expect(datesDesSeances({ debut: "2026-09-01", fin: "2026-09-14", jourSemaine: 1, fermetures: [] })).toEqual(["2026-09-07", "2026-09-14"]);
  });

  it("gère le dimanche (7)", () => {
    expect(datesDesSeances({ debut: "2026-09-01", fin: "2026-09-13", jourSemaine: 7, fermetures: [] })).toEqual(["2026-09-06", "2026-09-13"]);
  });

  it("saute les fermetures, bornes comprises", () => {
    const toussaint = { debut: "2026-10-17", fin: "2026-11-01" };
    const armistice = { debut: "2026-11-11", fin: "2026-11-11" };
    expect(
      datesDesSeances({ debut: "2026-10-14", fin: "2026-11-18", jourSemaine: 3, fermetures: [toussaint, armistice] }),
    ).toEqual(["2026-10-14", "2026-11-04", "2026-11-18"]);
  });

  it("passe le changement d’heure et d’année sans décalage", () => {
    expect(datesDesSeances({ debut: "2026-10-20", fin: "2026-11-03", jourSemaine: 2, fermetures: [] })).toEqual([
      "2026-10-20",
      "2026-10-27",
      "2026-11-03",
    ]);
    expect(datesDesSeances({ debut: "2026-12-28", fin: "2027-01-12", jourSemaine: 2, fermetures: [] })).toEqual([
      "2026-12-29",
      "2027-01-05",
      "2027-01-12",
    ]);
  });

  it("ne donne rien pour une période vide ou inversée", () => {
    expect(datesDesSeances({ debut: "2026-10-01", fin: "2026-09-01", jourSemaine: 3, fermetures: [] })).toEqual([]);
  });
});
