"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withSchool } from "@/db";
import { cancelDeposit, createDeposit } from "@/db/remises";
import { todayInParis } from "@/domaine/personnes/age";
import { requireRole } from "@/lib/session";

/** Crée une remise (accueil et direction) puis ouvre son bordereau. */
export async function deposit(saisie: unknown): Promise<{ message: string }> {
  const { schoolId: schoolId, userId } = await requireRole("direction", "accueil");
  const r = await withSchool(schoolId, (tx) => createDeposit(tx, userId, saisie as never, todayInParis()));
  if (!r.ok) return { message: r.message };
  revalidatePath("/encaissements");
  redirect(`/encaissements/remises/${r.id}?cree=1`);
}

/** Annule une remise faite par erreur : direction seulement. */
export async function cancel(id: string): Promise<{ message: string }> {
  const { schoolId: schoolId, userId } = await requireRole("direction");
  const r = await withSchool(schoolId, (tx) => cancelDeposit(tx, userId, id));
  if (!r.ok) return { message: r.message };
  revalidatePath("/encaissements");
  redirect("/encaissements?vue=remettre&annulee=1");
}
