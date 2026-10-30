import { describe, expect, it } from "vitest";
import { amountDue, balancesByEntity, entityOwingMost, payerBalance } from "./balance";

const TODAY = "2026-10-21";

describe("payerBalance", () => {
  it("due = active and ended enrollments + lesson packs; remaining = due − paid", () => {
    const s = payerBalance(
      [
        { status: "active", netPriceCents: 32_000 },
        { status: "ended", netPriceCents: 10_050 },
      ],
      [{ priceCents: 12_000 }],
      [{ amountCents: 20_000, plannedPayment: null }],
      TODAY,
    );
    expect(s).toEqual({ due: 54_050, paid: 20_000, remaining: 34_050, toCollect: 0, outsideCalculation: {} });
  });

  it("three dated cheques: all counted as paid, future ones flagged as to cash", () => {
    const s = payerBalance(
      [{ status: "active", netPriceCents: 30_000 }],
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
      [{ status: "active", netPriceCents: 15_000 }],
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
        { status: "dropped", netPriceCents: 20_000 },
        { status: "trial", netPriceCents: 1_500 },
        { status: "waitlist", netPriceCents: 9_000 },
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

describe("amountDue", () => {
  it("counts active, ended and dropped enrollments, not trial nor waitlist", () => {
    expect(
      amountDue([
        { status: "active", netPriceCents: 11_000 },
        { status: "dropped", netPriceCents: 9_900 },
        { status: "ended", netPriceCents: 100 },
        { status: "trial", netPriceCents: 5_000 },
        { status: "waitlist", netPriceCents: 7_000 },
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
        { status: "active", netPriceCents: 30_000, billingEntityId: A },
        { status: "active", netPriceCents: 20_000, billingEntityId: B },
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
        { status: "active", netPriceCents: 10_000, billingEntityId: A },
        { status: "active", netPriceCents: 10_000, billingEntityId: B },
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
      [{ status: "active", netPriceCents: 15_000, billingEntityId: B }],
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
        { status: "trial", netPriceCents: 1_500, billingEntityId: A },
        { status: "waitlist", netPriceCents: 9_000, billingEntityId: B },
      ],
      [],
      [],
      TODAY,
    );
    expect(s.byEntity[A]).toMatchObject({ due: 0, outsideCalculation: { trial: 1_500 } });
    expect(s.byEntity[B]).toMatchObject({ due: 0, outsideCalculation: { waitlist: 9_000 } });
    expect(s.total.outsideCalculation).toEqual({ trial: 1_500, waitlist: 9_000 });
  });

  it("an empty payer: no entity, a zero total", () => {
    expect(balancesByEntity([], [], [], TODAY)).toEqual({
      byEntity: {},
      total: { due: 0, paid: 0, remaining: 0, toCollect: 0, outsideCalculation: {} },
    });
  });
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

  it("a tie keeps the order offered", () => {
    expect(entityOwingMost(["a", "b"], { a: balance(1_000), b: balance(1_000) })).toBe("a");
    expect(entityOwingMost(["b", "a"], { a: balance(1_000), b: balance(1_000) })).toBe("b");
  });

  it("no entity offered: null", () => {
    expect(entityOwingMost([], { a: balance(1_000) })).toBeNull();
  });
});
