"use server";

import { z } from "zod";
import { withSchool } from "@/db";
import {
  abandonRejected,
  GONE,
  RedraftRefused,
  rejectedInTool,
  type RejectedOutcome,
  sendRejectedAgain,
} from "@/db/payer-invoices";
import { abandonVerdict, REJECTED_ROLES } from "@/domain/invoicing/progress";
import { sendSoon, toolAnswerOf } from "@/jobs/invoicing/send";
import type { ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/session";

/**
 * What management does with an invoice of « Factures à reprendre » (#352): send it again, or
 * abandon it so its lines come back on the payer's next drafting. Management only.
 */

const validId = z.uuid();
const INVALID = "Facture introuvable : rechargez la page.";

type Done = ActionResult<{ result: "retry_in_tool" | "redraft" | "abandoned"; drafted?: number }>;

const done = (r: RejectedOutcome): Done =>
  !r.ok ? r : r.mode === "redraft" ? { ok: true, result: r.mode, drafted: r.drafted } : { ok: true, result: r.mode };

/** « Envoyer à nouveau »: woken at once after the commit (`sendSoon`). */
export async function sendAgain(invoiceId: string): Promise<Done> {
  const { schoolId, userId } = await requireRole(...REJECTED_ROLES);
  const id = validId.safeParse(invoiceId);
  if (!id.success) return { ok: false, message: INVALID };
  let r: RejectedOutcome;
  try {
    r = await withSchool(schoolId, (tx) => sendRejectedAgain(tx, userId, id.data));
  } catch (e) {
    // The drafting refused after the invoice was set aside: all rolled back, its message shown.
    if (e instanceof RedraftRefused) return { ok: false, message: e.message };
    throw e;
  }
  if (r.ok) sendSoon(schoolId);
  return done(r);
}

/**
 * « Abandonner »: its lines come back on the payer's next drafting. One the tool holds a document
 * of is first checked with the tool, outside any transaction (`abandonVerdict`): never abandoned
 * on management's word alone, since the tool may have issued it after a lost answer.
 */
export async function abandon(invoiceId: string): Promise<Done> {
  const { schoolId, userId } = await requireRole(...REJECTED_ROLES);
  const id = validId.safeParse(invoiceId);
  if (!id.success) return { ok: false, message: INVALID };
  const held = await withSchool(schoolId, (tx) => rejectedInTool(tx, id.data));
  if (!held) return { ok: false, message: GONE };
  if (held.toolRef) {
    const verdict = abandonVerdict(await toolAnswerOf(held.connector, held.toolRef));
    if (!verdict.ok) return verdict;
  }
  return done(await withSchool(schoolId, (tx) => abandonRejected(tx, userId, id.data, held.toolRef)));
}
