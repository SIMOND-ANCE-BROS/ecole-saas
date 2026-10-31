"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withSchool } from "@/db";
import { acceptRules, removeRulesAcceptance, setReferral, setRefusesPhotos } from "@/db/internal-rules";
import { currentSeason } from "@/db/schedule";
import { todayInParis } from "@/domain/people/age";
import { actionResult, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

/**
 * Internal rules, photos and « Comment nous avez-vous connus ? » on the
 * student and payer records (#296): front desk and management. Typed for the
 * call sites, still parsed: a server action receives whatever the browser sends.
 * The season is always the current one, read on the server.
 */

const validId = z.uuid();
const NO_SEASON = "Aucune saison n’est paramétrée.";

/** Both records show the rules: a payer's change shows on their students' records too. */
function refreshRecords() {
  revalidatePath("/eleves/[id]", "page");
  revalidatePath("/contacts/[id]", "page");
}

/** « Règlement signé le … »: a new acceptance, or its date corrected. */
export async function signRules(payerId: string, acceptedOn: string): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  const id = validId.safeParse(payerId);
  if (!id.success) return { ok: false, message: "Ce payeur n’existe plus." };
  const today = todayInParis();
  const r = await withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, today);
    if (!season) return { ok: false as const, message: NO_SEASON };
    return acceptRules(tx, userId, id.data, season.id, acceptedOn, today);
  });
  refreshRecords();
  return actionResult(r);
}

/** Back to « non signé »; the audit log keeps what was recorded. */
export async function unsignRules(payerId: string): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  const id = validId.safeParse(payerId);
  if (!id.success) return { ok: false, message: "Ce payeur n’existe plus." };
  const r = await withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, todayInParis());
    if (!season) return { ok: false as const, message: NO_SEASON };
    return removeRulesAcceptance(tx, userId, id.data, season.id);
  });
  refreshRecords();
  return actionResult(r);
}

/** « Refuse les photos » noted, or withdrawn. */
export async function markPhotos(studentId: string, refuses: boolean): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  const id = validId.safeParse(studentId);
  const value = z.boolean().safeParse(refuses);
  if (!id.success || !value.success) return { ok: false, message: "Saisie invalide." };
  const r = await withSchool(schoolId, (tx) => setRefusesPhotos(tx, userId, id.data, value.data));
  revalidatePath(`/eleves/${id.data}`);
  return actionResult(r);
}

/** The student's answer to « Comment nous avez-vous connus ? »; null clears it. */
export async function chooseReferral(studentId: string, sourceId: string | null): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director", "front_desk");
  const id = validId.safeParse(studentId);
  const source = validId.nullable().safeParse(sourceId);
  if (!id.success || !source.success) return { ok: false, message: "Saisie invalide." };
  const r = await withSchool(schoolId, (tx) => setReferral(tx, userId, id.data, source.data));
  revalidatePath(`/eleves/${id.data}`);
  return actionResult(r);
}
