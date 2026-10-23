import { describe, expect, it } from "vitest";
import { formatEuros } from "../../lib/money";
import { computeTariff } from "./compute";
import { ribasSiblings, ribasGrid, ZUMBA } from "./fixtures/ribas-grid-2026";
import type { ChosenCourse, EnrollmentRequest, TariffRow, DiscountRule, EnrollmentResult } from "./types";

const CLASSICAL = "discipline-classique";
const JAZZ = "discipline-jazz";
const SALSA = "discipline-salsa";

let n = 0;
/** A student's enrollment; courses in minutes, classical discipline by default. */
function enrollment(
  partial: Partial<Omit<EnrollmentRequest, "courses">> & { course?: readonly (ChosenCourse | number)[] },
): EnrollmentRequest {
  n += 1;
  const courses = (partial.course ?? [60]).map((c) =>
    typeof c === "number" ? { disciplineId: CLASSICAL, durationMinutes: c } : c,
  );
  return {
    reference: `i${n}`,
    studentIds: [`d${n}`],
    audience: "enfant",
    period: "trimestre",
    ...partial,
    courses,
  };
}

function ribas(...enrollments: EnrollmentRequest[]) {
  return computeTariff({ grid: ribasGrid, discounts: [ribasSiblings], enrollments });
}

function ok(r: EnrollmentResult) {
  if (r.status !== "ok") throw new Error(`attendu ok, obtenu : ${r.error.message}`);
  return r;
}

const siblings = (r: EnrollmentResult) => ok(r).discounts.find((d) => d.code === "fratrie");

describe("choix du forfait (grille Ribas)", () => {
  it("tarife un enfant à 1 h 00 par semaine au trimestre", () => {
    const [r] = ribas(enrollment({ course: [60] })).enrollments;
    expect(ok(r)).toMatchObject({ grossPriceCents: 11000, packageLabel: "1 h 00", netPriceCents: 11000 });
  });

  it("ignore l’ordre de saisie des cours", () => {
    const [r] = ribas(enrollment({ course: [60, 45] })).enrollments;
    expect(ok(r)).toMatchObject({ grossPriceCents: 16500, packageLabel: "45 min + 1 h 00" });
  });

  it("distingue deux combinaisons de même durée totale (2 h 30)", () => {
    const [a, b] = ribas(enrollment({ course: [45, 45, 60] }), enrollment({ course: [60, 90] })).enrollments;
    expect(ok(a).grossPriceCents).toBe(19500);
    expect(ok(b).grossPriceCents).toBe(22000);
  });

  it("applique la périodicité annuelle", () => {
    const [r] = ribas(enrollment({ course: [90, 90], period: "annee" })).enrollments;
    expect(ok(r).grossPriceCents).toBe(64500);
  });

  it("tarife un adulte sur 3 cours", () => {
    const [r] = ribas(enrollment({ audience: "adulte", course: [60, 90, 60] })).enrollments;
    expect(ok(r)).toMatchObject({ grossPriceCents: 28500, packageLabel: "1 h 00 + 1 h 00 + 1 h 30" });
  });

  it("tarife un couple au prix du couple", () => {
    const [r] = ribas(
      enrollment({ audience: "couple", studentIds: ["a", "b"], period: "annee", course: [90] }),
    ).enrollments;
    expect(ok(r).grossPriceCents).toBe(75500);
  });

  it("tarife un étudiant", () => {
    const [r] = ribas(enrollment({ audience: "etudiant", period: "annee", course: [60] })).enrollments;
    expect(ok(r).grossPriceCents).toBe(29000);
  });

  it("tarife un cours à l’unité", () => {
    const [r] = ribas(enrollment({ audience: "adulte", period: "unite", course: [90] })).enrollments;
    expect(ok(r).grossPriceCents).toBe(2000);
  });
});

describe("forfait réservé à une discipline", () => {
  const zumba = (duration: number) => ({ disciplineId: ZUMBA, durationMinutes: duration });

  it("prend la ligne Zumba quand tous les cours sont de la Zumba", () => {
    const [r] = ribas(enrollment({ audience: "adulte", period: "annee", course: [zumba(60), zumba(60)] })).enrollments;
    expect(ok(r).grossPriceCents).toBe(43000);
  });

  it("prend la ligne générale quand les disciplines sont mélangées", () => {
    const [r] = ribas(
      enrollment({
        audience: "adulte",
        period: "annee",
        course: [zumba(60), { disciplineId: SALSA, durationMinutes: 60 }],
      }),
    ).enrollments;
    expect(ok(r).grossPriceCents).toBe(52000);
  });

  it("revient à la ligne générale si la discipline n’a pas de ligne pour cette périodicité", () => {
    const [r] = ribas(enrollment({ audience: "adulte", course: [zumba(60), zumba(60)] })).enrollments;
    expect(ok(r).grossPriceCents).toBe(20500);
  });
});

