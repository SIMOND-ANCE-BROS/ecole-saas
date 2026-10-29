/**
 * A payment rejected after its bank deposit (#253): a bounced cheque, or cash
 * or holiday vouchers refused at the counter. Recommended rule, pending the
 * school's validation: management only, recorded as its own dated reverse
 * entry, never added to the deposit slip, which stays as printed. The amount
 * is due again since the payer's balance is enrollments minus payments.
 */

/** Reference of the reverse entry of a rejected payment; a plain correction says « Correction ». */
export const REJECTED_REFERENCE = "Paiement rejeté";

/** Reference of the reverse entry of a payment that was not deposited. */
export const CORRECTION_REFERENCE = "Correction";

/** A reverse entry (negative payment) recording a rejection, rather than a plain correction. */
export const isRejection = (p: { amountCents: number; reference: string | null }) =>
  p.amountCents < 0 && p.reference === REJECTED_REFERENCE;

/** What the action is called for a deposited payment: « Chèque rejeté » for a cheque. */
export const rejectionLabel = (method: string) => (method === "cheque" ? "Chèque rejeté" : "Paiement rejeté");

/**
 * Why the day the bank returned a payment is refused, or null: it is a
 * `YYYY-MM-DD` date, not before the payment was received, not after today.
 */
export function rejectionDateRefusal(date: string, paymentDate: string, today: string): string | null {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  // A day that does not exist (31/02) reads as another one, or not at all.
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return "Date invalide";
  if (date < paymentDate) return "Le rejet ne peut pas précéder la réception du paiement.";
  if (date > today) return "Le rejet ne peut pas être daté après aujourd’hui.";
  return null;
}
