"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSchool } from "@/db";
import { addReferralSource, removeReferralSource, renameReferralSource, saveRulesText } from "@/db/internal-rules";
import { actionResult, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

/**
 * Internal rules of each season and answers to « Comment nous avez-vous
 * connus ? » (#296): management only, checked before anything else. Typed for
 * the call sites, still parsed: a server action receives whatever the browser sends.
 */

const PAGE = "/parametres/inscription";
const validId = z.uuid();
const validText = z.string();

/** The season's rules text (or version name): a changed text is a new version. */
export async function saveSeasonRules(seasonId: string, text: string): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director");
  const id = validId.safeParse(seasonId);
  const t = validText.safeParse(text);
  if (!id.success || !t.success) return { ok: false, message: "Saisie invalide." };
  const r = await withSchool(schoolId, (tx) => saveRulesText(tx, userId, id.data, t.data));
  revalidatePath(PAGE);
  return actionResult(r);
}

export async function newReferral(label: string): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director");
  const t = validText.safeParse(label);
  if (!t.success) return { ok: false, message: "Saisie invalide." };
  const r = await withSchool(schoolId, (tx) => addReferralSource(tx, userId, t.data));
  revalidatePath(PAGE);
  return actionResult(r);
}

export async function renameReferral(id: string, label: string): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director");
  const i = validId.safeParse(id);
  const t = validText.safeParse(label);
  if (!i.success || !t.success) return { ok: false, message: "Saisie invalide." };
  const r = await withSchool(schoolId, (tx) => renameReferralSource(tx, userId, i.data, t.data));
  revalidatePath(PAGE);
  return actionResult(r);
}

export async function removeReferral(id: string): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director");
  const i = validId.safeParse(id);
  if (!i.success) return { ok: false, message: "Cette réponse n’existe plus." };
  const r = await withSchool(schoolId, (tx) => removeReferralSource(tx, userId, i.data));
  revalidatePath(PAGE);
  return actionResult(r);
}