describe("inscriptions impossibles à tarifer", () => {
  it("signale une combinaison absente de la grille, sans bloquer les autres", () => {
    const result = ribas(enrollment({ course: [45, 45] }), enrollment({ course: [60] }));
    expect(result.enrollments[0]).toMatchObject({
      status: "erreur",
      error: { code: "combinaison_absente" },
    });
    const [error] = result.enrollments;
    if (error.status !== "erreur") throw new Error("attendu erreur");
    expect(error.error.message).toBe(
      "Aucun forfait « enfant » au trimestre pour 45 min + 45 min : prix à saisir par l’accueil.",
    );
    // Totals of the priced enrollments only; the child priced by hand counts for the other's siblings discount.
    expect(result).toMatchObject({
      full: false,
      grossTotalCents: 11000,
      totalDiscountCents: 1100,
      netTotalCents: 9900,
    });
  });

  it("signale un étudiant sur deux cours (absent de la grille)", () => {
    const [r] = ribas(enrollment({ audience: "etudiant", course: [60, 60] })).enrollments;
    expect(r).toMatchObject({ status: "erreur", error: { code: "combinaison_absente" } });
  });

  it("signale une inscription sans cours", () => {
    const [r] = ribas(enrollment({ course: [] })).enrollments;
    expect(r).toMatchObject({ status: "erreur", error: { code: "aucun_cours" } });
  });
});

describe("réduction fratrie (Ribas : -10 % dès 2 enfants, non cumulable avec 2 disciplines)", () => {
  it("applique -10 % à chacun de deux enfants", () => {
    const result = ribas(enrollment({ course: [60] }), enrollment({ course: [45] }));
    const [a, b] = result.enrollments;
    expect(siblings(a)).toEqual({
      code: "fratrie",
      status: "appliquee",
      amountCents: 1100,
      pattern: "2 enfants du même payeur : -10 %",
    });
    expect(ok(b)).toMatchObject({ discountCents: 850, netPriceCents: 7650 });
    expect(result).toMatchObject({
      full: true,
      grossTotalCents: 19500,
      totalDiscountCents: 1950,
      netTotalCents: 17550,
    });
  });

  it("l’écarte pour un enfant seul", () => {
    const [r] = ribas(enrollment({ course: [60] })).enrollments;
    expect(siblings(r)).toEqual({
      code: "fratrie",
      status: "ecartee",
      amountCents: 0,
      pattern: "1 enfant du même payeur, 2 requis",
    });
    expect(ok(r).netPriceCents).toBe(11000);
  });

  it("l’applique aux trois enfants d’une fratrie de trois", () => {
    const result = ribas(enrollment({}), enrollment({}), enrollment({}));
    expect(result.enrollments.map((r) => siblings(r)?.status)).toEqual(["appliquee", "appliquee", "appliquee"]);
    expect(siblings(result.enrollments[2])?.pattern).toBe("3 enfants du même payeur : -10 %");
    expect(result.netTotalCents).toBe(3 * 9900);
  });

  it("ne compte pas un adulte du même payeur, et l’écarte pour lui", () => {
    const [enfant, adulte] = ribas(enrollment({}), enrollment({ audience: "adulte" })).enrollments;
    expect(siblings(enfant)?.status).toBe("ecartee");
    expect(siblings(adulte)).toMatchObject({ status: "ecartee", pattern: "Réservée au public enfant" });
  });

  it("l’écarte pour un couple", () => {
    const [r] = ribas(enrollment({ audience: "couple", studentIds: ["a", "b"] })).enrollments;
    expect(siblings(r)?.status).toBe("ecartee");
  });

  it("l’écarte sur un forfait 2 disciplines, mais l’enfant compte pour ses frères et sœurs", () => {
    const [twoDisciplines, sibling] = ribas(
      enrollment({
        course: [
          { disciplineId: CLASSICAL, durationMinutes: 60 },
          { disciplineId: JAZZ, durationMinutes: 60 },
        ],
      }),
      enrollment({ course: [60] }),
    ).enrollments;
    expect(siblings(twoDisciplines)).toEqual({
      code: "fratrie",
      status: "ecartee",
      amountCents: 0,
      pattern: "Non cumulable avec un forfait 2 disciplines",
    });
    expect(ok(twoDisciplines).netPriceCents).toBe(18500);
    expect(siblings(sibling)?.status).toBe("appliquee");
  });

  it("l’applique à deux cours de la même discipline", () => {
    const [twoJazzCourses] = ribas(
      enrollment({
        course: [
          { disciplineId: JAZZ, durationMinutes: 60 },
          { disciplineId: JAZZ, durationMinutes: 60 },
        ],
      }),
      enrollment({}),
    ).enrollments;
    expect(siblings(twoJazzCourses)?.status).toBe("appliquee");
  });

  it("compte une seule fois un enfant inscrit deux fois", () => {
    const [t1, t2] = ribas(enrollment({ studentIds: ["x"] }), enrollment({ studentIds: ["x"] })).enrollments;
    expect(siblings(t1)?.status).toBe("ecartee");
    expect(siblings(t2)?.status).toBe("ecartee");
  });

  it("compte un enfant dont le forfait est à saisir à la main", () => {
    const [, sibling] = ribas(enrollment({ course: [45, 45] }), enrollment({})).enrollments;
    expect(siblings(sibling)?.status).toBe("appliquee");
  });
});

