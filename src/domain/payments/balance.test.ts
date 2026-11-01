import { describe, expect, it } from "vitest";
import { amountDue, balancesByEntity, dueCents, entityOwingMost, familyOwed, isCounted, payerBalance } from "./balance";

const TODAY = "2026-10-21";

describe("payerBalance", () => {
  it("due = active and ended enrollments + lesson packs; remaining = due − paid", () => {
    const s = payerBalance(
      [
        { status: "active", period: "year", quarterCount: 0, netPriceCents: 32_000 },
        { status: "ended", period: "year", quarterCount: 0, netPriceCents: 10_050 },
      ],
      [{ priceCents: 12_000 }],
      [{ amountCents: 20_000, plannedPayment: null }],
      TODAY,
    );
    expect(s).toEqual({ due: 54_050, paid: 20_000, remaining: 34_050, toCollect: 0, outsideCalculation: {} });
  });

  it("three dated cheques: all counted as paid, future ones flagged as to cash", () => {
    const s = payerBalance(
      [{ status: "active", period: "year", quarterCount: 0, netPriceCents: 30_000 }],
      [],
      [
        { amountCents: 10_000, plannedPayment: null },
        { amountCents: 10_000, plannedPayment: "2027-01-05" },
        { amountCents: 10_000, plannedPayment: "2027-04-05" },
      ],
      TODAY,
    );
    expect(s).toMatchObject({ paid: 30_000, remaining: 0, toCollect: 20_000 });
  });

  it("a correction (negative payment) reduces the paid amount; a cheque past its date is no longer « à encaisser »", () => {
    const s = payerBalance(
      [{ status: "active", period: "year", quarterCount: 0, netPriceCents: 15_000 }],
      [],
      [
        { amountCents: 15_000, plannedPayment: "2026-10-21" },
        { amountCents: 5_000, plannedPayment: null },
        { amountCents: -5_000, plannedPayment: null },
      ],
      TODAY,
    );
    expect(s).toMatchObject({ paid: 15_000, remaining: 0, toCollect: 0 });
  });

  it("a drop-out stays due; trial and waitlist stay out of the computation, but visible (#99, #284)", () => {
    const s = payerBalance(
      [
        { status: "dropped", period: "year", quarterCount: 0, netPriceCents: 20_000 },
        { status: "trial", period: "year", quarterCount: 0, netPriceCents: 1_500 },
        { status: "waitlist", period: "year", quarterCount: 0, netPriceCents: 9_000 },
      ],
      [],
      [{ amountCents: 1_000, plannedPayment: null }],
      TODAY,
    );
    expect(s).toEqual({
      due: 20_000,
      paid: 1_000,
      remaining: 19_000,
      toCollect: 0,
      outsideCalculation: { trial: 1_500, waitlist: 9_000 },
    });
  });
});

describe("quarterly enrollments (#291)", () => {
  it("a 110,00 € quarterly package over the whole season owes 330,00 €, not 110,00 €", () => {
    const s = payerBalance(
      [{ status: "active", period: "quarter", quarterCount: 3, netPriceCents: 11_000 }],
      [],
      [{ amountCents: 11_000, plannedPayment: null }],
      TODAY,
    );
    expect(s).toMatchObject({ due: 33_000, paid: 11_000, remaining: 22_000 });
  });

  it("enrolled in January: two quarters due; a waitlisted one shows its season amount apart", () => {
    const s = payerBalance(
      [
        { status: "active", period: "quarter", quarterCount: 2, netPriceCents: 11_000 },
        { status: "waitlist", period: "quarter", quarterCount: 2, netPriceCents: 9_000 },
      ],
      [],
      [],
      TODAY,
    );
    expect(s).toMatchObject({ due: 22_000, outsideCalculation: { waitlist: 18_000 } });
  });

  it("a quarterly drop-out still owes every covered quarter (#291 Q2 default with #284 Q1)", () => {
    const s = payerBalance(
      [{ status: "dropped", period: "quarter", quarterCount: 3, netPriceCents: 11_000 }],
      [],
      [],
      TODAY,
    );
    expect(s).toMatchObject({ due: 33_000, outsideCalculation: {} });
  });

  it("amountDue counts each quarter covered", () => {
    expect(
      amountDue([
        { status: "dropped", period: "quarter", quarterCount: 3, netPriceCents: 9_900 },
        { status: "active", period: "year", quarterCount: 0, netPriceCents: 30_000 },
      ]),
    ).toBe(59_700);
  });
});

