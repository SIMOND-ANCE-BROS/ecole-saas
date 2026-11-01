import { describe, expect, it } from "vitest";
import {
  type AllocatablePayment,
  allocateFifo,
  allocationRefusal,
  availableCents,
  byOldestDue,
  entityPoolCents,
  heldCapCents,
  isCollectedForAllocation,
  installmentStatusOf,
  releaseExcess,
  type OpenInstallment,
} from "./allocation";

const TODAY = "2026-11-02";

const cash = (id: string, amountCents: number, over: Partial<AllocatablePayment> = {}): AllocatablePayment => ({
  id,
  amountCents,
  method: "cash",
  plannedPayment: null,
  deposited: false,
  correctedCents: 0,
  allocatedCents: 0,
  reversalKind: null,
  ...over,
});

const due = (
  id: string,
  dueDate: string,
  amountCents: number,
  over: Partial<OpenInstallment> = {},
): OpenInstallment => ({
  id,
  invoiceId: "inv-1",
  rank: 1,
  dueDate,
  amountCents,
  allocatedCents: 0,
  ...over,
});

const quarters = [
  due("q3", "2027-04-01", 10_000, { rank: 3 }),
  due("q1", "2026-10-01", 10_000, { rank: 1 }),
  due("q2", "2027-01-01", 10_000, { rank: 2 }),
];

describe("allocateFifo (#305)", () => {
  it("one payment covering three installments pays them oldest due date first", () => {
    expect(allocateFifo([cash("p", 30_000)], quarters, 30_000, TODAY)).toEqual([
      { paymentId: "p", installmentId: "q1", amountCents: 10_000 },
      { paymentId: "p", installmentId: "q2", amountCents: 10_000 },
      { paymentId: "p", installmentId: "q3", amountCents: 10_000 },
    ]);
  });

  it("a partial payment pays the oldest installment, then part of the next one", () => {
    expect(allocateFifo([cash("p", 15_050)], quarters, 15_050, TODAY)).toEqual([
      { paymentId: "p", installmentId: "q1", amountCents: 10_000 },
      { paymentId: "p", installmentId: "q2", amountCents: 5_050 },
    ]);
  });

  it("an overpayment pays every installment; the rest stays unallocated", () => {
    const a = allocateFifo([cash("p", 35_000)], quarters, 35_000, TODAY);
    expect(a.reduce((s, x) => s + x.amountCents, 0)).toBe(30_000);
  });

  it("a corrected payment allocates only what the correction left", () => {
    const corrected = cash("p", 20_000, { correctedCents: 12_000 });
    expect(allocateFifo([corrected], quarters, entityPoolCents([corrected], TODAY), TODAY)).toEqual([
      { paymentId: "p", installmentId: "q1", amountCents: 8_000 },
    ]);
  });

  it("an installment partly paid already receives only its rest", () => {
    const open = [due("q1", "2026-10-01", 10_000, { allocatedCents: 7_000 }), quarters[2]];
    expect(allocateFifo([cash("p", 5_000)], open, 5_000, TODAY)).toEqual([
      { paymentId: "p", installmentId: "q1", amountCents: 3_000 },
      { paymentId: "p", installmentId: "q2", amountCents: 2_000 },
    ]);
  });

  it("across the entity's invoices: the oldest due date wins, whatever the invoice", () => {
    const open = [
      due("a2", "2027-01-01", 5_000, { invoiceId: "inv-a", rank: 2 }),
      due("b1", "2026-12-01", 5_000, { invoiceId: "inv-b", rank: 1 }),
      due("a1", "2026-10-01", 5_000, { invoiceId: "inv-a", rank: 1 }),
    ];
    expect(allocateFifo([cash("p", 15_000)], open, 15_000, TODAY).map((x) => x.installmentId)).toEqual([
      "a1",
      "b1",
      "a2",
    ]);
  });

  it("two payments: the first given is spent first, then the second", () => {
    expect(allocateFifo([cash("p1", 12_000), cash("p2", 10_000)], quarters, 22_000, TODAY)).toEqual([
      { paymentId: "p1", installmentId: "q1", amountCents: 10_000 },
      { paymentId: "p1", installmentId: "q2", amountCents: 2_000 },
      { paymentId: "p2", installmentId: "q2", amountCents: 8_000 },
      { paymentId: "p2", installmentId: "q3", amountCents: 2_000 },
    ]);
  });

  it("never more than the entity's pool (money already refunded is not allocated)", () => {
    expect(allocateFifo([cash("p", 30_000)], quarters, 12_000, TODAY)).toEqual([
      { paymentId: "p", installmentId: "q1", amountCents: 10_000 },
      { paymentId: "p", installmentId: "q2", amountCents: 2_000 },
    ]);
  });

  it("a cheque still in the drawer allocates nothing until it is deposited", () => {
    const drawer = cash("p", 10_000, { method: "cheque" });
    expect(allocateFifo([drawer], quarters, 10_000, TODAY)).toEqual([]);
    expect(allocateFifo([{ ...drawer, deposited: true }], quarters, 10_000, TODAY)).toHaveLength(1);
  });

  it("nothing open: nothing allocated", () => {
    expect(allocateFifo([cash("p", 10_000)], [], 10_000, TODAY)).toEqual([]);
  });
});

