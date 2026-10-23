/**
 * Données de TEST uniquement : grille de l'école Ribas, recopiée de sa plaquette
 * publique (https://www.ecolededanseribas.com/public/files/6a2ee0ca86921.pdf).
 * Ne jamais importer depuis le code applicatif : en production, la grille vient
 * de la table `tarif` de chaque école.
 */
import type { LigneTarif, LigneTarifCarnet, Periodicite, Public, RegleReduction } from "../types";

export const ZUMBA = "discipline-zumba";

let compteur = 0;
function ligne(
  publicTarif: Public,
  periodicite: Periodicite,
  combinaison: number[],
  euros: number,
  disciplineId: string | null = null,
): LigneTarif {
  compteur += 1;
  return {
    id: `ribas-${compteur}`,
    public: publicTarif,
    periodicite,
    combinaison,
    disciplineId,
    prixCentimes: euros * 100,
  };
}

const adultes: LigneTarif[] = [
  // « 1 cours »
  ligne("adulte", "unite", [60], 15),
  ligne("adulte", "unite", [90], 20),
  // Trimestriel individuel
  ligne("adulte", "trimestre", [60], 120),
  ligne("adulte", "trimestre", [90], 165),
  ligne("adulte", "trimestre", [60, 60], 205),
  ligne("adulte", "trimestre", [60, 90], 240),
  ligne("adulte", "trimestre", [90, 90], 280),
  ligne("adulte", "trimestre", [60, 60, 90], 285),
  ligne("adulte", "trimestre", [60, 60, 60], 250),
  ligne("adulte", "trimestre", [60, 90, 90], 315),
  // Trimestriel couple
  ligne("couple", "trimestre", [60], 230),
  ligne("couple", "trimestre", [90], 295),
  ligne("couple", "trimestre", [60, 60], 390),
  ligne("couple", "trimestre", [60, 90], 445),
  ligne("couple", "trimestre", [90, 90], 500),
  // Trimestriel étudiant
  ligne("etudiant", "trimestre", [60], 115),
  ligne("etudiant", "trimestre", [90], 155),
  // Annuel individuel
  ligne("adulte", "annee", [60], 305),
  ligne("adulte", "annee", [90], 420),
  ligne("adulte", "annee", [60, 60], 520),
  ligne("adulte", "annee", [60, 90], 615),
  ligne("adulte", "annee", [90, 90], 715),
  // « Zumba 2h00 » : hypothèse, 2 cours de 1 h 00 de Zumba (question D de #11).
  ligne("adulte", "annee", [60, 60], 430, ZUMBA),
  ligne("adulte", "annee", [60, 60, 90], 720),
  ligne("adulte", "annee", [60, 60, 60], 640),
  ligne("adulte", "annee", [60, 90, 90], 800),
  // Annuel couple
  ligne("couple", "annee", [60], 550),
  ligne("couple", "annee", [90], 755),
  ligne("couple", "annee", [60, 60], 920),
  ligne("couple", "annee", [60, 90], 1100),
  ligne("couple", "annee", [90, 90], 1280),
  // Annuel étudiant
  ligne("etudiant", "annee", [60], 290),
  ligne("etudiant", "annee", [90], 400),
];

const enfants: LigneTarif[] = (
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
).flatMap(([combinaison, trimestre, annee]) => [
  ligne("enfant", "trimestre", [...combinaison], trimestre),
  ligne("enfant", "annee", [...combinaison], annee),
]);

export const grilleRibas: LigneTarif[] = [...adultes, ...enfants];

/**
 * Page 3, cours particuliers : « 1 OU 2 PERSONNES », « 3 PERSONNES », « 4 PERSONNES » ;
 * « 1h00 » = carnet d'une séance. Au-delà de 4 personnes : devis.
 */
export const grilleCarnetsRibas: LigneTarifCarnet[] = (
  [
    [1, 50, 65, 80],
    [5, 240, 310, 380],
    [10, 450, 585, 720],
  ] as const
).flatMap(([nbSeances, deux, trois, quatre]) =>
  (
    [
      [2, deux],
      [3, trois],
      [4, quatre],
    ] as const
  ).map(([personnesMax, euros]) => ({
    id: `ribas-carnet-${nbSeances}-${personnesMax}`,
    nbSeances,
    personnesMax,
    prixCentimes: euros * 100,
  })),
);

/** « 2 enfants et plus (frères et sœurs) : -10 % — non cumulable avec un forfait 2 disciplines » */
export const fratrieRibas: RegleReduction = {
  code: "fratrie",
  tauxPointsBase: 1000,
  montantCentimes: null,
  seuilDanseurs: 2,
  publics: ["enfant"],
  cumulableMultiDisciplines: false,
};