describe("amountDue", () => {
  it("counts an enrollment an issued invoice bills at what the invoice bills, as the balance does (#358)", () => {
    const enrollments = [
      // Price changed after the invoice was issued: the invoice's 280,00 € counts, not 300,00 €.
      { status: "active", period: "year", quarterCount: 0, netPriceCents: 30_000, invoicedCents: 28_000 },
      // Not invoiced yet: its price.
      { status: "active", period: "year", quarterCount: 0, netPriceCents: 5_000, invoicedCents: null },
      // Fully credited by a credit note: nothing left.
      { status: "dropped", period: "year", quarterCount: 0, netPriceCents: 9_000, invoicedCents: 0 },
    ] as const;
    expect(amountDue(enrollments)).toBe(33_000);
    expect(
      payerBalance(
        enrollments.map((e) => ({ ...e, invoiced: e.invoicedCents !== null })),
        [],
        [],
        TODAY,
        [{ totalInclTaxCents: 28_000 }, { totalInclTaxCents: 9_000 }, { totalInclTaxCents: -9_000 }],
      ).due,
    ).toBe(33_000);
  });

  it("an invoiced enrollment counts whatever its status; one on trial and not invoiced does not", () => {
    const trial = { status: "trial", period: "year", quarterCount: 0, netPriceCents: 5_000 } as const;
    expect(amountDue([{ ...trial, invoicedCents: 5_000 }])).toBe(5_000);
    expect(amountDue([{ ...trial, invoicedCents: null }])).toBe(0);
    expect(isCounted({ ...trial, invoicedCents: 5_000 })).toBe(true);
    expect(isCounted(trial)).toBe(false);
    expect(dueCents({ ...trial, invoicedCents: 4_000 })).toBe(4_000);
    expect(dueCents(trial)).toBe(5_000);
  });

  it("counts active, ended and dropped enrollments, not trial nor waitlist", () => {
    expect(
      amountDue([
        { status: "active", period: "year", quarterCount: 0, netPriceCents: 11_000 },
        { status: "dropped", period: "year", quarterCount: 0, netPriceCents: 9_900 },
        { status: "ended", period: "year", quarterCount: 0, netPriceCents: 100 },
        { status: "trial", period: "year", quarterCount: 0, netPriceCents: 5_000 },
        { status: "waitlist", period: "year", quarterCount: 0, netPriceCents: 7_000 },
      ]),
    ).toBe(21_000);
  });
});

