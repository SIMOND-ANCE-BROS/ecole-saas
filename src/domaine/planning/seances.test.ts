import { describe, expect, it } from "vitest";
import { datesDesSeances, datesDuCours } from "./seances";

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

describe("datesDuCours (#90)", () => {
  const SAISON = { debut: "2026-09-01", fin: "2026-10-31" };
  const TOUSSAINT = [{ debut: "2026-10-17", fin: "2026-11-01" }];
  const hebdo = (jourSemaine: number, dateDebut: string | null = null, dateFin: string | null = null) =>
    ({ type: "hebdomadaire", jourSemaine, dateDebut, dateFin }) as const;

  it("chaque semaine : comme avant, hors fermetures", () => {
    expect(datesDuCours(hebdo(1), SAISON, TOUSSAINT)).toEqual(datesDesSeances({ ...SAISON, jourSemaine: 1, fermetures: TOUSSAINT }));
  });

  it("période limitée : seulement entre les deux dates, et dans la saison", () => {
    expect(datesDuCours(hebdo(3, "2026-09-20", "2026-10-07"), SAISON, [])).toEqual(["2026-09-23", "2026-09-30", "2026-10-07"]);
    expect(datesDuCours(hebdo(3, "2026-08-01", null), SAISON, [])[0]).toBe("2026-09-02");
    expect(datesDuCours(hebdo(3, "2026-10-10", "2026-10-01"), SAISON, [])).toEqual([]);
  });

  it("une semaine sur deux : alternance calée sur la première date, non décalée par une fermeture", () => {
    const quinzaine = { type: "quinzaine", jourSemaine: 1, dateDebut: null, dateFin: null } as const;
    // Lundis de la saison : 7, 14, 21, 28 sept., 5, 12, 19, 26 oct. ; une sur deux à partir du 7.
    expect(datesDuCours(quinzaine, SAISON, [])).toEqual(["2026-09-07", "2026-09-21", "2026-10-05", "2026-10-19"]);
    // Fermeture du 19 octobre : la séance saute, les autres gardent leur semaine.
    expect(datesDuCours(quinzaine, SAISON, TOUSSAINT)).toEqual(["2026-09-07", "2026-09-21", "2026-10-05"]);
    expect(datesDuCours({ ...quinzaine, dateDebut: "2026-09-14" }, SAISON, [])).toEqual(["2026-09-14", "2026-09-28", "2026-10-12", "2026-10-26"]);
  });

  it("dates précises : triées, sans doublon, dans la saison, même pendant une fermeture", () => {
    expect(datesDuCours({ type: "dates", dates: ["2026-10-24", "2026-09-12", "2026-10-24", "2027-01-05"] }, SAISON, TOUSSAINT)).toEqual([
      "2026-09-12",
      "2026-10-24",
    ]);
  });
});
