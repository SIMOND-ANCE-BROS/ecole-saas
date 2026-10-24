/**
 * Tariff engine: input and output types.
 * Everything specific to a school (tariff grid, discounts) comes as input.
 * Amounts in cents, rates in basis points (1000 = 10 %).
 */

export type Public = "child" | "adult" | "couple" | "student";
export type Period = "quarter" | "year" | "single";

/** One cell of the tariff grid (table `tariff`). */
export type TariffRow = {
  id: string;
  audience: Public;
  period: Period;
  /** Durations of the week's courses, in minutes, in any order. */
  combination: readonly number[];
  /** Package reserved for one discipline; null = all disciplines. */
  disciplineId: string | null;
  priceCents: number;
};

/** A discount rule (table `discount`). Only the code "fratrie" is known to the engine. */
export type DiscountRule = {
  code: string;
  /** Exactly one of the two: a rate, or a fixed amount. */
  rateBps: number | null;
  amountCents: number | null;
  /** Minimum number of eligible students of the same payer. */
  minStudents: number;
  /** Eligible audiences; empty = all. */
  audiences: readonly Public[];
  /** false: rejected on a package whose courses belong to at least 2 disciplines. */
  combinableWithMultiDiscipline: boolean;
};

export type ChosenCourse = { disciplineId: string; durationMinutes: number };

/** An enrollment requested by the payer for the season. */
export type EnrollmentRequest = {
  /** Id supplied by the caller, returned as is in the result. */
  reference: string;
  /** One student, or two for a couple. */
  studentIds: readonly string[];
  audience: Public;
  period: Period;
  courses: readonly ChosenCourse[];
};

/** All enrollments of the same payer for a season, with the school's tariff grid. */
export type TariffRequest = {
  grid: readonly TariffRow[];
  discounts: readonly DiscountRule[];
  enrollments: readonly EnrollmentRequest[];
};

export type DiscountDetail = {
  code: string;
  status: "appliquee" | "ecartee";
  /** 0 if rejected. */
  amountCents: number;
  /** Explanation for the front desk. */
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
      /** E.g. « 45 min + 1 h 00 » */
      packageLabel: string;
      grossPriceCents: number;
      discounts: DiscountDetail[];
      discountCents: number;
      netPriceCents: number;
    }
  | { reference: string; status: "erreur"; error: TariffError };

// ---------------------------------------------------------------------------
// Private lesson packs
// ---------------------------------------------------------------------------

/** One cell of the lesson pack grid (table `lesson_pack_tariff`). */
export type LessonPackTariffRow = {
  id: string;
  lessonCount: number;
  /** The row applies "up to N people"; the bracket starts after the row below. */
  maxPeople: number;
  priceCents: number;
};

export type LessonPackRequest = { lessonCount: number; peopleCount: number };

export type LessonPackResult =
  | {
      status: "ok";
      lessonPackTariffRowId: string;
      /** E.g. « Carnet de 5 cours · 1 à 2 personnes » */
      label: string;
      priceCents: number;
    }
  | { status: "erreur"; error: { code: "hors_grille"; message: string } };

export type TariffResult = {
  enrollments: EnrollmentResult[];
  /** Totals of the priced enrollments only. */
  grossTotalCents: number;
  totalDiscountCents: number;
  netTotalCents: number;
  /** false if at least one enrollment could not be priced. */
  full: boolean;
};