describe("balancesByEntity", () => {
  const A = "entity-a";
  const B = "entity-b";

  it("two entities: each balance holds its own enrollments, packs and payments; the total adds them up", () => {
    const s = balancesByEntity(
      [
        { status: "active", period: "year", quarterCount: 0, netPriceCents: 30_000, billingEntityId: A },
        { status: "active", period: "year", quarterCount: 0, netPriceCents: 20_000, billingEntityId: B },
      ],
      [{ priceCents: 12_000, billingEntityId: B }],
      [
        { amountCents: 30_000, plannedPayment: null, billingEntityId: A },
        { amountCents: 10_000, plannedPayment: "2027-01-05", billingEntityId: B },
      ],
      TODAY,
    );
    expect(s.byEntity[A]).toEqual({ due: 30_000, paid: 30_000, remaining: 0, toCollect: 0, outsideCalculation: {} });
    expect(s.byEntity[B]).toEqual({
      due: 32_000,
      paid: 10_000,
      remaining: 22_000,
      toCollect: 10_000,
      outsideCalculation: {},
    });
    expect(s.total).toEqual({
      due: 62_000,
      paid: 40_000,
      remaining: 22_000,
      toCollect: 10_000,
      outsideCalculation: {},
    });
  });

  it("an overpayment to one business is not netted against the other: each keeps its own balance", () => {
    const s = balancesByEntity(
      [
        { status: "active", period: "year", quarterCount: 0, netPriceCents: 10_000, billingEntityId: A },
        { status: "active", period: "year", quarterCount: 0, netPriceCents: 10_000, billingEntityId: B },
      ],
      [],
      [{ amountCents: 20_000, plannedPayment: null, billingEntityId: A }],
      TODAY,
    );
    expect(s.byEntity[A].remaining).toBe(-10_000);
    expect(s.byEntity[B].remaining).toBe(10_000);
    expect(s.total.remaining).toBe(0);
  });

  it("a correction and a rejected cheque count against the entity of the payment they reverse", () => {
    const s = balancesByEntity(
      [{ status: "active", period: "year", quarterCount: 0, netPriceCents: 15_000, billingEntityId: B }],
      [],
      [
        { amountCents: 15_000, plannedPayment: null, billingEntityId: B },
        // Correction of a cash payment entered twice.
        { amountCents: 5_000, plannedPayment: null, billingEntityId: B },
        { amountCents: -5_000, plannedPayment: null, billingEntityId: B },
        // Reverse entry of the deposited cheque the bank returned (#253).
        { amountCents: -15_000, plannedPayment: null, billingEntityId: B },
      ],
      TODAY,
    );
    expect(s.byEntity[B]).toMatchObject({ due: 15_000, paid: 0, remaining: 15_000 });
    expect(s.byEntity[A]).toBeUndefined();
    expect(s.total).toMatchObject({ paid: 0, remaining: 15_000 });
  });

  it("trial and waitlist enrollments stay visible, apart, on their entity and in the total", () => {
    const s = balancesByEntity(
      [
        { status: "trial", period: "year", quarterCount: 0, netPriceCents: 1_500, billingEntityId: A },
        { status: "waitlist", period: "year", quarterCount: 0, netPriceCents: 9_000, billingEntityId: B },
      ],
      [],
      [],
      TODAY,
    );
    expect(s.byEntity[A]).toMatchObject({ due: 0, outsideCalculation: { trial: 1_500 } });
    expect(s.byEntity[B]).toMatchObject({ due: 0, outsideCalculation: { waitlist: 9_000 } });
    expect(s.total.outsideCalculation).toEqual({ trial: 1_500, waitlist: 9_000 });
  });

  it("an issued invoice replaces the price of what it bills; what no invoice bills keeps its price (#305)", () => {
    const s = balancesByEntity(
      [
        // Billed by the invoice: its amount is the invoice's, not the enrollment's.
        {
          status: "active",
          period: "year",
          quarterCount: 0,
          netPriceCents: 30_000,
          billingEntityId: A,
          invoiced: true,
        },
        // Enrolled after the invoice was issued: still counted from its price.
        { status: "active", period: "year", quarterCount: 0, netPriceCents: 5_000, billingEntityId: A },
        { status: "active", period: "year", quarterCount: 0, netPriceCents: 20_000, billingEntityId: B },
      ],
      [{ priceCents: 12_000, billingEntityId: A, invoiced: true }],
      [{ amountCents: 10_000, plannedPayment: null, billingEntityId: A }],
      TODAY,
      [{ billingEntityId: A, totalInclTaxCents: 41_990 }],
    );
    expect(s.byEntity[A]).toMatchObject({ due: 46_990, paid: 10_000, remaining: 36_990 });
    expect(s.byEntity[B]).toMatchObject({ due: 20_000, remaining: 20_000 });
    expect(s.total).toMatchObject({ due: 66_990, remaining: 56_990 });
  });

  it("a payer without any invoice keeps the balance computed from prices", () => {
    const enrollments = [
      { status: "active", period: "year", quarterCount: 0, netPriceCents: 30_000, billingEntityId: A },
    ] as const;
    const payments = [{ amountCents: 10_000, plannedPayment: null, billingEntityId: A }];
    expect(balancesByEntity(enrollments, [], payments, TODAY, [])).toEqual(
      balancesByEntity(enrollments, [], payments, TODAY),
    );
    expect(balancesByEntity(enrollments, [], payments, TODAY).total).toMatchObject({ due: 30_000, remaining: 20_000 });
  });

  it("an invoiced enrollment on trial is no longer shown apart: the invoice counts it", () => {
    const s = balancesByEntity(
      [{ status: "trial", period: "year", quarterCount: 0, netPriceCents: 1_500, billingEntityId: A, invoiced: true }],
      [],
      [],
      TODAY,
      [{ billingEntityId: A, totalInclTaxCents: 1_500 }],
    );
    expect(s.byEntity[A]).toMatchObject({ due: 1_500, outsideCalculation: {} });
  });

  it("an issued credit note (negative total) lowers what is due", () => {
    const s = balancesByEntity(
      [
        {
          status: "dropped",
          period: "year",
          quarterCount: 0,
          netPriceCents: 30_000,
          billingEntityId: A,
          invoiced: true,
        },
      ],
      [],
      [{ amountCents: 20_000, plannedPayment: null, billingEntityId: A }],
      TODAY,
      [
        { billingEntityId: A, totalInclTaxCents: 30_000 },
        { billingEntityId: A, totalInclTaxCents: -10_000 },
      ],
    );
    expect(s.byEntity[A]).toMatchObject({ due: 20_000, paid: 20_000, remaining: 0 });
  });

  it("an entity known by an invoice only still gets its balance", () => {
    const s = balancesByEntity([], [], [], TODAY, [{ billingEntityId: B, totalInclTaxCents: 8_000 }]);
    expect(s.byEntity[B]).toMatchObject({ due: 8_000, remaining: 8_000 });
  });

  it("an empty payer: no entity, a zero total", () => {
    expect(balancesByEntity([], [], [], TODAY)).toEqual({
      byEntity: {},
      total: { due: 0, paid: 0, remaining: 0, toCollect: 0, outsideCalculation: {} },
    });
  });
});