describe("byOldestDue", () => {
  it("due date, then invoice, then rank", () => {
    const open = [
      due("x", "2027-01-01", 1, { invoiceId: "b", rank: 1 }),
      due("y", "2027-01-01", 1, { invoiceId: "a", rank: 2 }),
      due("z", "2027-01-01", 1, { invoiceId: "a", rank: 1 }),
    ];
    expect([...open].sort(byOldestDue).map((i) => i.id)).toEqual(["z", "y", "x"]);
  });
});

describe("availableCents and entityPoolCents", () => {
  it("collected money net of corrections and of what is already allocated", () => {
    expect(availableCents(cash("p", 10_000, { correctedCents: 1_000, allocatedCents: 4_000 }), TODAY)).toBe(5_000);
  });

  it("a cheque to cash later, or a rejected one, offers nothing", () => {
    expect(availableCents(cash("p", 10_000, { method: "cheque", plannedPayment: "2027-01-05" }), TODAY)).toBe(0);
    expect(
      availableCents(cash("p", 10_000, { method: "cheque", deposited: true, correctedCents: 10_000 }), TODAY),
    ).toBe(0);
  });

  it("a reverse entry offers nothing by itself", () => {
    expect(availableCents(cash("r", -5_000, { reversalKind: "refund" }), TODAY)).toBe(0);
  });

  it("the pool subtracts refunds paid back to the payer", () => {
    const payments = [cash("p", 38_000, { allocatedCents: 28_000 }), cash("r", -10_000, { reversalKind: "refund" })];
    expect(entityPoolCents(payments, TODAY)).toBe(0);
  });

  it("a refund cancelled by mistake (#346) gives its money back to the pool", () => {
    const payments = [
      cash("p", 38_000, { allocatedCents: 28_000 }),
      cash("r", -10_000, { reversalKind: "refund", correctedCents: 6_000 }),
      cash("c", 6_000, { reversalKind: "refund_cancellation" }),
    ];
    expect(availableCents(payments[2], TODAY)).toBe(0);
    expect(entityPoolCents(payments, TODAY)).toBe(6_000);
  });

  it("the pool never goes below zero", () => {
    expect(entityPoolCents([cash("r", -10_000, { reversalKind: "refund" })], TODAY)).toBe(0);
  });
});

describe("releaseExcess", () => {
  const allocations = [
    { paymentId: "p", installmentId: "q1", invoiceId: "inv-1", rank: 1, dueDate: "2026-10-01", amountCents: 10_000 },
    { paymentId: "p", installmentId: "q2", invoiceId: "inv-1", rank: 2, dueDate: "2027-01-01", amountCents: 10_000 },
  ];
  const changes = (a: { paymentId: string; installmentId: string; amountCents: number }[]) =>
    a.map(({ paymentId, installmentId, amountCents }) => ({ paymentId, installmentId, amountCents }));

  it("a correction takes back from the latest due installment first", () => {
    expect(changes(releaseExcess(allocations, 13_000))).toEqual([
      { paymentId: "p", installmentId: "q2", amountCents: 3_000 },
    ]);
  });

  it("a rejected cheque releases every allocation", () => {
    expect(changes(releaseExcess(allocations, 0))).toEqual([
      { paymentId: "p", installmentId: "q2", amountCents: 0 },
      { paymentId: "p", installmentId: "q1", amountCents: 0 },
    ]);
  });

  it("enough left: nothing to release", () => {
    expect(releaseExcess(allocations, 20_000)).toEqual([]);
  });

  it("across several payments: the latest due installment first, then the latest payment on it", () => {
    const two = [
      { ...allocations[0], paymentId: "a", amountCents: 6_000 },
      { ...allocations[0], paymentId: "b", amountCents: 4_000 },
      { ...allocations[1], paymentId: "b", amountCents: 2_000 },
    ];
    expect(changes(releaseExcess(two, 7_000))).toEqual([
      { paymentId: "b", installmentId: "q2", amountCents: 0 },
      { paymentId: "b", installmentId: "q1", amountCents: 1_000 },
    ]);
  });
});

