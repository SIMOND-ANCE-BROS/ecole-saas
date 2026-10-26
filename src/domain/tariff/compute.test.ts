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
    audience: "child",
    period: "quarter",
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

describe("package selection (Ribas grid)", () => {
  it("prices a child at 1 h 00 per week, quarterly", () => {
    const [r] = ribas(enrollment({ course: [60] })).enrollments;
    expect(ok(r)).toMatchObject({ grossPriceCents: 11000, packageLabel: "1 h 00", netPriceCents: 11000 });
  });

  it("ignores the order in which courses are entered", () => {
    const [r] = ribas(enrollment({ course: [60, 45] })).enrollments;
    expect(ok(r)).toMatchObject({ grossPriceCents: 16500, packageLabel: "45 min + 1 h 00" });
  });

  it("tells apart two combinations with the same total duration (2 h 30)", () => {
    const [a, b] = ribas(enrollment({ course: [45, 45, 60] }), enrollment({ course: [60, 90] })).enrollments;
    expect(ok(a).grossPriceCents).toBe(19500);
    expect(ok(b).grossPriceCents).toBe(22000);
  });

  it("applies the yearly periodicity", () => {
    const [r] = ribas(enrollment({ course: [90, 90], period: "year" })).enrollments;
    expect(ok(r).grossPriceCents).toBe(64500);
  });

  it("prices an adult on 3 courses", () => {
    const [r] = ribas(enrollment({ audience: "adult", course: [60, 90, 60] })).enrollments;
    expect(ok(r)).toMatchObject({ grossPriceCents: 28500, packageLabel: "1 h 00 + 1 h 00 + 1 h 30" });
  });

  it("prices a couple at the couple rate", () => {
    const [r] = ribas(
      enrollment({ audience: "couple", studentIds: ["a", "b"], period: "year", course: [90] }),
    ).enrollments;
    expect(ok(r).grossPriceCents).toBe(75500);
  });

  it("prices the student (university) rate", () => {
    const [r] = ribas(enrollment({ audience: "student", period: "year", course: [60] })).enrollments;
    expect(ok(r).grossPriceCents).toBe(29000);
  });

  it("prices a drop-in lesson", () => {
    const [r] = ribas(enrollment({ audience: "adult", period: "single", course: [90] })).enrollments;
    expect(ok(r).grossPriceCents).toBe(2000);
  });
});

describe("package restricted to one discipline", () => {
  const zumba = (duration: number) => ({ disciplineId: ZUMBA, durationMinutes: duration });

  it("uses the Zumba row when every course is Zumba", () => {
    const [r] = ribas(enrollment({ audience: "adult", period: "year", course: [zumba(60), zumba(60)] })).enrollments;
    expect(ok(r).grossPriceCents).toBe(43000);
  });

  it("uses the general row when disciplines are mixed", () => {
    const [r] = ribas(
      enrollment({
        audience: "adult",
        period: "year",
        course: [zumba(60), { disciplineId: SALSA, durationMinutes: 60 }],
      }),
    ).enrollments;
    expect(ok(r).grossPriceCents).toBe(52000);
  });

  it("falls back to the general row when the discipline has no row for this periodicity", () => {
    const [r] = ribas(enrollment({ audience: "adult", course: [zumba(60), zumba(60)] })).enrollments;
    expect(ok(r).grossPriceCents).toBe(20500);
  });
});

