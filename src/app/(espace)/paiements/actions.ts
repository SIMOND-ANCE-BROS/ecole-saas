"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withSchool } from "@/db";
import { correctPayment, collect } from "@/db/payments";
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
 * response records nothing new (#260).
 */
export async function collectPayments(
  payerId: string,
  entry: unknown,
  back: unknown,
  key: string,
): Promise<{ message: string }> {
  const { schoolId: schoolId, userId } = await requireRole("director", "front_desk");
  if (!z.uuid().safeParse(key).success) return { message: "Saisie invalide." };
  const r = await withSchool(schoolId, (tx) =>
    once(tx, "payment", key, { payerId, entry }, storedPayments, () => collect(tx, userId, payerId, entry as never)),
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
