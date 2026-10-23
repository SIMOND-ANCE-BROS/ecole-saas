import { describe, expect, it } from "vitest";
import { lessonDates, courseDates } from "./lessons";

describe("datesDesSeances", () => {
  it("donne chaque mercredi de la période, bornes comprises", () => {
    expect(lessonDates({ start: "2026-09-02", end: "2026-09-30", weekday: 3, closures: [] })).toEqual([
      "2026-09-02",
      "2026-09-09",
      "2026-09-16",
      "2026-09-23",
      "2026-09-30",
    ]);
  });

  it("commence au premier jour voulu après le début", () => {
    expect(lessonDates({ start: "2026-09-01", end: "2026-09-14", weekday: 1, closures: [] })).toEqual([
      "2026-09-07",
      "2026-09-14",
    ]);
  });

  it("gère le dimanche (7)", () => {
    expect(lessonDates({ start: "2026-09-01", end: "2026-09-13", weekday: 7, closures: [] })).toEqual([
      "2026-09-06",
      "2026-09-13",
    ]);
  });

  it("saute les fermetures, bornes comprises", () => {
    const allSaints = { start: "2026-10-17", end: "2026-11-01" };
    const armistice = { start: "2026-11-11", end: "2026-11-11" };
    expect(
      lessonDates({ start: "2026-10-14", end: "2026-11-18", weekday: 3, closures: [allSaints, armistice] }),
    ).toEqual(["2026-10-14", "2026-11-04", "2026-11-18"]);
  });

  it("passe le changement d’heure et d’année sans décalage", () => {
    expect(lessonDates({ start: "2026-10-20", end: "2026-11-03", weekday: 2, closures: [] })).toEqual([
      "2026-10-20",
      "2026-10-27",
      "2026-11-03",
    ]);
    expect(lessonDates({ start: "2026-12-28", end: "2027-01-12", weekday: 2, closures: [] })).toEqual([
      "2026-12-29",
      "2027-01-05",
      "2027-01-12",
    ]);
  });

  it("ne donne rien pour une période vide ou inversée", () => {
    expect(lessonDates({ start: "2026-10-01", end: "2026-09-01", weekday: 3, closures: [] })).toEqual([]);
  });
});

describe("datesDuCours (#90)", () => {
  const SEASON = { start: "2026-09-01", end: "2026-10-31" };
  const ALL_SAINTS = [{ start: "2026-10-17", end: "2026-11-01" }];
  const weekly = (weekday: number, startDate: string | null = null, endDate: string | null = null) =>
    ({ type: "hebdomadaire", weekday: weekday, startDate: startDate, endDate: endDate }) as const;

  it("chaque semaine : comme avant, hors fermetures", () => {
    expect(courseDates(weekly(1), SEASON, ALL_SAINTS)).toEqual(
      lessonDates({ ...SEASON, weekday: 1, closures: ALL_SAINTS }),
    );
  });

  it("période limitée : seulement entre les deux dates, et dans la saison", () => {
    expect(courseDates(weekly(3, "2026-09-20", "2026-10-07"), SEASON, [])).toEqual([
      "2026-09-23",
      "2026-09-30",
      "2026-10-07",
    ]);
    expect(courseDates(weekly(3, "2026-08-01", null), SEASON, [])[0]).toBe("2026-09-02");
    expect(courseDates(weekly(3, "2026-10-10", "2026-10-01"), SEASON, [])).toEqual([]);
  });

  it("une semaine sur deux : alternance calée sur la première date, non décalée par une fermeture", () => {
    const quinzaine = { type: "quinzaine", weekday: 1, startDate: null, endDate: null } as const;
    // Lundis de la saison : 7, 14, 21, 28 sept., 5, 12, 19, 26 oct. ; une sur deux à partir du 7.
    expect(courseDates(quinzaine, SEASON, [])).toEqual(["2026-09-07", "2026-09-21", "2026-10-05", "2026-10-19"]);
    // Fermeture du 19 octobre : la séance saute, les autres gardent leur semaine.
    expect(courseDates(quinzaine, SEASON, ALL_SAINTS)).toEqual(["2026-09-07", "2026-09-21", "2026-10-05"]);
    expect(courseDates({ ...quinzaine, startDate: "2026-09-14" }, SEASON, [])).toEqual([
      "2026-09-14",
      "2026-09-28",
      "2026-10-12",
      "2026-10-26",
    ]);
  });

  it("dates précises : triées, sans doublon, dans la saison, même pendant une fermeture", () => {
    expect(
      courseDates(
        { type: "dates", dates: ["2026-10-24", "2026-09-12", "2026-10-24", "2027-01-05"] },
        SEASON,
        ALL_SAINTS,
      ),
    ).toEqual(["2026-09-12", "2026-10-24"]);
  });
});