describe("heldCapCents", () => {
  it("a correction after a refund: the payer's allocations may hold less than they do", () => {
    // 100,00 € cash, 60,00 € allocated, 40,00 € refunded, then 40,00 € corrected: 20,00 € left.
    const payments = [
      cash("p", 10_000, { allocatedCents: 6_000, correctedCents: 4_000 }),
      cash("r", -4_000, { reversalKind: "refund" }),
    ];
    expect(heldCapCents(payments, TODAY)).toBe(2_000);
  });
});

describe("a deposit dated ahead", () => {
  it("a deposited cheque counts as collected even before its planned cashing day", () => {
    const ahead = cash("p", 10_000, { method: "cheque", plannedPayment: "2026-11-05", deposited: true });
    expect(isCollectedForAllocation(ahead, TODAY)).toBe(true);
    expect(availableCents(ahead, TODAY)).toBe(10_000);
    expect(isCollectedForAllocation({ ...ahead, deposited: false }, TODAY)).toBe(false);
  });
});

describe("leftover cents", () => {
  it("100,01 € over 33,34 / 33,34 / 33,33: every cent lands, none twice", () => {
    const open = [
      due("a", "2026-10-01", 3_334, { rank: 1 }),
      due("b", "2027-01-01", 3_334, { rank: 2 }),
      due("c", "2027-04-01", 3_333, { rank: 3 }),
    ];
    expect(allocateFifo([cash("p", 10_001)], open, 10_001, TODAY).map((x) => x.amountCents)).toEqual([
      3_334, 3_334, 3_333,
    ]);
    expect(allocateFifo([cash("p", 6_669)], open, 6_669, TODAY).map((x) => x.amountCents)).toEqual([3_334, 3_334, 1]);
  });

  it("an installment of 0 or already paid receives nothing", () => {
    const open = [due("z", "2026-09-01", 0), due("a", "2026-10-01", 1_000)];
    expect(allocateFifo([cash("p", 500)], open, 500, TODAY)).toEqual([
      { paymentId: "p", installmentId: "a", amountCents: 500 },
    ]);
  });
});

describe("installmentStatusOf", () => {
  const i = { amountCents: 10_000, dueDate: "2026-12-01" };
  it("paid, partial, overdue or upcoming", () => {
    expect(installmentStatusOf({ ...i, allocatedCents: 10_000 }, TODAY)).toBe("paid");
    expect(installmentStatusOf({ ...i, allocatedCents: 1 }, TODAY)).toBe("partial");
    expect(installmentStatusOf({ ...i, allocatedCents: 0 }, TODAY)).toBe("upcoming");
    expect(installmentStatusOf({ ...i, allocatedCents: 0 }, "2026-12-02")).toBe("overdue");
  });

  it("overdue from the day after its due date, never on it (#358)", () => {
    expect(installmentStatusOf({ ...i, allocatedCents: 0 }, "2026-12-01")).toBe("upcoming");
    expect(installmentStatusOf({ ...i, allocatedCents: 0 }, "2026-12-02")).toBe("overdue");
    // Partly paid stays partial past its due date.
    expect(installmentStatusOf({ ...i, allocatedCents: 1 }, "2027-01-01")).toBe("partial");
  });
});

describe("allocationRefusal", () => {
  it("refuses more than the payment still offers, or more than the installment still owes", () => {
    expect(allocationRefusal({ amountCents: 5_000, availableCents: 4_000, remainingCents: 10_000 })).toBe(
      "L’affectation dépasse ce qui reste du paiement après ses corrections : rechargez la fiche.",
    );
    expect(allocationRefusal({ amountCents: 5_000, availableCents: 10_000, remainingCents: 4_000 })).toBe(
      "L’affectation dépasse ce qui reste à payer sur l’échéance : rechargez la fiche.",
    );
    expect(allocationRefusal({ amountCents: 0, availableCents: 10_000, remainingCents: 4_000 })).toBe(
      "Montant d’affectation invalide.",
    );
    expect(allocationRefusal({ amountCents: 4_000, availableCents: 4_000, remainingCents: 4_000 })).toBeNull();
  });
});
