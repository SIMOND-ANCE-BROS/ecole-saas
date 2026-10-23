"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withSchool } from "@/db";
import { correctPayment, collect } from "@/db/paiements";
import { todayInParis } from "@/domaine/personnes/age";
import { requireRole } from "@/lib/session";

/** Retour vers la fiche du payeur : seulement une fiche élève ou contact. */
const safeReturnPath = (r: unknown) =>
  typeof r === "string" && /^\/(eleves|contacts)\/[0-9a-f-]{36}$/.test(r) ? r : null;

/** Encaisse un ou plusieurs règlements (accueil et direction), puis revient à la fiche du payeur. */
export async function collectPayments(payerId: string, saisie: unknown, back: unknown): Promise<{ message: string }> {
  const { schoolId: schoolId, userId } = await requireRole("direction", "accueil");
  const r = await withSchool(schoolId, (tx) => collect(tx, userId, payerId, saisie as never));
  if (!r.ok) return { message: r.message };
  revalidatePath("/encaissements");
  redirect(`${safeReturnPath(back) ?? `/personnes/${payerId}`}?encaisse=${r.ids.length}`);
}

/** Correction d'un paiement par un paiement négatif : direction seulement. */
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
