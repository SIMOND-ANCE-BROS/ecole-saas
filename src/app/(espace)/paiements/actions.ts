"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withSchool } from "@/db";
import { cancelRefundPayment, correctPayment, collect, refundPayer } from "@/db/payments";
import { REFUND_METHODS, REFUND_ROLES } from "@/domain/payments/refund";
import { CANCEL_REFUND_ROLES } from "@/domain/payments/refund-cancellation";
import { once, storedPayments } from "@/db/submissions";
import { todayInParis } from "@/domain/people/age";
import { type ActionResult, actionResult } from "@/lib/action-result";
import { topErrorsOf } from "@/lib/form-errors";
import { requireRole } from "@/lib/session";

/** Return to the payer's record: only a student or contact record. */
const safeReturnPath = (r: unknown) =>
  typeof r === "string" && /^\/(eleves|contacts)\/[0-9a-f-]{36}$/.test(r) ? r : null;

/**
 * Records one or more payments (front desk and management), then returns to
 * the payer's record. `key` is generated once by the form: a retry after a lost
 * response records nothing new (#260). `billingEntityId`: the entity chosen to
 * cash them, sent only when the school has several (#300).
 */
export async function collectPayments(
  payerId: string,
  entry: unknown,
  back: unknown,
  key: string,
  billingEntityId?: unknown,
): Promise<{ message: string }> {
  const { schoolId: schoolId, userId } = await requireRole("director", "front_desk");
  if (!z.uuid().safeParse(key).success) return { message: "Saisie invalide." };
  const entity = z.uuid().optional().safeParse(billingEntityId);
  if (!entity.success) return { message: "Choisissez l’entreprise qui encaisse ce paiement." };
  const r = await withSchool(schoolId, (tx) =>
    once(tx, "payment", key, { payerId, entry, billingEntityId: entity.data }, storedPayments, () =>
      collect(tx, userId, payerId, entry as never, entity.data),
    ),
  );
  if (!r.ok) return { message: r.message };
  revalidatePath("/encaissements");
  redirect(`${safeReturnPath(back) ?? `/personnes/${payerId}`}?encaisse=${r.ids.length}`);
}

/**
 * What the correction form sends: the payment, the amount in cents, the record
 * to refresh, for a payment already deposited the day the bank returned it (#253),
 * and the key generated once per opening of the form (#260).
 */
const validCorrection = z.object({
  paymentId: z.uuid(),
  amountCents: z.number().int().positive(),
  back: z.string().max(200).nullable(),
  rejectedOn: z.iso.date().nullable().default(null),
  key: z.uuid(),
});

/** Corrects a payment, or records a deposited one as rejected, with a negative payment: management only. */
export async function correct(correction: z.input<typeof validCorrection>): Promise<ActionResult> {
  const { schoolId: schoolId, userId } = await requireRole("director");
  const c = validCorrection.safeParse(correction);
  if (!c.success) {
    // Only the amount and the date are typed by the user; a tampered id or return path cannot be fixed in a field.
    const errors = topErrorsOf(c.error);
    const fields = Object.keys(errors);
    const only = (field: keyof typeof errors) => errors[field] !== undefined && fields.length === 1;
    return {
      ok: false,
      message: only("amountCents")
        ? "Montant de la correction invalide."
        : only("rejectedOn")
          ? "Date du rejet invalide."
          : "Correction impossible : rechargez la fiche.",
    };
  }
  const { paymentId, amountCents, back, rejectedOn, key } = c.data;
  // A retry after a lost response returns the first result instead of a second reverse entry.
  const r = await withSchool(schoolId, (tx) =>
    once(tx, "payment", key, { paymentId, amountCents, rejectedOn }, storedPayments, () =>
      correctPayment(tx, userId, paymentId, amountCents, todayInParis(), rejectedOn),
    ),
  );
  if (!r.ok) return actionResult(r);
  const path = safeReturnPath(back);
  if (path) revalidatePath(path);
  revalidatePath("/encaissements");
  return { ok: true };
}

