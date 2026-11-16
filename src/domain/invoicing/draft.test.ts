import { describe, expect, it } from "vitest";
import type { VatTreatment } from "../billing/vat";
import type { SeasonQuarter } from "../enrollment/quarters";
import type { TariffRow } from "../tariff/types";
import {
  DISCOUNT_LABEL,
  draftInvoices,
  enrollmentLabel,
  packLineLabel,
  splitEnrollment,
  splitWeights,
  standalonePrice,
  type BillableEnrollment,
  type BillablePack,
  type DraftEntity,
  type DraftPlans,
  type InvoiceDraft,
} from "./draft";

const EXEMPT: VatTreatment = { id: "exempt", category: "exempt", mention: "Zz exonération" };
const VAT20: VatTreatment = { id: "vat20", category: "standard", rateBps: 2000 };
const TREATMENTS = [EXEMPT, VAT20];
const A: DraftEntity = { id: "A", name: "Zz Danse A", vatRegime: "vat_registered" };
const B: DraftEntity = { id: "B", name: "Zz Danse B", vatRegime: "not_applicable" };

const QUARTERS: SeasonQuarter[] = [
  { id: "q1", label: "1er trimestre", startDate: "2027-10-01", endDate: "2027-12-31" },
  { id: "q2", label: "2e trimestre", startDate: "2028-01-01", endDate: "2028-03-31" },
  { id: "q3", label: "3e trimestre", startDate: "2028-04-01", endDate: "2028-06-30" },
];

const course = (
  id: string,
  vatTreatmentId = "exempt",
  durationMinutes = 60,
  standalonePriceCents: number | null = null,
) => ({
  courseId: id,
  vatTreatmentId,
  durationMinutes,
  standalonePriceCents,
  label: `Zz ${id}`,
});

/** A yearly enrollment of entity A at 400,00 € with no discount, enrolled on 2027-09-10. */
const enrollment = (over: Partial<BillableEnrollment> = {}): BillableEnrollment => ({
  id: "e1",
  billingEntityId: "A",
  status: "active",
  period: "year",
  label: "Forfait 1 h 00 — Zz Alice",
  enrolledOn: "2027-09-10",
  grossPriceCents: 40000,
  discountCents: 0,
  discountCodes: [],
  manualPriceCents: null,
  courses: [course("c1")],
  quarters: [],
  ...over,
});

const pack = (over: Partial<BillablePack> = {}): BillablePack => ({
  id: "p1",
  billingEntityId: "A",
  vatTreatmentId: "exempt",
  label: "Carnet 5 séances · 1 personne",
  priceCents: 20000,
  purchasedOn: "2027-09-20",
  ...over,
});

const draft = (enrollments: BillableEnrollment[], packs: BillablePack[] = [], entities = [A, B]) => {
  const r = draftInvoices({ enrollments, packs, entities, treatments: TREATMENTS });
  if (!r.ok) throw new Error(r.message);
  return r.drafts;
};
const sumLines = (d: InvoiceDraft) => d.lines.reduce((s, l) => s + l.inclTaxCents, 0);
const sumInstallments = (d: InvoiceDraft) => d.installments.reduce((s, i) => s + i.amountCents, 0);

