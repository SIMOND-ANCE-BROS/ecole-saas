import { describe, expect, it } from "vitest";
import { formatEuros } from "../../lib/money";
import { payerBalance } from "./balance";
import { toDeposit } from "./deposits";
import {
  type CollectablePayment,
  heldForPendingEnrollments,
  isRefund,
  isRefundMethod,
  isUncollected,
  mayRefund,
  overpaidOf,
  REFUND_METHODS,
  refundableCents,
  refundRefusal,
  uncollectedCents,
} from "./refund";

const TODAY = "2026-11-02";
// Fictitious case of the issue: 280,00 € due and paid, then a works council cheque of 100,00 €.
const overpaid = payerBalance(
  [{ status: "active", period: "year", netPriceCents: 28_000, quarterCount: 0 }],
  [],
  [
    { amountCents: 28_000, plannedPayment: null },
    { amountCents: 10_000, plannedPayment: null },
  ],
  TODAY,
);

describe("overpaidOf", () => {
  it("is the overpaid amount", () => {
    expect(overpaid.remaining).toBe(-10_000);
    expect(overpaidOf(overpaid)).toBe(10_000);
  });

  it("is nothing when the payer owes or is settled", () => {
    expect(overpaidOf({ remaining: 0 })).toBe(0);
    expect(overpaidOf({ remaining: 4_500 })).toBe(0);
  });
});

describe("money not collected yet", () => {
  const paid = (p: Partial<CollectablePayment>): CollectablePayment => ({
    amountCents: 10_000,
    method: "cheque",
    plannedPayment: null,
    deposited: true,
    correctedCents: 0,
    ...p,
  });

  it("is a cheque to cash after today, even once deposited", () => {
    expect(isUncollected(paid({ plannedPayment: "2026-11-03" }), TODAY)).toBe(true);
    expect(isUncollected(paid({ plannedPayment: TODAY }), TODAY)).toBe(false);
  });

  it("is a cheque or a paper holiday voucher not deposited yet", () => {
    expect(isUncollected(paid({ deposited: false }), TODAY)).toBe(true);
    expect(isUncollected(paid({ method: "holiday_voucher", deposited: false }), TODAY)).toBe(true);
  });

  it("is never cash in hand, a transfer, a card or an online voucher", () => {
    for (const method of ["cash", "transfer", "card", "holiday_voucher_online"] as const)
      expect(isUncollected(paid({ method, deposited: false }), TODAY)).toBe(false);
  });

  it("is counted net of corrections, and never for a reverse entry", () => {
    expect(
      uncollectedCents(
        [
          paid({ deposited: false, correctedCents: 4_000 }),
          paid({ deposited: false, correctedCents: 10_000 }),
          paid({ amountCents: -6_000, deposited: false }),
          paid({ method: "cash", deposited: false }),
          paid({}),
        ],
        TODAY,
      ),
    ).toBe(6_000);
  });

  it("is taken off what can be paid back", () => {
    // The works council cheque of 100,00 € is still in the drawer: nothing to pay back yet.
    expect(refundableCents(10_000, 10_000)).toBe(0);
    expect(refundableCents(10_000, 4_000)).toBe(6_000);
    expect(refundableCents(10_000, 0)).toBe(10_000);
    // More uncollected than overpaid (the family's own cheque is not banked either).
    expect(refundableCents(10_000, 38_000)).toBe(0);
  });

  it("holds back what enrollments on trial or on the waitlist would cost", () => {
    // 280,00 € paid in cash for a trial enrollment: due is 0, nothing is paid back yet.
    const trial = payerBalance(
      [{ status: "trial", period: "year", netPriceCents: 28_000, quarterCount: 0 }],
      [],
      [{ amountCents: 28_000, plannedPayment: null }],
      TODAY,
    );
    const held = heldForPendingEnrollments(trial.outsideCalculation);
    expect(held).toBe(28_000);
    expect(refundableCents(overpaidOf(trial), 0, held)).toBe(0);
    // A works council transfer of 100,00 € on top of it: that part may be paid back.
    expect(refundableCents(38_000, 0, held)).toBe(10_000);
    expect(heldForPendingEnrollments({ trial: 1_000, waitlist: 2_500 })).toBe(3_500);
    expect(heldForPendingEnrollments({})).toBe(0);
  });
});

