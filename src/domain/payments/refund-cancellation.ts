import { formatEuros } from "../../lib/money";
import type { Role } from "../team/rules";
import type { ReversalKind } from "./rejection";

/**
 * Cancelling a refund entered by mistake (#346): wrong amount, method, date, payer or
 * business. A refund (#294) is a payment, immutable: it is cancelled by a positive reverse
 * entry of kind `refund_cancellation` whose `corrects_id` is the refund, same business and
 * method, dated today, at most what is not cancelled yet. Like the refund, it is never on a
 * deposit slip and is totalled with the refunds, never in its method's total.
 */

/**
 * Who cancels a refund: management only, as for a correction (#253). Default of #346
 * question 1, pending the school's answer. The only place it lives.
 */
export const CANCEL_REFUND_ROLES = ["director"] as const satisfies readonly Role[];
export const mayCancelRefund = (role: Role) => (CANCEL_REFUND_ROLES as readonly Role[]).includes(role);

/** The reverse entry cancelling a refund, told apart by its stored kind (#272). */
export const isRefundCancellation = (p: { reversalKind: ReversalKind | null }) =>
  p.reversalKind === "refund_cancellation";

/**
 * A refund or its cancellation: money paid back to a payer, totalled apart from what came
 * in by each method, never deposited at the bank.
 */
export const isRefundSide = (kind: ReversalKind | null | undefined) =>
  kind === "refund" || kind === "refund_cancellation";

/** What of a refund (negative amount) is not cancelled yet, as a positive amount. */
export const refundLeftCents = (refund: { amountCents: number; cancelledCents: number }): number =>
  Math.max(0, -refund.amountCents - refund.cancelledCents);

/** Why a cancellation of `amountCents` is refused, or null: whole cents above 0, at most `leftCents`. */
export function refundCancellationRefusal(r: { amountCents: number; leftCents: number }): string | null {
  if (!Number.isInteger(r.amountCents) || r.amountCents <= 0) return "Indiquez un montant supérieur à 0.";
  if (r.leftCents <= 0) return "Ce remboursement est déjà annulé.";
  if (r.amountCents > r.leftCents)
    return `L’annulation dépasse le montant du remboursement encore non annulé (${formatEuros(r.leftCents)}).`;
  return null;
}