describe("splitEnrollment", () => {
  it("a package mixing exempt and 20 % courses: two package lines and two « Remise » lines adding up to the net price", () => {
    const lines = splitEnrollment({
      grossPriceCents: 41500,
      discounts: [{ code: "fratrie", amountCents: 4150 }],
      courses: [
        { courseId: "c1", vatTreatmentId: "exempt", weight: 25000 },
        { courseId: "c2", vatTreatmentId: "vat20", weight: 20000 },
      ],
      label: "Forfait 45 min + 1 h 00",
    });
    expect(lines.map((l) => [l.vatTreatmentId, l.kind, l.inclTaxCents])).toEqual([
      ["exempt", "package", 23056],
      ["exempt", "discount", -2306],
      ["vat20", "package", 18444],
      ["vat20", "discount", -1844],
    ]);
    expect(lines.reduce((s, l) => s + l.inclTaxCents, 0)).toBe(41500 - 4150);
    expect(lines.filter((l) => l.kind === "discount").every((l) => l.label.startsWith(DISCOUNT_LABEL))).toBe(true);
  });

  it("leftover cents of a split go to the largest remainders and the sum stays exact", () => {
    const lines = splitEnrollment({
      grossPriceCents: 10000,
      discounts: [{ code: "fratrie", amountCents: 1001 }],
      courses: [
        { courseId: "c1", vatTreatmentId: "t1", weight: 1 },
        { courseId: "c2", vatTreatmentId: "t2", weight: 1 },
        { courseId: "c3", vatTreatmentId: "t3", weight: 1 },
      ],
    });
    expect(lines.filter((l) => l.kind === "package").map((l) => l.inclTaxCents)).toEqual([3334, 3333, 3333]);
    expect(lines.filter((l) => l.kind === "discount").map((l) => l.inclTaxCents)).toEqual([-334, -334, -333]);
    expect(lines.reduce((s, l) => s + l.inclTaxCents, 0)).toBe(10000 - 1001);
  });

  it("courses of the same treatment make one group; one treatment gives one package line and one per discount", () => {
    const lines = splitEnrollment({
      grossPriceCents: 30000,
      discounts: [{ code: "fratrie", amountCents: 3000 }],
      courses: [
        { courseId: "c1", vatTreatmentId: "exempt", weight: 45, label: "Jazz" },
        { courseId: "c2", vatTreatmentId: "exempt", weight: 60, label: "Classique" },
      ],
      label: "Forfait 45 min + 1 h 00",
    });
    expect(lines).toEqual([
      { vatTreatmentId: "exempt", kind: "package", label: "Forfait 45 min + 1 h 00", inclTaxCents: 30000 },
      { vatTreatmentId: "exempt", kind: "discount", label: "Remise", inclTaxCents: -3000 },
    ]);
  });

  it("with several treatments each line names the courses it covers", () => {
    const lines = splitEnrollment({
      grossPriceCents: 30000,
      discounts: [{ code: "fratrie", amountCents: 3000 }],
      courses: [
        { courseId: "c1", vatTreatmentId: "exempt", weight: 1, label: "Jazz" },
        { courseId: "c2", vatTreatmentId: "vat20", weight: 1, label: "Pilates" },
      ],
      label: "Forfait",
    });
    expect(lines.map((l) => l.label)).toEqual([
      "Forfait — Jazz",
      "Remise — Jazz",
      "Forfait — Pilates",
      "Remise — Pilates",
    ]);
  });

  it("a discount of 0 gives no line; no course is refused", () => {
    const one = [{ courseId: "c1", vatTreatmentId: "exempt", weight: 1 }];
    expect(
      splitEnrollment({ grossPriceCents: 100, discounts: [{ code: "x", amountCents: 0 }], courses: one }),
    ).toHaveLength(1);
    expect(() => splitEnrollment({ grossPriceCents: 100, discounts: [], courses: [] })).toThrow(RangeError);
  });
});

describe("splitWeights (Q1 default)", () => {
  it("standalone grid prices when every course has one", () => {
    expect(splitWeights([course("a", "x", 45, 25000), course("b", "x", 60, 30000)])).toEqual([25000, 30000]);
  });

  it("weekly minutes as soon as one course has no single-course package", () => {
    expect(splitWeights([course("a", "x", 45, 25000), course("b", "x", 60, null)])).toEqual([45, 60]);
  });
});