describe("refundRefusal", () => {
  const ok = {
    amountCents: 10_000,
    overpaidCents: 10_000,
    refundableCents: 10_000,
    uncollectedCents: 0,
    date: TODAY,
    today: TODAY,
  };

  it("refuses a refund paid out of money not collected yet", () => {
    expect(refundRefusal({ ...ok, refundableCents: 0, uncollectedCents: 10_000 })).toBe(
      "Le trop-perçu n’est pas encore encaissé : remettez d’abord les chèques en banque.",
    );
    expect(refundRefusal({ ...ok, refundableCents: 6_000, uncollectedCents: 4_000 })).toBe(
      `Le remboursement dépasse ce qui peut être remboursé (${formatEuros(6_000)}) : le reste attend l’encaissement de chèques ou couvre une inscription à l’essai ou en liste d’attente.`,
    );
    expect(refundRefusal({ ...ok, amountCents: 6_000, refundableCents: 6_000, uncollectedCents: 4_000 })).toBeNull();
  });

  it("refuses a refund of an advance on an enrollment on trial or on the waitlist", () => {
    expect(refundRefusal({ ...ok, refundableCents: 0 })).toBe(
      "Le trop-perçu couvre une inscription à l’essai ou en liste d’attente : rien à rembourser avant qu’elle soit confirmée ou annulée.",
    );
  });

  it("accepts a refund equal to the overpayment, which settles the balance", () => {
    expect(refundRefusal(ok)).toBeNull();
    const after = payerBalance(
      [{ status: "active", period: "year", netPriceCents: 28_000, quarterCount: 0 }],
      [],
      [
        { amountCents: 28_000, plannedPayment: null },
        { amountCents: 10_000, plannedPayment: null },
        { amountCents: -10_000, plannedPayment: null },
      ],
      TODAY,
    );
    expect(after.remaining).toBe(0);
  });

  it("accepts a partial refund, the rest staying overpaid", () => {
    expect(refundRefusal({ ...ok, amountCents: 4_000 })).toBeNull();
    expect(refundRefusal({ ...ok, amountCents: 1 })).toBeNull();
  });

  it("refuses a refund larger than the overpayment, even by one cent", () => {
    expect(refundRefusal({ ...ok, amountCents: 10_001 })).toBe(
      `Le remboursement dépasse le trop-perçu (${formatEuros(10_000)}) : rechargez la fiche.`,
    );
  });

  it("refuses any refund without an overpayment", () => {
    for (const overpaidCents of [0, -500])
      expect(refundRefusal({ ...ok, overpaidCents, amountCents: 100 })).toBe(
        "Rien à rembourser : ce payeur n’a pas de trop-perçu.",
      );
  });

  it("refuses a zero, negative or fractional amount", () => {
    for (const amountCents of [0, -100, 12.5])
      expect(refundRefusal({ ...ok, amountCents })).toBe("Indiquez un montant supérieur à 0.");
  });

  it("refuses a day after today or one that does not exist", () => {
    expect(refundRefusal({ ...ok, date: "2026-11-03" })).toBe(
      "Le remboursement ne peut pas être daté après aujourd’hui.",
    );
    expect(refundRefusal({ ...ok, date: "2026-02-31" })).toBe("Date invalide.");
    expect(refundRefusal({ ...ok, date: "02/11/2026" })).toBe("Date invalide.");
    expect(refundRefusal({ ...ok, date: "2026-10-15" })).toBeNull();
  });
});

describe("refund methods", () => {
  it("are cheque, cash and transfer, by default (#294 question 1)", () => {
    expect(REFUND_METHODS).toEqual(["cheque", "cash", "transfer"]);
    expect(isRefundMethod("transfer")).toBe(true);
    expect(isRefundMethod("holiday_voucher")).toBe(false);
    expect(isRefundMethod("card")).toBe(false);
  });
});

describe("who may refund", () => {
  it("is management only, like every reverse entry", () => {
    expect(mayRefund("director")).toBe(true);
    expect(mayRefund("front_desk")).toBe(false);
    expect(mayRefund("teacher")).toBe(false);
  });
});

describe("a refund", () => {
  it("is told apart by its kind, not by its sign", () => {
    expect(isRefund({ reversalKind: "refund" })).toBe(true);
    expect(isRefund({ reversalKind: "correction" })).toBe(false);
    expect(isRefund({ reversalKind: null })).toBe(false);
  });

  it("never goes on a deposit slip, even a cheque or cash", () => {
    const r = toDeposit(
      [
        { id: "r1", method: "cheque", amountCents: -10_000, correctedCents: 0, plannedPayment: null, depositId: null },
        { id: "r2", method: "cash", amountCents: -2_000, correctedCents: 0, plannedPayment: null, depositId: null },
      ],
      TODAY,
    );
    expect(r).toEqual({ cheque: [], cash: [], holiday_voucher: [] });
  });
});
