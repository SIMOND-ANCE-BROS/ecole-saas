"use server";

import { revalidatePath } from "next/cache";
import { withSchool } from "@/db";
import { saveRequirements, validRequirements } from "@/db/student-documents";
import type { Requirement } from "@/domain/people/documents";
import { actionResult, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

/** Documents the school asks for (#287): management only, checked before anything else. */
export async function saveDocumentRequirements(entry: Requirement[]): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director");
  const r = validRequirements.safeParse(entry);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Saisie invalide." };
  const saved = await withSchool(schoolId, (tx) => saveRequirements(tx, userId, r.data));
  revalidatePath("/parametres/documents");
  return actionResult(saved);
}