describe("standalonePrice", () => {
  const row = (id: string, combination: number[], over: Partial<TariffRow> = {}): TariffRow => ({
    id,
    audience: "child",
    period: "year",
    combination,
    disciplineId: null,
    priceCents: 10000,
    ...over,
  });
  const grid = [
    row("all", [60], { priceCents: 30000 }),
    row("jazz", [60], { disciplineId: "jazz", priceCents: 32000 }),
    row("pair", [45, 60], { priceCents: 50000 }),
    row("adult", [45], { audience: "adult", priceCents: 28000 }),
    row("quarter", [45], { period: "quarter", priceCents: 9000 }),
  ];
  const child = { audience: "child", period: "year" } as const;

  it("the single-course row of its discipline first, else the one of all disciplines", () => {
    expect(standalonePrice(grid, child, { disciplineId: "jazz", durationMinutes: 60 })).toBe(32000);
    expect(standalonePrice(grid, child, { disciplineId: "classic", durationMinutes: 60 })).toBe(30000);
  });

  it("none for another audience, period or length, nor from a combination of several courses", () => {
    expect(standalonePrice(grid, child, { disciplineId: "jazz", durationMinutes: 45 })).toBeNull();
    expect(
      standalonePrice(grid, { audience: "child", period: "quarter" }, { disciplineId: "x", durationMinutes: 45 }),
    ).toBe(9000);
  });
});

