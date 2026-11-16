"use server";

import { revalidatePath } from "next/cache";
import { withSchool } from "@/db";
import { saveInstallmentPlans, validInstallmentPlans } from "@/db/installment-plans";
import type { InstallmentPlanSetting } from "@/domain/invoicing/plans";
import { actionResult, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

/** The school's installment plans (#176): management only, checked before anything else. */
export async function saveInstallmentPlanSetting(entry: InstallmentPlanSetting): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director");
  const r = validInstallmentPlans.safeParse(entry);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Saisie invalide." };
  const saved = await withSchool(schoolId, (tx) => saveInstallmentPlans(tx, userId, r.data));
  revalidatePath("/parametres/echeances");
  return actionResult(saved);
}