describe("enrollments that cannot be priced", () => {
  it("reports a combination missing from the grid, without blocking the others", () => {
    const result = ribas(enrollment({ course: [45, 45] }), enrollment({ course: [60] }));
    expect(result.enrollments[0]).toMatchObject({
      status: "error",
      error: { code: "missing_combination" },
    });
    const [error] = result.enrollments;
    if (error.status !== "error") throw new Error("expected error");
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

  it("reports a student-rate enrollment on two courses (missing from the grid)", () => {
    const [r] = ribas(enrollment({ audience: "student", course: [60, 60] })).enrollments;
    expect(r).toMatchObject({ status: "error", error: { code: "missing_combination" } });
  });

  it("reports an enrollment without courses", () => {
    const [r] = ribas(enrollment({ course: [] })).enrollments;
    expect(r).toMatchObject({ status: "error", error: { code: "no_courses" } });
  });
});

describe("siblings discount (Ribas: -10 % from 2 children, not combinable with 2 disciplines)", () => {
  it("applies -10 % to each of two children", () => {
    const result = ribas(enrollment({ course: [60] }), enrollment({ course: [45] }));
    const [a, b] = result.enrollments;
    expect(siblings(a)).toEqual({
      code: "fratrie",
      status: "applied",
      amountCents: 1100,
      reason: "2 enfants du même payeur : −10 %",
    });
    expect(ok(b)).toMatchObject({ discountCents: 850, netPriceCents: 7650 });
    expect(result).toMatchObject({
      full: true,
      grossTotalCents: 19500,
      totalDiscountCents: 1950,
      netTotalCents: 17550,
    });
  });

  it("leaves it out for a single child", () => {
    const [r] = ribas(enrollment({ course: [60] })).enrollments;
    expect(siblings(r)).toEqual({
      code: "fratrie",
      status: "rejected",
      amountCents: 0,
      reason: "1 enfant du même payeur, 2 requis",
    });
    expect(ok(r).netPriceCents).toBe(11000);
  });

  it("applies it to all three children of three siblings", () => {
    const result = ribas(enrollment({}), enrollment({}), enrollment({}));
    expect(result.enrollments.map((r) => siblings(r)?.status)).toEqual(["applied", "applied", "applied"]);
    expect(siblings(result.enrollments[2])?.reason).toBe("3 enfants du même payeur : −10 %");
    expect(result.netTotalCents).toBe(3 * 9900);
  });

  it("does not count an adult of the same payer, and leaves it out for them", () => {
    const [child, adult] = ribas(enrollment({}), enrollment({ audience: "adult" })).enrollments;
    expect(siblings(child)?.status).toBe("rejected");
    expect(siblings(adult)).toMatchObject({ status: "rejected", reason: "Réservée au public enfant" });
  });

  it("leaves it out for a couple", () => {
    const [r] = ribas(enrollment({ audience: "couple", studentIds: ["a", "b"] })).enrollments;
    expect(siblings(r)?.status).toBe("rejected");
  });

  it("leaves it out on a 2-discipline package, but the child counts for their siblings", () => {
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
      status: "rejected",
      amountCents: 0,
      reason: "Non cumulable avec un forfait 2 disciplines",
    });
    expect(ok(twoDisciplines).netPriceCents).toBe(18500);
    expect(siblings(sibling)?.status).toBe("applied");
  });

  it("applies it to two courses of the same discipline", () => {
    const [twoJazzCourses] = ribas(
      enrollment({
        course: [
          { disciplineId: JAZZ, durationMinutes: 60 },
          { disciplineId: JAZZ, durationMinutes: 60 },
        ],
      }),
      enrollment({}),
    ).enrollments;
    expect(siblings(twoJazzCourses)?.status).toBe("applied");
  });

  it("counts a child enrolled twice only once", () => {
    const [t1, t2] = ribas(enrollment({ studentIds: ["x"] }), enrollment({ studentIds: ["x"] })).enrollments;
    expect(siblings(t1)?.status).toBe("rejected");
    expect(siblings(t2)?.status).toBe("rejected");
  });

  it("counts a child whose package is entered by hand", () => {
    const [, sibling] = ribas(enrollment({ course: [45, 45] }), enrollment({})).enrollments;
    expect(siblings(sibling)?.status).toBe("applied");
  });
});

describe("nothing is specific to one school", () => {
  const grid: TariffRow[] = [
    { id: "a", audience: "adult", period: "year", combination: [75], disciplineId: null, priceCents: 12345 },
    { id: "b", audience: "adult", period: "single", combination: [75], disciplineId: null, priceCents: 1500 },
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
  const adult = (period: "year" | "single" = "year") => enrollment({ audience: "adult", period, course: [75] });

  it("rounds each discount to the cent, and the total is the sum of the lines", () => {
    const result = computeTariff({
      grid,
      discounts: [rule({ rateBps: 1000, minStudents: 2 })],
      enrollments: [adult(), adult()],
    });
    expect(result.enrollments.map((r) => ok(r).discountCents)).toEqual([1235, 1235]);
    expect(result).toMatchObject({ totalDiscountCents: 2470, netTotalCents: 2 * 12345 - 2470 });
    expect(siblings(result.enrollments[0])?.reason).toBe("2 danseurs du même payeur : −10 %");
  });

  it("applies a fixed amount, capped at the price", () => {
    const [yearly, single] = computeTariff({
      grid,
      discounts: [rule({ amountCents: 2000 })],
      enrollments: [adult(), adult("single")],
    }).enrollments;
    expect(ok(yearly)).toMatchObject({ discountCents: 2000, netPriceCents: 10345 });
    expect(siblings(yearly)?.reason).toBe(`2 danseurs du même payeur : −${formatEuros(2000)}`);
    expect(ok(single)).toMatchObject({ discountCents: 1500, netPriceCents: 0 });
  });

  it("leaves out a discount type unknown to the engine", () => {
    const [r] = computeTariff({
      grid,
      discounts: [rule({ code: "parrainage", rateBps: 500 })],
      enrollments: [adult()],
    }).enrollments;
    expect(ok(r).discounts).toEqual([
      {
        code: "parrainage",
        status: "rejected",
        amountCents: 0,
        reason: "Type de réduction non pris en charge par le moteur de tarif",
      },
    ]);
  });

  it("rejects a discount with neither rate nor amount, or both", () => {
    const calculation = (r: DiscountRule) => () => computeTariff({ grid, discounts: [r], enrollments: [adult()] });
    expect(calculation(rule({}))).toThrow("Réduction « fratrie » : renseigner un taux ou un montant, pas les deux");
    expect(calculation(rule({ rateBps: 1000, amountCents: 500 }))).toThrow(TypeError);
  });
});