describe("draftInvoices", () => {
  it("a payer with courses of two businesses gets two drafts, none numbered", () => {
    const drafts = draft([enrollment(), enrollment({ id: "e2", billingEntityId: "B", grossPriceCents: 30000 })]);
    expect(drafts.map((d) => [d.billingEntityId, d.totalInclTaxCents])).toEqual([
      ["A", 40000],
      ["B", 30000],
    ]);
    for (const d of drafts) expect(d).not.toHaveProperty("number");
  });

  it("a business with nothing to bill gets no draft", () => {
    expect(draft([enrollment()]).map((d) => d.billingEntityId)).toEqual(["A"]);
    expect(draft([])).toEqual([]);
  });

  it("a mixed package: VAT on the 20 % part only, totals add up, mentions copied on the exempt lines", () => {
    const [d] = draft([
      enrollment({
        grossPriceCents: 83000,
        discountCents: 8300,
        discountCodes: ["fratrie"],
        courses: [course("c1", "exempt", 60, 41500), course("c2", "vat20", 60, 41500)],
      }),
    ]);
    expect(d.lines.map((l) => [l.vatTreatmentId, l.inclTaxCents, l.vatCents, l.vatMention])).toEqual([
      ["exempt", 41500, 0, "Zz exonération"],
      ["exempt", -4150, 0, "Zz exonération"],
      ["vat20", 41500, 6917, null],
      ["vat20", -4150, -692, null],
    ]);
    expect(d.totalInclTaxCents).toBe(83000 - 8300);
    expect(d.totalVatCents).toBe(vatOf(41500 - 4150));
    expect(d.totalExclTaxCents + d.totalVatCents).toBe(d.totalInclTaxCents);
    for (const l of d.lines) expect(l.exclTaxCents + l.vatCents).toBe(l.inclTaxCents);
    expect(d.lines.find((l) => l.vatTreatmentId === "vat20")).toMatchObject({
      vatCategory: "standard",
      vatRateBps: 2000,
    });
  });

  it("a typed price (#292) is billed as is, with no « Remise » line even when a discount was computed", () => {
    const [d] = draft([enrollment({ discountCents: 4000, discountCodes: ["fratrie"], manualPriceCents: 25000 })]);
    expect(d.lines.map((l) => [l.label, l.inclTaxCents])).toEqual([["Forfait 1 h 00 — Zz Alice", 25000]]);
  });

  it("three siblings: each enrollment keeps its own discount line, the invoice adds them up", () => {
    const sibling = (id: string, discountCents: number) =>
      enrollment({
        id,
        label: `Forfait 1 h 00 — Zz ${id}`,
        discountCents,
        discountCodes: discountCents ? ["fratrie"] : [],
      });
    const [d] = draft([sibling("Alice", 0), sibling("Bruno", 4000), sibling("Chloé", 4000)]);
    expect(d.lines.map((l) => [l.enrollmentId, l.inclTaxCents])).toEqual([
      ["Alice", 40000],
      ["Bruno", 40000],
      ["Bruno", -4000],
      ["Chloé", 40000],
      ["Chloé", -4000],
    ]);
    expect(d.totalInclTaxCents).toBe(112000);
  });

  it("couple + discount: one enrollment for two students, its courses once, the discount taken off", () => {
    const [d] = draft([
      enrollment({
        label: "Forfait 1 h 00 — Zz Alice et Zz Bruno",
        grossPriceCents: 70000,
        discountCents: 7000,
        discountCodes: ["fratrie"],
      }),
    ]);
    expect(d.lines.map((l) => [l.label, l.inclTaxCents])).toEqual([
      ["Forfait 1 h 00 — Zz Alice et Zz Bruno", 70000],
      ["Remise", -7000],
    ]);
  });

  it("a quarterly enrollment: one line per part with the quarter's cents times the quarters, one installment per remaining quarter", () => {
    const [d] = draft([
      enrollment({
        period: "quarter",
        enrolledOn: "2027-11-15",
        grossPriceCents: 15000,
        discountCents: 1500,
        discountCodes: ["fratrie"],
        quarters: QUARTERS,
      }),
    ]);
    expect(d.lines.map((l) => [l.label, l.quantityThousandths, l.unitPriceCents, l.inclTaxCents])).toEqual([
      ["Forfait 1 h 00 — Zz Alice — 3 trimestres", 3000, 15000, 45000],
      ["Remise", 3000, -1500, -4500],
    ]);
    expect(d.installments).toEqual([
      { rank: 1, dueOn: "2027-11-15", amountCents: 13500 },
      { rank: 2, dueOn: "2028-01-01", amountCents: 13500 },
      { rank: 3, dueOn: "2028-04-01", amountCents: 13500 },
    ]);
    expect(sumInstallments(d)).toBe(d.totalInclTaxCents);
  });

  it("a quarterly enrollment covering only the remaining quarters bills those only", () => {
    const [d] = draft([
      enrollment({ period: "quarter", enrolledOn: "2028-02-01", grossPriceCents: 15000, quarters: QUARTERS.slice(1) }),
    ]);
    expect(d.totalInclTaxCents).toBe(30000);
    expect(d.installments.map((i) => i.dueOn)).toEqual(["2028-02-01", "2028-04-01"]);
  });

  it("a drop-out mid-term still owes all it covers (#99 default); trial and waitlist are not drafted yet", () => {
    const [d] = draft([
      enrollment({ id: "dropped", status: "dropped", period: "quarter", grossPriceCents: 15000, quarters: QUARTERS }),
      enrollment({ id: "trial", status: "trial" }),
      enrollment({ id: "waitlist", status: "waitlist" }),
    ]);
    expect(new Set(d.lines.map((l) => l.enrollmentId))).toEqual(new Set(["dropped"]));
    expect(d.totalInclTaxCents).toBe(45000);
  });

  it("yearly packages and lesson packs are billed but get no installment while no plan is chosen (#176)", () => {
    const [d] = draft(
      [enrollment(), enrollment({ id: "e2", enrolledOn: "2027-09-20", grossPriceCents: 30000 })],
      [pack(), pack({ id: "p2", billingEntityId: "B" })],
    );
    expect(d.lines.at(-1)).toMatchObject({ lessonPackId: "p1", enrollmentId: null, inclTaxCents: 20000 });
    expect(sumLines(d)).toBe(90000);
    expect(d.installments).toEqual([]);
  });

  it("quarters of several enrollments due the same day make one installment; the yearly part has none", () => {
    const quarterly = (id: string) =>
      enrollment({ id, period: "quarter", enrolledOn: "2027-09-10", grossPriceCents: 10000, quarters: QUARTERS });
    const [d] = draft([quarterly("e1"), quarterly("e2"), enrollment({ id: "y" })]);
    expect(d.installments).toEqual([
      { rank: 1, dueOn: "2027-10-01", amountCents: 20000 },
      { rank: 2, dueOn: "2028-01-01", amountCents: 20000 },
      { rank: 3, dueOn: "2028-04-01", amountCents: 20000 },
    ]);
    expect(d.totalInclTaxCents - sumInstallments(d)).toBe(40000);
  });

  it("a mixed quarterly package: each quarter's split cents times the quarters add up to the installments", () => {
    const [d] = draft([
      enrollment({
        period: "quarter",
        enrolledOn: "2027-09-10",
        grossPriceCents: 10001,
        discountCents: 1000,
        discountCodes: ["fratrie"],
        courses: [course("c1", "exempt"), course("c2", "vat20"), course("c3", "vat20", 45)],
        quarters: QUARTERS,
      }),
    ]);
    expect(d.lines.every((l) => l.inclTaxCents === l.unitPriceCents * 3)).toBe(true);
    expect(d.totalInclTaxCents).toBe(9001 * 3);
    expect(sumInstallments(d)).toBe(d.totalInclTaxCents);
  });

  it("a 1-cent line at 20 % carries no VAT", () => {
    const [d] = draft([enrollment({ courses: [course("c1", "vat20")], grossPriceCents: 1 })]);
    expect(d.lines[0]).toMatchObject({ inclTaxCents: 1, vatCents: 0, exclTaxCents: 1 });
  });

  it("refuses a discount larger than the price, in French", () => {
    const r = draftInvoices({
      enrollments: [enrollment({ discountCents: 50000 })],
      packs: [],
      entities: [A],
      treatments: TREATMENTS,
    });
    expect(r).toEqual({ ok: false, message: expect.stringContaining("remise plus grande") });
  });

  it("VAT of an invoice is computed per treatment on the whole invoice", () => {
    const [d] = draft([
      enrollment({ courses: [course("c1", "vat20")], grossPriceCents: 10001 }),
      enrollment({ id: "e2", courses: [course("c2", "vat20")], grossPriceCents: 10001 }),
    ]);
    expect(d.totalVatCents).toBe(vatOf(20002));
    expect(d.lines.map((l) => l.vatCents).reduce((a, b) => a + b, 0)).toBe(vatOf(20002));
  });

  it("refuses VAT for a business that charges none, and an unknown business", () => {
    const r = draftInvoices({
      enrollments: [enrollment({ billingEntityId: "B", courses: [course("c1", "vat20")] })],
      packs: [],
      entities: [A, B],
      treatments: TREATMENTS,
    });
    expect(r).toEqual({ ok: false, message: expect.stringContaining("Zz Danse B ne facture pas de TVA") });
    expect(() =>
      draftInvoices({
        enrollments: [enrollment({ billingEntityId: "Z" })],
        packs: [],
        entities: [A],
        treatments: TREATMENTS,
      }),
    ).toThrow(RangeError);
  });

  it("refuses an enrollment that owes something but has no course", () => {
    const r = draftInvoices({
      enrollments: [enrollment({ courses: [] })],
      packs: [],
      entities: [A],
      treatments: TREATMENTS,
    });
    expect(r.ok).toBe(false);
    expect(draft([enrollment({ status: "trial", courses: [] })])).toEqual([]);
  });

  it("a free typed price (0 €) gives a line but no installment", () => {
    const [d] = draft([enrollment({ manualPriceCents: 0 })]);
    expect(d.lines).toHaveLength(1);
    expect(d.installments).toEqual([]);
  });
});

