"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withSchool } from "@/db";
import { correctPayment, collect } from "@/db/payments";
import { todayInParis } from "@/domain/people/age";
import { type ActionResult, actionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

/** Return to the payer's record: only a student or contact record. */
const safeReturnPath = (r: unknown) =>
  typeof r === "string" && /^\/(eleves|contacts)\/[0-9a-f-]{36}$/.test(r) ? r : null;

/** Records one or more payments (front desk and management), then returns to the payer's record. */
export async function collectPayments(payerId: string, entry: unknown, back: unknown): Promise<{ message: string }> {
  const { schoolId: schoolId, userId } = await requireRole("director", "front_desk");
  const r = await withSchool(schoolId, (tx) => collect(tx, userId, payerId, entry as never));
  if (!r.ok) return { message: r.message };
  revalidatePath("/encaissements");
  redirect(`${safeReturnPath(back) ?? `/personnes/${payerId}`}?encaisse=${r.ids.length}`);
}

/** What the correction form sends: the payment, the amount in cents and the record to refresh. */
const validCorrection = z.object({
  paymentId: z.uuid(),
  amountCents: z.number().int().positive(),
  back: z.string().max(200).nullable(),
});

/** Corrects a payment with a negative payment: management only. */
export async function correct(correction: z.input<typeof validCorrection>): Promise<ActionResult> {
  const { schoolId: schoolId, userId } = await requireRole("director");
  const c = validCorrection.safeParse(correction);
  if (!c.success) return { ok: false, message: "Montant de la correction invalide." };
  const { paymentId, amountCents, back } = c.data;
  const r = await withSchool(schoolId, (tx) => correctPayment(tx, userId, paymentId, amountCents, todayInParis()));
  if (!r.ok) return actionResult(r);
  const path = safeReturnPath(back);
  if (path) revalidatePath(path);
  revalidatePath("/encaissements");
  return { ok: true };
}
