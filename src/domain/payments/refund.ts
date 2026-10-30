import { formatEuros } from "../../lib/money";
import type { Role } from "../team/rules";
import type { Method } from "./methods";
import type { ReversalKind } from "./rejection";

/**
 * Refunding a payer (#294): a family paid in full, then brings a works council (CSE)
 * cheque for the same enrollment; the school takes it and pays the family back. The
 * refund is money going out: a negative payment of kind `refund` (no payment it
 * cancels), cashed out by the business that holds the overpayment, never on a deposit
 * slip. The invoice is unchanged (#294 question 2, default « refund only », pending the
 * accountant). At most what that business received in excess (`refundable`).
 */

/**
 * How a school pays a family back. Default of #294 question 1, pending the school's
 * answer: cheque, cash or transfer, chosen at the desk. The only place this list lives.
 */
export const REFUND_METHODS = ["cheque", "cash", "transfer"] as const satisfies readonly Method[];
export type RefundMethod = (typeof REFUND_METHODS)[number];
export const isRefundMethod = (method: string): method is RefundMethod =>
  (REFUND_METHODS as readonly string[]).includes(method);

/**
 * Who records a refund: management, as for a correction or a rejected payment (#253),
 * since the issue gives no rule for it (question asked on #294). The only place it lives.
 */
export const REFUND_ROLES = ["director"] as const satisfies readonly Role[];
export const mayRefund = (role: Role) => (REFUND_ROLES as readonly Role[]).includes(role);

/** A refund, told apart from a correction or a rejection by its stored kind (#272). */
export const isRefund = (p: { reversalKind: ReversalKind | null }) => p.reversalKind === "refund";

/** The overpaid amount of a balance (negative remaining), else nothing. */
export const overpaidOf = (balance: { remaining: number }): number => Math.max(0, -balance.remaining);

/**
 * Methods whose money is only in once the paper is deposited: a cheque or a paper holiday
 * voucher in the drawer can still bounce or be refused (#253). Cash in hand, a transfer, a
 * card or an online voucher is received when recorded. Until the school answers (#294), a
 * refund is never paid out of money not collected yet: this list and `isUncollected` are
 * the only place that rule lives.
 */
export const COLLECTED_ON_DEPOSIT = ["cheque", "holiday_voucher"] as const satisfies readonly Method[];

/** A payment as the refund reads it: its method, cashing date, deposit, what corrections cancelled and its kind. */
export type CollectablePayment = {
  amountCents: number;
  method: Method;
  plannedPayment: string | null;
  deposited: boolean;
  correctedCents: number;
  reversalKind: ReversalKind | null;
};

/**
 * A payment counted in the balance whose money is not in yet: a cheque to cash after today
 * (« à encaisser plus tard »), or a cheque or paper voucher not deposited at the bank yet.
 * Never a reverse entry: the cancellation of a refund (#346), positive and of the refund's
 * method, gives back money already collected, it never waits for a deposit.
 */
export const isUncollected = (p: CollectablePayment, today: string): boolean =>
  p.reversalKind === null &&
  p.amountCents > 0 &&
  ((p.plannedPayment !== null && p.plannedPayment > today) ||
    (!p.deposited && (COLLECTED_ON_DEPOSIT as readonly Method[]).includes(p.method)));

/** What the payer handed in but the school has not collected yet, net of corrections. */
export const uncollectedCents = (payments: readonly CollectablePayment[], today: string): number =>
  payments
    .filter((p) => isUncollected(p, today))
    .reduce((s, p) => s + Math.max(0, p.amountCents - p.correctedCents), 0);

/**
 * What enrollments on trial or on the waitlist would cost (`Balance.outsideCalculation`):
 * not due yet, so a payment made for them reads as an overpayment. Whether that advance may
 * be paid back before the enrollment is confirmed or cancelled is not a written rule (asked
 * on #294): until answered it is held back from any refund. The only place it lives.
 */
export const heldForPendingEnrollments = (outsideCalculation: Readonly<Record<string, number | undefined>>): number =>
  Object.values(outsideCalculation).reduce<number>((s, v) => s + (v ?? 0), 0);

/**
 * What can be paid back (#294): the overpayment, less what of it is not collected yet (a
 * refund is never paid out of a cheque that may bounce or is to be cashed later) and less
 * what is held for enrollments on trial or on the waitlist (`heldForPendingEnrollments`).
 */
export const refundableCents = (overpaidCents: number, uncollected: number, held = 0): number =>
  Math.max(0, overpaidCents - Math.max(0, uncollected) - Math.max(0, held));

/**
 * Why a refund is refused, or null: an amount in whole cents above 0, an overpayment,
 * never more than `refundableCents` (the overpayment already collected, less what is held
 * for pending enrollments), dated a real day not after today. `uncollectedCents` tells why
 * part of the overpayment cannot be paid back yet.
 */
export function refundRefusal(r: {
  amountCents: number;
  overpaidCents: number;
  refundableCents: number;
  uncollectedCents: number;
  date: string;
  today: string;
}): string | null {
  if (!Number.isInteger(r.amountCents) || r.amountCents <= 0) return "Indiquez un montant supérieur à 0.";
  if (r.overpaidCents <= 0) return "Rien à rembourser : ce payeur n’a pas de trop-perçu.";
  if (r.refundableCents <= 0)
    return r.uncollectedCents > 0
      ? "Le trop-perçu n’est pas encore encaissé : remettez d’abord les chèques en banque."
      : "Le trop-perçu couvre une inscription à l’essai ou en liste d’attente : rien à rembourser avant qu’elle soit confirmée ou annulée.";
  if (r.amountCents > r.refundableCents)
    return r.refundableCents < r.overpaidCents
      ? `Le remboursement dépasse ce qui peut être remboursé (${formatEuros(r.refundableCents)}) : le reste attend l’encaissement de chèques ou couvre une inscription à l’essai ou en liste d’attente.`
      : `Le remboursement dépasse le trop-perçu (${formatEuros(r.overpaidCents)}) : rechargez la fiche.`;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? new Date(`${r.date}T00:00:00Z`) : null;
  // A day that does not exist (31/02) reads as another one, or not at all.
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== r.date)
    return "Date invalide.";
  if (r.date > r.today) return "Le remboursement ne peut pas être daté après aujourd’hui.";
  return null;
}
