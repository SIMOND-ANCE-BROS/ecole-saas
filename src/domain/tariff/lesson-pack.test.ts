import { describe, expect, it } from "vitest";
import { priceLessonPack } from "./lesson-pack";
import { ribasLessonPacksGrid } from "./fixtures/ribas-grid-2026";
import type { LessonPackTariffRow, LessonPackResult } from "./types";

function ok(r: LessonPackResult) {
  if (r.status !== "ok") throw new Error(`attendu ok, obtenu : ${r.error.message}`);
  return r;
}

describe("carnets de cours particuliers (grille Ribas)", () => {
  it("tarife un cours seul pour une personne, dans la tranche « 1 à 2 personnes »", () => {
    expect(ok(priceLessonPack(ribasLessonPacksGrid, { lessonCount: 1, peopleCount: 1 }))).toEqual({
      status: "ok",
      lessonPackTariffRowId: "ribas-carnet-1-2",
      label: "1 cours · 1 à 2 personnes",
      priceCents: 5000,
    });
  });

  it("applique le même prix à deux personnes", () => {
    expect(ok(priceLessonPack(ribasLessonPacksGrid, { lessonCount: 1, peopleCount: 2 })).priceCents).toBe(5000);
  });

  it("tarife un carnet de 5 cours à 3 personnes", () => {
    expect(ok(priceLessonPack(ribasLessonPacksGrid, { lessonCount: 5, peopleCount: 3 }))).toMatchObject({
      label: "5 cours · 3 personnes",
      priceCents: 31000,
    });
  });

  it("tarife un carnet de 10 cours à 4 personnes", () => {
    expect(ok(priceLessonPack(ribasLessonPacksGrid, { lessonCount: 10, peopleCount: 4 })).priceCents).toBe(72000);
  });

  it("renvoie au devis au-delà de la dernière tranche", () => {
    expect(priceLessonPack(ribasLessonPacksGrid, { lessonCount: 10, peopleCount: 5 })).toEqual({
      status: "erreur",
      error: {
        code: "hors_grille",
        message: "Aucun tarif pour 10 cours à 5 personnes : prix sur devis, à saisir par l’accueil.",
      },
    });
  });

  it("signale un nombre de séances absent de la grille", () => {
    expect(priceLessonPack(ribasLessonPacksGrid, { lessonCount: 7, peopleCount: 1 })).toMatchObject({
      status: "erreur",
      error: { code: "hors_grille" },
    });
  });
});

describe("carnets : rien n’est propre à une école", () => {
  const grid: LessonPackTariffRow[] = [
    { id: "c", lessonCount: 8, maxPeople: 6, priceCents: 90000 },
    { id: "a", lessonCount: 8, maxPeople: 1, priceCents: 40000 },
    { id: "b", lessonCount: 8, maxPeople: 3, priceCents: 60000 },
  ];

  it("choisit la plus petite tranche qui couvre le nombre de personnes, quel que soit l’ordre de la grille", () => {
    expect(ok(priceLessonPack(grid, { lessonCount: 8, peopleCount: 2 }))).toMatchObject({
      lessonPackTariffRowId: "b",
      label: "8 cours · 2 à 3 personnes",
    });
    expect(ok(priceLessonPack(grid, { lessonCount: 8, peopleCount: 1 })).label).toBe("8 cours · 1 personne");
    expect(ok(priceLessonPack(grid, { lessonCount: 8, peopleCount: 5 })).label).toBe("8 cours · 4 à 6 personnes");
  });

  it("signale une grille vide", () => {
    expect(priceLessonPack([], { lessonCount: 1, peopleCount: 1 }).status).toBe("erreur");
  });

  it("refuse un nombre de séances ou de personnes invalide", () => {
    expect(() => priceLessonPack(grid, { lessonCount: 8, peopleCount: 0 })).toThrow(TypeError);
    expect(() => priceLessonPack(grid, { lessonCount: 2.5, peopleCount: 1 })).toThrow(TypeError);
  });
});