/**
 * What the refund form sends (#294): the payer, the entity paying back (only when the
 * school has several), how, how much and when, an optional cheque number, the record to
 * refresh, and the key generated once per opening of the form (#260).
 */
const validRefundRequest = z.object({
  payerId: z.uuid(),
  billingEntityId: z.uuid().optional(),
  method: z.enum(REFUND_METHODS),
  amountCents: z.number().int().positive(),
  date: z.iso.date(),
  reference: z.string().max(60).nullable().default(null),
  back: z.string().max(200).nullable(),
  key: z.uuid(),
});

/** Pays a payer back their overpayment with a negative payment of kind `refund`: management only (#294). */
export async function refund(request: z.input<typeof validRefundRequest>): Promise<ActionResult> {
  const { schoolId: schoolId, userId } = await requireRole(...REFUND_ROLES);
  const c = validRefundRequest.safeParse(request);
  if (!c.success) {
    // The amount, the method and the date are typed or chosen; anything else is a stale or tampered form.
    const errors = topErrorsOf(c.error);
    const fields = Object.keys(errors);
    const only = (field: keyof typeof errors) => errors[field] !== undefined && fields.length === 1;
    return {
      ok: false,
      message: only("amountCents")
        ? "Montant du remboursement invalide."
        : only("date")
          ? "Date du remboursement invalide."
          : only("method")
            ? "Choisissez comment vous remboursez."
            : only("reference")
              ? "Référence trop longue (60 caractères au plus)."
              : "Remboursement impossible : rechargez la fiche.",
    };
  }
  const { payerId, billingEntityId, method, amountCents, date, reference, back, key } = c.data;
  const entry = { method, amountCents, date, reference };
  // A retry after a lost response returns the first result instead of a second refund.
  const r = await withSchool(schoolId, (tx) =>
    once(tx, "payment", key, { refund: { payerId, billingEntityId, entry } }, storedPayments, () =>
      refundPayer(tx, userId, payerId, entry, todayInParis(), billingEntityId),
    ),
  );
  if (!r.ok) return actionResult(r);
  const path = safeReturnPath(back);
  if (path) revalidatePath(path);
  revalidatePath("/encaissements");
  return { ok: true };
}

/**
 * What the refund cancellation form sends (#346): the refund, the amount in cents, the
 * record to refresh, and the key generated once per opening of the form (#260).
 */
const validRefundCancellation = z.object({
  refundId: z.uuid(),
  amountCents: z.number().int().positive(),
  back: z.string().max(200).nullable(),
  key: z.uuid(),
});

/** Cancels all or part of a refund entered by mistake with a positive reverse entry: management only (#346). */
export async function cancelRefund(cancellation: z.input<typeof validRefundCancellation>): Promise<ActionResult> {
  const { schoolId: schoolId, userId } = await requireRole(...CANCEL_REFUND_ROLES);
  const c = validRefundCancellation.safeParse(cancellation);
  if (!c.success) {
    // Only the amount is typed by the user; a tampered id or return path cannot be fixed in a field.
    const errors = topErrorsOf(c.error);
    const only = errors.amountCents !== undefined && Object.keys(errors).length === 1;
    return {
      ok: false,
      message: only ? "Montant de l’annulation invalide." : "Annulation impossible : rechargez la fiche.",
    };
  }
  const { refundId, amountCents, back, key } = c.data;
  // A retry after a lost response returns the first result instead of a second cancellation.
  const r = await withSchool(schoolId, (tx) =>
    once(tx, "payment", key, { cancelRefund: { refundId, amountCents } }, storedPayments, () =>
      cancelRefundPayment(tx, userId, refundId, amountCents, todayInParis()),
    ),
  );
  if (!r.ok) return actionResult(r);
  const path = safeReturnPath(back);
  if (path) revalidatePath(path);
  revalidatePath("/encaissements");
  return { ok: true };
}
