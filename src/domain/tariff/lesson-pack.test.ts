import { describe, expect, it } from "vitest";
import { priceLessonPack } from "./lesson-pack";
import { ribasLessonPacksGrid } from "./fixtures/ribas-grid-2026";
import type { LessonPackTariffRow, LessonPackResult } from "./types";

function ok(r: LessonPackResult) {
  if (r.status !== "ok") throw new Error(`attendu ok, obtenu : ${r.error.message}`);
  return r;
}

describe("private lesson packs (Ribas grid)", () => {
  it("prices a single lesson for one person, in the « 1 à 2 personnes » bracket", () => {
    expect(ok(priceLessonPack(ribasLessonPacksGrid, { lessonCount: 1, peopleCount: 1 }))).toEqual({
      status: "ok",
      lessonPackTariffRowId: "ribas-carnet-1-2",
      label: "1 cours · 1 à 2 personnes",
      priceCents: 5000,
    });
  });

  it("applies the same price to two people", () => {
    expect(ok(priceLessonPack(ribasLessonPacksGrid, { lessonCount: 1, peopleCount: 2 })).priceCents).toBe(5000);
  });

  it("prices a 5-lesson pack for 3 people", () => {
    expect(ok(priceLessonPack(ribasLessonPacksGrid, { lessonCount: 5, peopleCount: 3 }))).toMatchObject({
      label: "5 cours · 3 personnes",
      priceCents: 31000,
    });
  });

  it("prices a 10-lesson pack for 4 people", () => {
    expect(ok(priceLessonPack(ribasLessonPacksGrid, { lessonCount: 10, peopleCount: 4 })).priceCents).toBe(72000);
  });

  it("refers to a quote beyond the last bracket", () => {
    expect(priceLessonPack(ribasLessonPacksGrid, { lessonCount: 10, peopleCount: 5 })).toEqual({
      status: "erreur",
      error: {
        code: "hors_grille",
        message: "Aucun tarif pour 10 cours à 5 personnes : prix sur devis, à saisir par l’accueil.",
      },
    });
  });

  it("reports a number of lessons missing from the grid", () => {
    expect(priceLessonPack(ribasLessonPacksGrid, { lessonCount: 7, peopleCount: 1 })).toMatchObject({
      status: "erreur",
      error: { code: "hors_grille" },
    });
  });
});

describe("lesson packs: nothing is specific to one school", () => {
  const grid: LessonPackTariffRow[] = [
    { id: "c", lessonCount: 8, maxPeople: 6, priceCents: 90000 },
    { id: "a", lessonCount: 8, maxPeople: 1, priceCents: 40000 },
    { id: "b", lessonCount: 8, maxPeople: 3, priceCents: 60000 },
  ];

  it("picks the smallest bracket covering the number of people, whatever the grid order", () => {
    expect(ok(priceLessonPack(grid, { lessonCount: 8, peopleCount: 2 }))).toMatchObject({
      lessonPackTariffRowId: "b",
      label: "8 cours · 2 à 3 personnes",
    });
    expect(ok(priceLessonPack(grid, { lessonCount: 8, peopleCount: 1 })).label).toBe("8 cours · 1 personne");
    expect(ok(priceLessonPack(grid, { lessonCount: 8, peopleCount: 5 })).label).toBe("8 cours · 4 à 6 personnes");
  });

  it("reports an empty grid", () => {
    expect(priceLessonPack([], { lessonCount: 1, peopleCount: 1 }).status).toBe("erreur");
  });

  it("rejects an invalid number of lessons or people", () => {
    expect(() => priceLessonPack(grid, { lessonCount: 8, peopleCount: 0 })).toThrow(TypeError);
    expect(() => priceLessonPack(grid, { lessonCount: 2.5, peopleCount: 1 })).toThrow(TypeError);
  });
});