describe("familyOwed", () => {
  const balance = (remaining: number) => ({ due: 0, paid: 0, remaining, toCollect: 0, outsideCalculation: {} });

  it("an overpayment to one entity never hides a debt to the other", () => {
    expect(familyOwed([balance(-10_000), balance(10_000)])).toEqual({ owed: 10_000, overpaid: 10_000 });
  });

  it("adds up what is owed to each entity", () => {
    expect(familyOwed([balance(2_500), balance(0), balance(7_501)])).toEqual({ owed: 10_001, overpaid: 0 });
  });

  it("nothing: zero both ways", () => expect(familyOwed([])).toEqual({ owed: 0, overpaid: 0 }));
});

describe("entityOwingMost", () => {
  const balance = (remaining: number) => ({ due: 0, paid: 0, remaining, toCollect: 0, outsideCalculation: {} });

  it("the entity the payer owes the most, among those offered", () => {
    expect(entityOwingMost(["a", "b", "c"], { a: balance(5_000), b: balance(12_000), x: balance(90_000) })).toBe("b");
  });

  it("nothing owed (or an overpayment): the first offered, the school's default", () => {
    expect(entityOwingMost(["a", "b"], { a: balance(0), b: balance(-3_000) })).toBe("a");
    expect(entityOwingMost(["a", "b"], {})).toBe("a");
  });

  it("one cent more owed is enough", () => {
    expect(entityOwingMost(["a", "b"], { a: balance(1_000), b: balance(1_001) })).toBe("b");
  });

  it("a tie keeps the order offered", () => {
    expect(entityOwingMost(["a", "b"], { a: balance(1_000), b: balance(1_000) })).toBe("a");
    expect(entityOwingMost(["b", "a"], { a: balance(1_000), b: balance(1_000) })).toBe("b");
  });

  it("no entity offered: null", () => {
    expect(entityOwingMost([], { a: balance(1_000) })).toBeNull();
  });
});
