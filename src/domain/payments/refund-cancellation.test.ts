import { describe, expect, it } from "vitest";
import { formatEuros } from "../../lib/money";
import { payerBalance } from "./balance";
import { toDeposit, totals } from "./deposits";
import { exportReference } from "./payment-log";
import { isUncollected, uncollectedCents } from "./refund";
import {
  CANCEL_REFUND_ROLES,
  isRefundCancellation,
  mayCancelRefund,
  refundCancellationRefusal,
  refundLeftCents,
} from "./refund-cancellation";

const TODAY = "2026-11-02";

describe("who cancels a refund (#346 question 1, default)", () => {
  it("is management only, as for a correction", () => {
    expect(CANCEL_REFUND_ROLES).toEqual(["director"]);
    expect(mayCancelRefund("director")).toBe(true);
    expect(mayCancelRefund("front_desk")).toBe(false);
    expect(mayCancelRefund("teacher")).toBe(false);
  });
});

describe("refundLeftCents", () => {
  it("is what of a refund is not cancelled yet, as a positive amount", () => {
    expect(refundLeftCents({ amountCents: -10_000, cancelledCents: 0 })).toBe(10_000);
    expect(refundLeftCents({ amountCents: -10_000, cancelledCents: 4_000 })).toBe(6_000);
    expect(refundLeftCents({ amountCents: -10_000, cancelledCents: 10_000 })).toBe(0);
  });
});

describe("refundCancellationRefusal", () => {
  it("accepts cancelling all of it, or part of it", () => {
    expect(refundCancellationRefusal({ amountCents: 10_000, leftCents: 10_000 })).toBeNull();
    expect(refundCancellationRefusal({ amountCents: 2_550, leftCents: 10_000 })).toBeNull();
  });

  it("refuses more than what is not cancelled yet", () => {
    expect(refundCancellationRefusal({ amountCents: 10_001, leftCents: 10_000 })).toBe(
      `L’annulation dépasse le montant du remboursement encore non annulé (${formatEuros(10_000)}).`,
    );
    expect(refundCancellationRefusal({ amountCents: 6_000, leftCents: 4_000 })).toBe(
      `L’annulation dépasse le montant du remboursement encore non annulé (${formatEuros(4_000)}).`,
    );
  });

  it("cancels down to the last cent, then nothing more", () => {
    // 100,00 € refunded: 99,99 € cancelled, then the last 0,01 €, then nothing.
    expect(refundCancellationRefusal({ amountCents: 9_999, leftCents: 10_000 })).toBeNull();
    const left = refundLeftCents({ amountCents: -10_000, cancelledCents: 9_999 });
    expect(left).toBe(1);
    expect(refundCancellationRefusal({ amountCents: 1, leftCents: left })).toBeNull();
    expect(refundCancellationRefusal({ amountCents: 2, leftCents: left })).not.toBeNull();
    expect(refundLeftCents({ amountCents: -10_000, cancelledCents: 10_000 })).toBe(0);
  });

  it("refuses a refund already cancelled in full", () => {
    expect(refundCancellationRefusal({ amountCents: 1, leftCents: 0 })).toBe("Ce remboursement est déjà annulé.");
  });

  it("refuses an amount that is not whole cents above 0", () => {
    for (const amountCents of [0, -100, 12.5])
      expect(refundCancellationRefusal({ amountCents, leftCents: 10_000 })).toBe("Indiquez un montant supérieur à 0.");
  });
});

describe("a refund cancellation in the books", () => {
  const cancellation = {
    id: "c",
    method: "cheque",
    amountCents: 10_000,
    correctedCents: 0,
    plannedPayment: null,
    depositId: null,
    reversalKind: "refund_cancellation" as const,
  };

  it("is told apart by its stored kind", () => {
    expect(isRefundCancellation(cancellation)).toBe(true);
    expect(isRefundCancellation({ reversalKind: "refund" })).toBe(false);
    expect(isRefundCancellation({ reversalKind: null })).toBe(false);
  });

  it("is never offered for a bank deposit, though positive and by cheque or cash", () => {
    const r = toDeposit([cancellation, { ...cancellation, id: "d", method: "cash" }], TODAY);
    expect(r.cheque).toEqual([]);
    expect(r.cash).toEqual([]);
  });

  it("is totalled with the refunds, never in its method's total", () => {
    expect(
      totals([
        { method: "cheque", amountCents: 28_000, reversalKind: null },
        { method: "cheque", amountCents: -10_000, reversalKind: "refund" as const },
        { method: "cheque", amountCents: 10_000, reversalKind: "refund_cancellation" as const },
        { method: "cash", amountCents: -3_000, reversalKind: "refund" as const },
        { method: "cash", amountCents: 1_000, reversalKind: "refund_cancellation" as const },
      ]),
    ).toEqual({ total: 26_000, byMethod: { cheque: 28_000 }, refunded: -2_000 });
  });

  it("is never money still to collect, even by cheque never deposited", () => {
    const c = {
      amountCents: 10_000,
      method: "cheque" as const,
      plannedPayment: null,
      deposited: false,
      correctedCents: 0,
      reversalKind: "refund_cancellation" as const,
    };
    expect(isUncollected(c, TODAY)).toBe(false);
    expect(uncollectedCents([c], TODAY)).toBe(0);
  });

  it("gives the overpayment back to the balance", () => {
    // 280,00 € due, 380,00 € paid, 100,00 € refunded by mistake then cancelled: 100,00 € overpaid again.
    const b = payerBalance(
      [{ status: "active", period: "year", netPriceCents: 28_000, quarterCount: 0 }],
      [],
      [
        { amountCents: 38_000, plannedPayment: null },
        { amountCents: -10_000, plannedPayment: null },
        { amountCents: 10_000, plannedPayment: null },
      ],
      TODAY,
    );
    expect(b.remaining).toBe(-10_000);
    expect(b.toCollect).toBe(0);
  });

  it("says what it is in the export, before the refund's reference", () => {
    expect(exportReference({ reversalKind: "refund_cancellation", reference: "R0001" })).toBe(
      "Annulation de remboursement, R0001",
    );
  });
});
