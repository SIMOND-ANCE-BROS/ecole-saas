/**
 * Données de TEST uniquement : grille de l'école Ribas, recopiée de sa plaquette
 * publique (https://www.ecolededanseribas.com/public/files/6a2ee0ca86921.pdf).
 * Ne jamais importer depuis le code applicatif : en production, la grille vient
 * de la table `tarif` de chaque école.
 */
import type { TariffRow, LessonPackTariffRow, Period, Public, DiscountRule } from "../types";

export const ZUMBA = "discipline-zumba";

let counter = 0;
function row(
  tariffAudience: Public,
  period: Period,
  combination: number[],
  euros: number,
  disciplineId: string | null = null,
): TariffRow {
  counter += 1;
  return {
    id: `ribas-${counter}`,
    audience: tariffAudience,
    period,
    combination,
    disciplineId,
    priceCents: euros * 100,
  };
}

const adultes: TariffRow[] = [
  // « 1 cours »
  row("adulte", "unite", [60], 15),
  row("adulte", "unite", [90], 20),
  // Trimestriel individuel
  row("adulte", "trimestre", [60], 120),
  row("adulte", "trimestre", [90], 165),
  row("adulte", "trimestre", [60, 60], 205),
  row("adulte", "trimestre", [60, 90], 240),
  row("adulte", "trimestre", [90, 90], 280),
  row("adulte", "trimestre", [60, 60, 90], 285),
  row("adulte", "trimestre", [60, 60, 60], 250),
  row("adulte", "trimestre", [60, 90, 90], 315),
  // Trimestriel couple
  row("couple", "trimestre", [60], 230),
  row("couple", "trimestre", [90], 295),
  row("couple", "trimestre", [60, 60], 390),
  row("couple", "trimestre", [60, 90], 445),
  row("couple", "trimestre", [90, 90], 500),
  // Trimestriel étudiant
  row("etudiant", "trimestre", [60], 115),
  row("etudiant", "trimestre", [90], 155),
  // Annuel individuel
  row("adulte", "annee", [60], 305),
  row("adulte", "annee", [90], 420),
  row("adulte", "annee", [60, 60], 520),
  row("adulte", "annee", [60, 90], 615),
  row("adulte", "annee", [90, 90], 715),
  // « Zumba 2h00 » : hypothèse, 2 cours de 1 h 00 de Zumba (question D de #11).
  row("adulte", "annee", [60, 60], 430, ZUMBA),
  row("adulte", "annee", [60, 60, 90], 720),
  row("adulte", "annee", [60, 60, 60], 640),
  row("adulte", "annee", [60, 90, 90], 800),
  // Annuel couple
  row("couple", "annee", [60], 550),
  row("couple", "annee", [90], 755),
  row("couple", "annee", [60, 60], 920),
  row("couple", "annee", [60, 90], 1100),
  row("couple", "annee", [90, 90], 1280),
  // Annuel étudiant
  row("etudiant", "annee", [60], 290),
  row("etudiant", "annee", [90], 400),
];

const children: TariffRow[] = (
  [
    [[45], 85, 210],
    [[60], 110, 280],
    [[90], 150, 380],
    [[45, 60], 165, 415],
    [[60, 60], 185, 475],
    [[60, 90], 220, 560],
    [[45, 90], 200, 500],
    [[90, 90], 255, 645],
    [[60, 60, 90], 260, 660],
    [[60, 60, 60], 230, 590],
    [[45, 45, 60], 195, 490],
  ] as const
).flatMap(([combination, trimestre, annee]) => [
  row("enfant", "trimestre", [...combination], trimestre),
  row("enfant", "annee", [...combination], annee),
]);

export const ribasGrid: TariffRow[] = [...adultes, ...children];

/**
 * Page 3, cours particuliers : « 1 OU 2 PERSONNES », « 3 PERSONNES », « 4 PERSONNES » ;
 * « 1h00 » = carnet d'une séance. Au-delà de 4 personnes : devis.
 */
export const ribasLessonPacksGrid: LessonPackTariffRow[] = (
  [
    [1, 50, 65, 80],
    [5, 240, 310, 380],
    [10, 450, 585, 720],
  ] as const
).flatMap(([lessonCount, two, three, four]) =>
  (
    [
      [2, two],
      [3, three],
      [4, four],
    ] as const
  ).map(([maxPeople, euros]) => ({
    id: `ribas-carnet-${lessonCount}-${maxPeople}`,
    lessonCount: lessonCount,
    maxPeople: maxPeople,
    priceCents: euros * 100,
  })),
);

/** « 2 enfants et plus (frères et sœurs) : -10 % — non cumulable avec un forfait 2 disciplines » */
export const ribasSiblings: DiscountRule = {
  code: "fratrie",
  rateBps: 1000,
  amountCents: null,
  minStudents: 2,
  audiences: ["enfant"],
  combinableWithMultiDiscipline: false,
};
