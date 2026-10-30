import { type CollectablePayment, isUncollected } from "./refund";
import type { ReversalKind } from "./rejection";

/**
 * Allocating payments to installments (#305, locking rules #254). A payment settles the
 * installments of its own billing entity only (ADR 0006: the database refuses any other),
 * oldest due date first, in integer cents; what no open installment needs stays
 * unallocated. Only money already collected is allocated, as for refunds (#294,
 * `isUncollected`): a cheque in the drawer, or one to cash later, waits for its deposit.
 */

/**
 * The invoices whose installments payments settle, and whose amount a balance counts
 * (#305): issued ones only. A draft (`to_send`) has no legal existence and is drafted again
 * freely (#302), an invoice handed to the tool may still be refused by it; their enrollments
 * and packs stay counted from their price. The only place this rule lives.
 */
export const SETTLED_INVOICE_STATUS = "issued" as const;

/** Installment statuses still waiting for money (as the `installment_open` index lists them). */
export const OPEN_INSTALLMENT_STATUSES = ["upcoming", "partial", "overdue"] as const;

/** A payment as the allocation reads it: collectable, what corrections cancelled and what it already settles. */
export type AllocatablePayment = CollectablePayment & {
  id: string;
  reversalKind: ReversalKind | null;
  /** Sum of this payment's allocations already written. */
  allocatedCents: number;
};

/** An installment still open (upcoming, partial or overdue), with what payments already settle of it. */
export type OpenInstallment = {
  id: string;
  invoiceId: string;
  rank: number;
  dueDate: string;
  amountCents: number;
  allocatedCents: number;
};

export type Allocation = { paymentId: string; installmentId: string; amountCents: number };

/**
 * FIFO order of #305 question 1, default « by installment due date across the entity's
 * invoices » (pending the school's confirmation): the oldest due date first, whatever the
 * invoice, then invoice and rank so that the order is always the same. The only place
 * this rule lives.
 */
export function byOldestDue(
  a: Pick<OpenInstallment, "dueDate" | "invoiceId" | "rank">,
  b: Pick<OpenInstallment, "dueDate" | "invoiceId" | "rank">,
): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (a.invoiceId !== b.invoiceId) return a.invoiceId < b.invoiceId ? -1 : 1;
  return a.rank - b.rank;
}

/**
 * Whether a payment's money counts as collected for an allocation: as for refunds
 * (`isUncollected`), except that a payment on a bank deposit slip counts as collected even
 * when the slip is dated after its planned cashing day passes today (a deposit may be dated
 * ahead, #98): once the paper is handed to the bank, nothing else will come to settle it. A
 * cheque the bank returns is cancelled by its rejection (`correctedCents`). Pending the
 * school's confirmation (#305 open question); the only place this rule lives.
 */
export const isCollectedForAllocation = (p: CollectablePayment, today: string): boolean =>
  p.deposited || !isUncollected(p, today);

/**
 * What a payment may still settle: its amount net of corrections and rejections, less what
 * it already settles; nothing while its money is not collected, nothing for a reverse entry.
 */
export function availableCents(p: AllocatablePayment, today: string): number {
  if (p.amountCents <= 0 || p.reversalKind !== null || !isCollectedForAllocation(p, today)) return 0;
  return Math.max(0, p.amountCents - p.correctedCents - p.allocatedCents);
}

/**
 * What all of a payer's payments to one entity may still settle together: each payment's
 * `availableCents`, less what was refunded to the payer (#294) and not cancelled since
 * (#346: a refund's `correctedCents` is what its cancellations gave back). A refund cancels no
 * payment in particular, so it is taken from the pool, never from one payment; a refund
 * cancellation, positive, offers nothing by itself (`availableCents`), it only shrinks its refund.
 * Taking refunds from what is not allocated yet holds because a refund is only ever paid out of
 * an overpayment (`refundRefusal`), money no installment needs.
 */
export function entityPoolCents(payments: readonly AllocatablePayment[], today: string): number {
  const refunded = payments
    .filter((p) => p.reversalKind === "refund")
    .reduce((s, p) => s + Math.max(0, -p.amountCents - p.correctedCents), 0);
  const available = payments.reduce((s, p) => s + availableCents(p, today), 0);
  return Math.max(0, available - refunded);
}

