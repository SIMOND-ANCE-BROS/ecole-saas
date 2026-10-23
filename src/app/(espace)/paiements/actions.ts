"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withSchool } from "@/db";
import { correctPayment, collect } from "@/db/payments";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";

/** Return to the payer's record: only a student or contact record. */
const safeReturnPath = (r: unknown) =>
  typeof r === "string" && /^\/(eleves|contacts)\/[0-9a-f-]{36}$/.test(r) ? r : null;

/** Records one or more payments (front desk and management), then returns to the payer's record. */
export async function collectPayments(payerId: string, saisie: unknown, back: unknown): Promise<{ message: string }> {
  const { schoolId: schoolId, userId } = await requireRole("direction", "accueil");
  const r = await withSchool(schoolId, (tx) => collect(tx, userId, payerId, saisie as never));
  if (!r.ok) return { message: r.message };
  revalidatePath("/encaissements");
  redirect(`${safeReturnPath(back) ?? `/personnes/${payerId}`}?encaisse=${r.ids.length}`);
}

/** Corrects a payment with a negative payment: management only. */
export async function correct(
  paymentId: string,
  amountCents: number,
  back: unknown,
): Promise<{ message: string | null }> {
  const { schoolId: schoolId, userId } = await requireRole("direction");
  const r = await withSchool(schoolId, (tx) => correctPayment(tx, userId, paymentId, amountCents, todayInParis()));
  if (!r.ok) return { message: r.message };
  const path = safeReturnPath(back);
  if (path) revalidatePath(path);
  revalidatePath("/encaissements");
  return { message: null };
}
