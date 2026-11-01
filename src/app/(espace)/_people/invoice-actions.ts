"use server";

import { z } from "zod";
import { withSchool } from "@/db";
import { draftForPayer } from "@/db/payer-invoices";
import { currentSeason, seasonById } from "@/db/schedule";
import { DRAFT_ROLES, ENDED_SEASON, seasonDraftable } from "@/domain/invoicing/progress";
import { todayInParis } from "@/domain/people/age";
import { sendSoon } from "@/jobs/invoicing/send";
import type { ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

const validDraft = z.object({ payerId: z.uuid(), seasonId: z.uuid() });

/**
 * Drafts the payer's invoices of the season again (#352): one per business, replacing the
 * unsent drafts in place (`draftPayerInvoices`), so a retry after a lost answer drafts the same
 * invoices, never a second set. Once committed, the sending is woken (`sendSoon`): a draft whose
 * installments cover its total goes to its business's tool, the others wait (#176).
 * The season is the one the record shows (#362): an ended season other than the current one
 * is refused (`seasonDraftable`, #380 open). An unknown one is refused by `draftPayerInvoices`.
 */
export async function draftInvoices(entry: z.input<typeof validDraft>): Promise<ActionResult<{ drafted: number }>> {
  const { schoolId, userId } = await requireRole(...DRAFT_ROLES);
  const p = validDraft.safeParse(entry);
  if (!p.success) return { ok: false, message: "Factures non préparées : rechargez la fiche." };
  const today = todayInParis();
  const r = await withSchool(schoolId, async (tx) => {
    const season = await seasonById(tx, p.data.seasonId);
    if (season && !seasonDraftable(season, (await currentSeason(tx, today))?.id, today))
      return { ok: false as const, message: ENDED_SEASON(season.label) };
    return draftForPayer(tx, userId, p.data.payerId, p.data.seasonId);
  });
  if (!r.ok) return r;
  // After the commit: `withSchool` has returned. The sending runs once the answer is gone.
  if (r.invoiceIds.length > 0) sendSoon(schoolId);
  return { ok: true, drafted: r.invoiceIds.length };
}
