"use server";

import { revalidatePath } from "next/cache";
import { withSchool } from "@/db";
import { saveMethodSettings, validMethodSettings } from "@/db/payment-methods";
import type { MethodSetting } from "@/domain/payments/methods";
import { actionResult, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

/** Payment methods the school accepts (#293): management only, checked before anything else. */
export async function savePaymentMethods(entry: MethodSetting[]): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director");
  const r = validMethodSettings.safeParse(entry);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Saisie invalide." };
  const saved = await withSchool(schoolId, (tx) => saveMethodSettings(tx, userId, r.data));
  revalidatePath("/parametres/moyens-de-paiement");
  return actionResult(saved);
}
