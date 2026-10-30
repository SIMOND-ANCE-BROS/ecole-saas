import type { Method } from "./methods";
import { frenchDate } from "../../lib/dates";

/**
 * A payment rejected after its bank deposit (#253): a bounced cheque, or cash
 * or holiday vouchers refused at the counter. Recommended rule, pending the
 * school's validation: management only, for the whole amount not yet
 * corrected (a bank rejects a whole cheque), recorded as its own dated reverse
 * entry, never added to the deposit slip, which stays as printed. The amount
 * is due again since the payer's balance is enrollments minus payments.
 */

/**
 * Kind of a reverse entry (`payment.reversal_kind`, #272): a correction of a
 * payment not deposited, or the rejection of a deposited one. Stored as data, so
 * rewording a label never reclassifies a row; NULL for an ordinary payment.
 */
export const REVERSAL_KINDS = ["correction", "rejection"] as const;
export type ReversalKind = (typeof REVERSAL_KINDS)[number];

/** What a reverse entry is called on screen and in the export. */
export const REVERSAL_LABELS: Record<ReversalKind, string> = {
  correction: "Correction",
  rejection: "Paiement rejeté",
};

/** The label of a reverse entry, or null for an ordinary payment. */
export const reversalLabel = (kind: ReversalKind | null): string | null => (kind ? REVERSAL_LABELS[kind] : null);

/** A reverse entry (negative payment) recording a rejection, rather than a plain correction. */
export const isRejection = (p: { reversalKind: ReversalKind | null }) => p.reversalKind === "rejection";

/** What the action is called for a deposited payment: « Chèque rejeté » for a cheque. */
export const rejectionLabel = (method: Method) => (method === "cheque" ? "Chèque rejeté" : "Paiement rejeté");

/** Why no rejection can be recorded yet, or null: the deposit is dated after today. */
export const rejectionNotYet = (depositedOn: string, today: string): string | null =>
  depositedOn > today
    ? `La remise est datée du ${frenchDate(depositedOn)} : un rejet ne peut être enregistré qu’à partir de cette date.`
    : null;

/**
 * Why the day the bank returned a payment is refused, or null: the deposit is
 * not dated after today, and the day is a `YYYY-MM-DD` date, not before the
 * bank deposit, not after today.
 */
export function rejectionDateRefusal(date: string, depositedOn: string, today: string): string | null {
  const notYet = rejectionNotYet(depositedOn, today);
  if (notYet) return notYet;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  // A day that does not exist (31/02) reads as another one, or not at all.
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return "Date invalide.";
  if (date < depositedOn) return "Le rejet ne peut pas précéder la remise en banque.";
  if (date > today) return "Le rejet ne peut pas être daté après aujourd’hui.";
  return null;
}
