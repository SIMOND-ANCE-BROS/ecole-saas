/**
 * Moteur de tarif : types d'entrée et de sortie.
 * Tout ce qui est propre à une école (grille, réductions) arrive en entrée.
 * Montants en centimes, taux en points de base (1000 = 10 %).
 */

export type Public = "enfant" | "adulte" | "couple" | "etudiant";
export type Period = "trimestre" | "annee" | "unite";

/** Une case de la grille (table `tarif`). */
export type TariffRow = {
  id: string;
  audience: Public;
  period: Period;
  /** Durées des cours de la semaine, en minutes, dans n'importe quel ordre. */
  combination: readonly number[];
  /** Forfait réservé à une discipline ; null = toutes disciplines. */
  disciplineId: string | null;
  priceCents: number;
};

/** Une règle de réduction (table `reduction`). Seul le code « fratrie » est connu du moteur. */
export type DiscountRule = {
  code: string;
  /** Exactement l'un des deux : un taux, ou un montant fixe. */
  rateBps: number | null;
  amountCents: number | null;
  /** Nombre minimal de danseurs éligibles du même payeur. */
  minStudents: number;
  /** Publics éligibles ; vide = tous. */
  audiences: readonly Public[];
  /** false : écartée sur un forfait dont les cours relèvent d'au moins 2 disciplines. */
  combinableWithMultiDiscipline: boolean;
};

export type ChosenCourse = { disciplineId: string; durationMinutes: number };

/** Une inscription demandée par le payeur pour la saison. */
export type EnrollmentRequest = {
  /** Identifiant fourni par l'appelant, renvoyé tel quel dans le résultat. */
  reference: string;
  /** Un danseur, ou deux pour un couple. */
  studentIds: readonly string[];
  audience: Public;
  period: Period;
  courses: readonly ChosenCourse[];
};

/** Toutes les inscriptions d'un même payeur pour une saison, avec la grille de l'école. */
export type TariffRequest = {
  grid: readonly TariffRow[];
  discounts: readonly DiscountRule[];
  enrollments: readonly EnrollmentRequest[];
};

export type DiscountDetail = {
  code: string;
  status: "appliquee" | "ecartee";
  /** 0 si écartée. */
  amountCents: number;
  /** Explication pour l'accueil. */
  pattern: string;
};

export type TariffError = {
  code: "aucun_cours" | "combinaison_absente";
  message: string;
};

export type EnrollmentResult =
  | {
      reference: string;
      status: "ok";
      tariffRowId: string;
      /** Ex. « 45 min + 1 h 00 » */
      packageLabel: string;
      grossPriceCents: number;
      discounts: DiscountDetail[];
      discountCents: number;
      netPriceCents: number;
    }
  | { reference: string; status: "erreur"; error: TariffError };

// ---------------------------------------------------------------------------
// Carnets de cours particuliers
// ---------------------------------------------------------------------------

/** Une case de la grille des carnets (table `tarif_carnet`). */
export type LessonPackTariffRow = {
  id: string;
  lessonCount: number;
  /** La ligne vaut pour « jusqu'à N personnes » ; la tranche commence après la ligne inférieure. */
  maxPeople: number;
  priceCents: number;
};

export type LessonPackRequest = { lessonCount: number; peopleCount: number };

export type LessonPackResult =
  | {
      status: "ok";
      lessonPackTariffRowId: string;
      /** Ex. « Carnet de 5 cours · 1 à 2 personnes » */
      label: string;
      priceCents: number;
    }
  | { status: "erreur"; error: { code: "hors_grille"; message: string } };

export type TariffResult = {
  enrollments: EnrollmentResult[];
  /** Totaux des seules inscriptions tarifées. */
  grossTotalCents: number;
  totalDiscountCents: number;
  netTotalCents: number;
  /** false si au moins une inscription n'a pas pu être tarifée. */
  full: boolean;
};
