"use server";

import { z } from "zod";
import { withSchool } from "@/db";
import {
  abandonRejected,
  RedraftRefused,
  rejectedInTool,
  type RejectedOutcome,
  sendRejectedAgain,
} from "@/db/payer-invoices";
import { once, storedRejectedInvoice } from "@/db/submissions";
import { abandonVerdict, REJECTED_ROLES } from "@/domain/invoicing/progress";
import { sendSoon, toolAnswerOf } from "@/jobs/invoicing/send";
import { type ActionResult, type Busy, orBusy } from "@/lib/action-result";
import { has } from "@/lib/has";
import { requireRole } from "@/lib/session";

/**
 * What management does with an invoice of « Factures à reprendre » (#352): send it again, or
 * abandon it so its lines come back on the payer's next drafting. Management only. `key` is
 * generated once per button by the browser (#260): a retry after a lost answer gets the first
 * result back (the same banner) instead of « plus à reprendre ».
 */

const validId = z.uuid();
const INVALID = "Facture introuvable : rechargez la page.";

type Done = ActionResult<{ result: "retry_in_tool" | "redraft" | "abandoned"; drafted?: number }>;

const done = (r: RejectedOutcome | Busy): Done =>
  !r.ok
    ? { ok: false, message: r.message }
    : r.mode === "redraft"
      ? { ok: true, result: r.mode, drafted: r.drafted }
      : { ok: true, result: r.mode };

/**
 * « Envoyer à nouveau »: woken at once after the commit (`sendSoon`). A replay returns what the
 * first click did, even if the invoice was rejected again since (past the attempt limit, one
 * failure does it): the banner then says « renvoyée » while the list shows it again, and the next
 * click, with a new key, really sends it.
 */
export async function sendAgain(invoiceId: string, key: string): Promise<Done> {
  const { schoolId, userId } = await requireRole(...REJECTED_ROLES);
  const id = validId.safeParse(invoiceId);
  if (!id.success || !validId.safeParse(key).success) return { ok: false, message: INVALID };
  let r: RejectedOutcome | Busy;
  try {
    r = await orBusy(() =>
      withSchool(schoolId, (tx) =>
        once(tx, "rejected_invoice", key, { action: "send_again", invoiceId: id.data }, storedRejectedInvoice, () =>
          sendRejectedAgain(tx, userId, id.data),
        ),
      ),
    );
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
 * on management's word alone, since the tool may have issued it after a lost answer. An invoice
 * no longer rejected goes straight to the transaction: there, a retry of the same click gets its
 * stored result back, any other click « plus à reprendre » (`abandonRejected`).
 */
export async function abandon(invoiceId: string, key: string): Promise<Done> {
  const { schoolId, userId } = await requireRole(...REJECTED_ROLES);
  const id = validId.safeParse(invoiceId);
  if (!id.success || !validId.safeParse(key).success) return { ok: false, message: INVALID };
  const held = await orBusy(() => withSchool(schoolId, (tx) => rejectedInTool(tx, id.data)));
  if (held && has(held, "ok")) return held;
  if (held?.toolRef) {
    const verdict = abandonVerdict(await toolAnswerOf(held.connector, held.toolRef));
    if (!verdict.ok) return verdict;
  }
  // The reference checked with the tool: the invoice must still carry it (null: none to check).
  const checkedToolRef = held?.toolRef ?? null;
  return done(
    await orBusy(() =>
      withSchool(schoolId, (tx) =>
        once(tx, "rejected_invoice", key, { action: "abandon", invoiceId: id.data }, storedRejectedInvoice, () =>
          abandonRejected(tx, userId, id.data, checkedToolRef),
        ),
      ),
    ),
  );
}
