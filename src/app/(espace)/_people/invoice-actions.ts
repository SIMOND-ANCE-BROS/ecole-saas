"use server";

import { z } from "zod";
import { withSchool } from "@/db";
import { draftForPayer } from "@/db/payer-invoices";
import { DRAFT_ROLES } from "@/domain/invoicing/progress";
import { sendSoon } from "@/jobs/invoicing/send";
import type { ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

const validDraft = z.object({ payerId: z.uuid(), seasonId: z.uuid() });

/**
 * Drafts the payer's invoices of the season again (#352): one per business, replacing the
 * unsent drafts in place (`draftPayerInvoices`), so a retry after a lost answer drafts the same
 * invoices, never a second set. Once committed, the sending is woken (`sendSoon`): a draft whose
 * installments cover its total goes to its business's tool, the others wait (#176).
 */
export async function draftInvoices(entry: z.input<typeof validDraft>): Promise<ActionResult<{ drafted: number }>> {
  const { schoolId, userId } = await requireRole(...DRAFT_ROLES);
  const p = validDraft.safeParse(entry);
  if (!p.success) return { ok: false, message: "Factures non préparées : rechargez la fiche." };
  const r = await withSchool(schoolId, (tx) => draftForPayer(tx, userId, p.data.payerId, p.data.seasonId));
  if (!r.ok) return r;
  // After the commit: `withSchool` has returned. The sending runs once the answer is gone.
  if (r.invoiceIds.length > 0) sendSoon(schoolId);
  return { ok: true, drafted: r.invoiceIds.length };
}
