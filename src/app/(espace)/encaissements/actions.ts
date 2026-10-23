"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withSchool } from "@/db";
import { cancelDeposit, createDeposit } from "@/db/deposits";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";

/** Creates a bank deposit (front desk and management) then opens its deposit slip. */
export async function deposit(entry: unknown): Promise<{ message: string }> {
  const { schoolId: schoolId, userId } = await requireRole("director", "front_desk");
  const r = await withSchool(schoolId, (tx) => createDeposit(tx, userId, entry as never, todayInParis()));
  if (!r.ok) return { message: r.message };
  revalidatePath("/encaissements");
  redirect(`/encaissements/remises/${r.id}?cree=1`);
}

/** Cancels a bank deposit made by mistake: management only. */
export async function cancel(id: string): Promise<{ message: string }> {
  const { schoolId: schoolId, userId } = await requireRole("director");
  const r = await withSchool(schoolId, (tx) => cancelDeposit(tx, userId, id));
  if (!r.ok) return { message: r.message };
  revalidatePath("/encaissements");
  redirect("/encaissements?vue=remettre&annulee=1");
}