describe("draftInvoices with an installment plan (#176)", () => {
  const SEASON = { startDate: "2027-09-01", endDate: "2028-06-30" };
  const plans = (over: Partial<DraftPlans> = {}): DraftPlans => ({
    setting: { counts: [1, 3, 10], dueDay: 5, roundingUnitCents: 100 },
    window: { season: SEASON, today: "2027-06-20" },
    choice: 3,
    previous: new Map(),
    ...over,
  });
  const run = (enrollments: BillableEnrollment[], packs: BillablePack[] = [], p = plans()) =>
    draftInvoices({ enrollments, packs, entities: [A, B], treatments: TREATMENTS, plans: p });
  const sibling = (id: string) =>
    enrollment({ id, grossPriceCents: 41500, discountCents: 4150, discountCodes: ["fratrie"] });

  it("three siblings at −10 % in 3 installments: to the euro, the cents on the first, the total exact", () => {
    const r = run([sibling("e1"), sibling("e2"), sibling("e3")]);
    if (!r.ok) throw new Error(r.message);
    const [d] = r.drafts;
    expect(d.totalInclTaxCents).toBe(112050);
    expect(d.installments).toEqual([
      { rank: 1, dueOn: "2027-09-05", amountCents: 37450 },
      { rank: 2, dueOn: "2027-10-05", amountCents: 37300 },
      { rank: 3, dueOn: "2027-11-05", amountCents: 37300 },
    ]);
    expect(d.installmentCount).toBe(3);
  });

  it("the plan covers yearly packages; packs and quarters keep their own days, merged by date", () => {
    const quarterly = enrollment({
      id: "q",
      period: "quarter",
      enrolledOn: "2027-09-10",
      grossPriceCents: 10000,
      quarters: QUARTERS,
    });
    const r = run([quarterly, enrollment({ id: "y" })], [pack()], plans({ choice: 1 }));
    if (!r.ok) throw new Error(r.message);
    const [d] = r.drafts;
    // The pack is due on the day of the drafting (#436), the yearly package by the plan.
    expect(d.installments).toEqual([
      { rank: 1, dueOn: "2027-06-20", amountCents: 20000 },
      { rank: 2, dueOn: "2027-09-05", amountCents: 40000 },
      { rank: 3, dueOn: "2027-10-01", amountCents: 10000 },
      { rank: 4, dueOn: "2028-01-01", amountCents: 10000 },
      { rank: 5, dueOn: "2028-04-01", amountCents: 10000 },
    ]);
    expect(sumInstallments(d)).toBe(d.totalInclTaxCents);
  });

  it("refuses 10 installments chosen when they no longer fit the season", () => {
    const r = run([enrollment()], [], plans({ choice: 10, window: { season: SEASON, today: "2027-11-12" } }));
    expect(r).toEqual({
      ok: false,
      message: "Le paiement en 10 fois finirait après la fin de la saison : choisissez moins d’échéances.",
    });
  });

  it("a plan starting mid-season begins at the next due day", () => {
    const r = run(
      [enrollment({ enrolledOn: "2028-02-14" })],
      [],
      plans({ window: { season: SEASON, today: "2028-02-14" } }),
    );
    if (!r.ok) throw new Error(r.message);
    expect(r.drafts[0].installments.map((i) => [i.dueOn, i.amountCents])).toEqual([
      ["2028-03-05", 13400],
      ["2028-04-05", 13300],
      ["2028-05-05", 13300],
    ]);
  });

  it("without a choice, each business keeps its previous draft's plan, else another business's", () => {
    const r = run(
      [enrollment(), enrollment({ id: "b", billingEntityId: "B" })],
      [],
      plans({ choice: null, previous: new Map([["A", 10]]) }),
    );
    if (!r.ok) throw new Error(r.message);
    expect(r.drafts.map((d) => [d.billingEntityId, d.installmentCount, d.installments.length])).toEqual([
      ["A", 10, 10],
      ["B", 10, 10],
    ]);
  });

  it("a previous plan that no longer fits is dropped: the draft is held until a plan is chosen", () => {
    const r = run(
      [enrollment()],
      [],
      plans({ choice: null, previous: new Map([["A", 10]]), window: { season: SEASON, today: "2027-11-12" } }),
    );
    if (!r.ok) throw new Error(r.message);
    expect(r.drafts[0]).toMatchObject({ installmentCount: null, installments: [] });
  });

  it("a payer paying only by the quarter records no plan, whatever was clicked", () => {
    const r = run([enrollment({ period: "quarter", grossPriceCents: 10000, quarters: QUARTERS })]);
    if (!r.ok) throw new Error(r.message);
    expect(r.drafts[0].installmentCount).toBeNull();
    expect(r.drafts[0].installments.map((i) => i.dueOn)).toEqual(["2027-10-01", "2028-01-01", "2028-04-01"]);
  });

  it("a plan installment and a quarter due the same day make one installment", () => {
    const quarterly = enrollment({ id: "q", period: "quarter", grossPriceCents: 10000, quarters: QUARTERS });
    const r = run(
      [quarterly, enrollment({ id: "y", grossPriceCents: 30000 })],
      [],
      plans({ setting: { counts: [1, 3, 10], dueDay: 1, roundingUnitCents: 100 } }),
    );
    if (!r.ok) throw new Error(r.message);
    expect(r.drafts[0].installments).toEqual([
      { rank: 1, dueOn: "2027-09-01", amountCents: 10000 },
      { rank: 2, dueOn: "2027-10-01", amountCents: 20000 },
      { rank: 3, dueOn: "2027-11-01", amountCents: 10000 },
      { rank: 4, dueOn: "2028-01-01", amountCents: 10000 },
      { rank: 5, dueOn: "2028-04-01", amountCents: 10000 },
    ]);
    expect(sumInstallments(r.drafts[0])).toBe(r.drafts[0].totalInclTaxCents);
  });

  it("a chosen plan one business cannot split is refused, naming that business", () => {
    const r = run(
      [enrollment(), enrollment({ id: "b", billingEntityId: "B", grossPriceCents: 900 })],
      [],
      plans({ choice: 10 }),
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/^Zz Danse B : .* ne se partagent pas en 10 échéances/);
  });

  it("a pack-only payer: one installment on the day of the drafting, no plan needed nor recorded (#436)", () => {
    for (const choice of [null, 3, 10]) {
      const r = run([], [pack(), pack({ id: "p2", priceCents: 9950 })], plans({ choice }));
      if (!r.ok) throw new Error(r.message);
      const [d] = r.drafts;
      expect(d.installments).toEqual([{ rank: 1, dueOn: "2027-06-20", amountCents: 29950 }]);
      expect(d.installmentCount).toBeNull();
      expect(sumInstallments(d)).toBe(d.totalInclTaxCents);
    }
  });

  it("a drop-in package is paid in one installment too, outside the plan (#436)", () => {
    const dropIn = enrollment({ id: "d", period: "single", grossPriceCents: 1500 });
    const r = run([dropIn], [], plans({ choice: 10 }));
    if (!r.ok) throw new Error(r.message);
    expect(r.drafts[0].installments).toEqual([{ rank: 1, dueOn: "2027-06-20", amountCents: 1500 }]);
    expect(r.drafts[0].installmentCount).toBeNull();
  });

  it("yearly + pack mid-season: the plan splits the yearly package only, the pack is due at once (#436)", () => {
    const r = run(
      [enrollment({ enrolledOn: "2027-11-12" })],
      [pack({ priceCents: 20050 })],
      plans({ choice: 3, window: { season: SEASON, today: "2027-11-12" } }),
    );
    if (!r.ok) throw new Error(r.message);
    const [d] = r.drafts;
    expect(d.installments).toEqual([
      { rank: 1, dueOn: "2027-11-12", amountCents: 20050 },
      { rank: 2, dueOn: "2027-12-05", amountCents: 13400 },
      { rank: 3, dueOn: "2028-01-05", amountCents: 13300 },
      { rank: 4, dueOn: "2028-02-05", amountCents: 13300 },
    ]);
    expect(d.installmentCount).toBe(3);
    expect(sumInstallments(d)).toBe(d.totalInclTaxCents);
  });

  it("a plan splits the yearly part alone: a pack never makes a small package splittable (#436)", () => {
    // 9 € of yearly package do not split into 10 euro installments; the pack's 200 € are not split.
    const r = run([enrollment({ grossPriceCents: 900 })], [pack()], plans({ choice: 10 }));
    expect(r.ok).toBe(false);
    const fits = run([enrollment({ grossPriceCents: 900 })], [pack()], plans({ choice: 1 }));
    if (!fits.ok) throw new Error(fits.message);
    expect(fits.drafts[0].installments).toEqual([
      { rank: 1, dueOn: "2027-06-20", amountCents: 20000 },
      { rank: 2, dueOn: "2027-09-05", amountCents: 900 },
    ]);
  });

  it("a yearly part held for its plan still lets the pack carry its installment", () => {
    const r = run([enrollment()], [pack()], plans({ choice: null }));
    if (!r.ok) throw new Error(r.message);
    expect(r.drafts[0]).toMatchObject({
      installmentCount: null,
      installments: [{ rank: 1, dueOn: "2027-06-20", amountCents: 20000 }],
    });
  });

  describe("drafted in June for a season starting on 13 September (#436)", () => {
    const LATE = { startDate: "2027-09-13", endDate: "2028-06-30" };
    const june = (choice: number) => plans({ choice, window: { season: LATE, today: "2027-06-20" } });

    it("3 installments: the first on 5 September, nothing due before the season", () => {
      const r = run([sibling("e1"), sibling("e2"), sibling("e3")], [], june(3));
      if (!r.ok) throw new Error(r.message);
      expect(r.drafts[0].installments.map((i) => i.dueOn)).toEqual(["2027-09-05", "2027-10-05", "2027-11-05"]);
    });

    it("10 installments: 5 September to 5 June, within the season", () => {
      const r = run([enrollment({ grossPriceCents: 64500 })], [], june(10));
      if (!r.ok) throw new Error(r.message);
      const dues = r.drafts[0].installments;
      expect(dues).toHaveLength(10);
      expect([dues[0].dueOn, dues[9].dueOn]).toEqual(["2027-09-05", "2028-06-05"]);
      expect(sumInstallments(r.drafts[0])).toBe(64500);
    });
  });

  it("a payer of two businesses: the chosen plan applies to both invoices (#436 point 3)", () => {
    const r = run(
      [enrollment(), enrollment({ id: "b", billingEntityId: "B", grossPriceCents: 30000 })],
      [],
      plans({ choice: 3 }),
    );
    if (!r.ok) throw new Error(r.message);
    expect(r.drafts.map((d) => [d.billingEntityId, d.installmentCount, d.installments.map((i) => i.dueOn)])).toEqual([
      ["A", 3, ["2027-09-05", "2027-10-05", "2027-11-05"]],
      ["B", 3, ["2027-09-05", "2027-10-05", "2027-11-05"]],
    ]);
  });

  it("no choice and no previous draft: held, as before #176", () => {
    const r = run([enrollment()], [], plans({ choice: null }));
    if (!r.ok) throw new Error(r.message);
    expect(r.drafts[0]).toMatchObject({ installmentCount: null, installments: [] });
  });
});

describe("labels", () => {
  it("names a package by its sorted lengths and its students", () => {
    expect(enrollmentLabel([60, 45], ["Zz Alice", "Zz Bruno"])).toBe("Forfait 45 min + 1 h 00 — Zz Alice et Zz Bruno");
    expect(enrollmentLabel([90], [])).toBe("Forfait 1 h 30");
  });

  it("names a lesson pack by its lessons and people", () => {
    expect(packLineLabel({ lessonCount: 1, peopleCount: 1 })).toBe("Carnet 1 séance · 1 personne");
    expect(packLineLabel({ lessonCount: 10, peopleCount: 2 })).toBe("Carnet 10 séances · 2 personnes");
  });
});

/** VAT in a VAT-inclusive amount at 20 %, rounded half away from zero (independent of the code under test). */
function vatOf(incl: number): number {
  const v = Math.round((Math.abs(incl) * 2000) / 12000);
  return Math.sign(incl) * v;
}
