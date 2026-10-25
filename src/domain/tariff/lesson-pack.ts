import type { LessonPackRequest, LessonPackTariffRow, LessonPackResult } from "./types";

/**
 * Price of a private lesson pack from the school's tariff grid.
 * A row applies "up to N people": the smallest bracket covering the number
 * of people is chosen. Outside the grid (unknown number of lessons, group
 * too large): error, price on quote entered by the front desk.
 */
export function priceLessonPack(grid: readonly LessonPackTariffRow[], request: LessonPackRequest): LessonPackResult {
  const { lessonCount: lessonCount, peopleCount: peopleCount } = request;
  for (const [name, value] of Object.entries(request)) {
    if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} invalide : ${value}`);
  }

  const bands = grid.filter((l) => l.lessonCount === lessonCount).sort((a, b) => a.maxPeople - b.maxPeople);
  const index = bands.findIndex((l) => l.maxPeople >= peopleCount);
  if (index === -1) {
    return {
      status: "error",
      error: {
        code: "off_grid",
        message: `Aucun tarif pour ${lessonCount} cours à ${people(peopleCount)} : prix sur devis, à saisir par l’accueil.`,
      },
    };
  }

  const row = bands[index];
  const minimum = index === 0 ? 1 : bands[index - 1].maxPeople + 1;
  const band = minimum === row.maxPeople ? people(minimum) : `${minimum} à ${people(row.maxPeople)}`;
  return {
    status: "ok",
    lessonPackTariffRowId: row.id,
    label: `${lessonCount} cours · ${band}`,
    priceCents: row.priceCents,
  };
}

function people(n: number): string {
  return n > 1 ? `${n} personnes` : `${n} personne`;
}