describe("rien n’est propre à une école", () => {
  const grid: TariffRow[] = [
    { id: "a", audience: "adulte", period: "annee", combination: [75], disciplineId: null, priceCents: 12345 },
    { id: "b", audience: "adulte", period: "unite", combination: [75], disciplineId: null, priceCents: 1500 },
  ];
  const rule = (partial: Partial<DiscountRule>): DiscountRule => ({
    code: "fratrie",
    rateBps: null,
    amountCents: null,
    minStudents: 1,
    audiences: [],
    combinableWithMultiDiscipline: true,
    ...partial,
  });
  const adulte = (period: "annee" | "unite" = "annee") => enrollment({ audience: "adulte", period, course: [75] });

  it("arrondit chaque réduction au centime, et le total est la somme des lignes", () => {
    const result = computeTariff({
      grid,
      discounts: [rule({ rateBps: 1000, minStudents: 2 })],
      enrollments: [adulte(), adulte()],
    });
    expect(result.enrollments.map((r) => ok(r).discountCents)).toEqual([1235, 1235]);
    expect(result).toMatchObject({ totalDiscountCents: 2470, netTotalCents: 2 * 12345 - 2470 });
    expect(siblings(result.enrollments[0])?.pattern).toBe("2 danseurs du même payeur : -10 %");
  });

  it("applique un montant fixe, plafonné au prix", () => {
    const [yearly, unite] = computeTariff({
      grid,
      discounts: [rule({ amountCents: 2000 })],
      enrollments: [adulte(), adulte("unite")],
    }).enrollments;
    expect(ok(yearly)).toMatchObject({ discountCents: 2000, netPriceCents: 10345 });
    expect(siblings(yearly)?.pattern).toBe(`2 danseurs du même payeur : -${formatEuros(2000)}`);
    expect(ok(unite)).toMatchObject({ discountCents: 1500, netPriceCents: 0 });
  });

  it("écarte un type de réduction inconnu du moteur", () => {
    const [r] = computeTariff({
      grid,
      discounts: [rule({ code: "parrainage", rateBps: 500 })],
      enrollments: [adulte()],
    }).enrollments;
    expect(ok(r).discounts).toEqual([
      {
        code: "parrainage",
        status: "ecartee",
        amountCents: 0,
        pattern: "Type de réduction non pris en charge par le moteur de tarif",
      },
    ]);
  });

  it("refuse une réduction qui n’a ni taux ni montant, ou les deux", () => {
    const calculation = (r: DiscountRule) => () => computeTariff({ grid, discounts: [r], enrollments: [adulte()] });
    expect(calculation(rule({}))).toThrow("Réduction « fratrie » : renseigner un taux ou un montant, pas les deux");
    expect(calculation(rule({ rateBps: 1000, amountCents: 500 }))).toThrow(TypeError);
  });
});