/**
 * Allocates `payments`, in the order given, over the open installments FIFO (`byOldestDue`),
 * never more than `poolCents` in all (`entityPoolCents`), each payment within its
 * `availableCents`, each installment within what it still owes. The remainder stays
 * unallocated. Payments and installments are the same entity's: the caller groups them.
 */
export function allocateFifo(
  payments: readonly AllocatablePayment[],
  installments: readonly OpenInstallment[],
  poolCents: number,
  today: string,
): Allocation[] {
  const open = [...installments].sort(byOldestDue).map((i) => ({ id: i.id, left: i.amountCents - i.allocatedCents }));
  const out: Allocation[] = [];
  let pool = Math.max(0, poolCents);
  for (const p of payments) {
    let left = Math.min(availableCents(p, today), pool);
    for (const i of open) {
      if (left <= 0) break;
      if (i.left <= 0) continue;
      const take = Math.min(left, i.left);
      out.push({ paymentId: p.id, installmentId: i.id, amountCents: take });
      i.left -= take;
      left -= take;
      pool -= take;
    }
  }
  return out;
}

/** An allocation already written, as `releaseExcess` reads it. */
export type HeldAllocation = Pick<OpenInstallment, "invoiceId" | "rank" | "dueDate"> & {
  paymentId: string;
  installmentId: string;
  amountCents: number;
};

/**
 * What allocations become once they may hold only `keepCents` in all: one payment's after a
 * correction, a rejected cheque or a cancelled deposit, or all of a payer's with one entity
 * once refunds leave less money than they hold (`heldCapCents`). Taken back from the latest
 * due installment first, so the oldest stays paid; on one installment, from the latest
 * payment id first so that the order is always the same. Returns the allocations to change
 * with their new amount, 0 meaning deleted.
 */
export function releaseExcess<T extends HeldAllocation>(allocations: readonly T[], keepCents: number): T[] {
  let excess = allocations.reduce((s, a) => s + a.amountCents, 0) - Math.max(0, keepCents);
  const out: T[] = [];
  const order = [...allocations].sort(
    (a, b) => byOldestDue(a, b) || (a.paymentId < b.paymentId ? -1 : a.paymentId > b.paymentId ? 1 : 0),
  );
  for (const a of order.reverse()) {
    if (excess <= 0) break;
    const back = Math.min(excess, a.amountCents);
    out.push({ ...a, amountCents: a.amountCents - back });
    excess -= back;
  }
  return out;
}

/**
 * What all of a payer's allocations with one entity may hold: their collected money net of
 * corrections, less refunds not cancelled (`entityPoolCents` before any allocation). A
 * correction made after a refund can leave less than that: `releaseExcess` then takes back
 * the difference across the payer's payments.
 */
export const heldCapCents = (payments: readonly AllocatablePayment[], today: string): number =>
  entityPoolCents(
    payments.map((p) => ({ ...p, allocatedCents: 0 })),
    today,
  );

export type InstallmentStatus = "upcoming" | "paid" | "partial" | "overdue" | "cancelled";

/** An open installment's status from what is allocated to it: paid, partial, overdue past its due date, else upcoming. */
export function installmentStatusOf(
  i: { amountCents: number; allocatedCents: number; dueDate: string },
  today: string,
): Exclude<InstallmentStatus, "cancelled"> {
  if (i.allocatedCents >= i.amountCents) return "paid";
  if (i.allocatedCents > 0) return "partial";
  return i.dueDate < today ? "overdue" : "upcoming";
}

/**
 * Why an allocation is refused, or null (#254): an amount in whole cents above 0, within
 * what the payment still offers net of its corrections (`availableCents`) and within what
 * the installment still owes.
 */
export function allocationRefusal(a: { amountCents: number; availableCents: number; remainingCents: number }) {
  if (!Number.isInteger(a.amountCents) || a.amountCents <= 0) return "Montant d’affectation invalide.";
  if (a.amountCents > a.availableCents)
    return "L’affectation dépasse ce qui reste du paiement après ses corrections : rechargez la fiche.";
  if (a.amountCents > a.remainingCents)
    return "L’affectation dépasse ce qui reste à payer sur l’échéance : rechargez la fiche.";
  return null;
}
