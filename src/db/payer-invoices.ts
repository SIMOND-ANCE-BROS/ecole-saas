import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { rowsOf } from "./columns-of";
import { BILLS_ITS_LINES, CURRENT_SCHOOL } from "./invoice-draft-discard";
import { connectorConfigOf } from "./invoice-outbox";
import type { EntityConnectorConfig } from "../connectors/invoicing/connector";
import { draftPayerInvoices } from "./invoice-drafts";
import type { Tx } from "./index";
import {
  auditLog,
  billingEntity,
  installment,
  invoice,
  invoiceLine,
  invoicingConnector,
  member,
  paymentAllocation,
} from "./schema";
import type { InvoicingToolName } from "../domain/billing/invoicing";
import { isSendable } from "../domain/invoicing/outbox";
import { sendAgainMode, type InvoiceStatus } from "../domain/invoicing/progress";

/**
 * A payer's invoices on their record, and what management does with a rejected one (#352).
 * Always within `withSchool()` (RLS). The sending itself is the outbox (#304).
 */

const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;

export type PayerInvoice = {
  id: string;
  billingEntityId: string;
  billingEntity: string;
  status: InvoiceStatus;
  number: string | null;
  issuedOn: string | null;
  totalInclTaxCents: number;
  toolTotalInclTaxCents: number | null;
  toolRef: string | null;
  attempts: number;
  nextAttemptAt: Date;
  sendErrorKind: string | null;
  sendErrorCode: string | null;
  /** The business's active connector's tool, null when it has none. */
  connectorTool: InvoicingToolName | null;
  createdAt: Date;
  lines: { id: string; label: string; inclTaxCents: number }[];
  installments: { dueDate: string; amountCents: number }[];
};

/**
 * A rejected invoice the tool never held gives its lines back (`billsItsLines`): once another
 * invoice bills one of them again, it is replaced, and the record would show the amount twice.
 * Management still finds it in « Factures à reprendre ».
 */
const REPLACED = sql`(${invoice.status} = 'rejected' AND ${invoice.toolRef} IS NULL AND EXISTS (
  SELECT 1 FROM invoice_line o
  JOIN invoice_line l ON l.enrollment_id = o.enrollment_id OR l.lesson_pack_id = o.lesson_pack_id
  JOIN invoice i ON i.id = l.invoice_id
  WHERE o.invoice_id = ${invoice.id} AND i.id <> ${invoice.id} AND ${BILLS_ITS_LINES}))`;

/**
 * The payer's invoices of the season, its credit notes, cancelled and replaced invoices left out (a
 * cancelled one was set aside, its lines drafted again), newest first per business.
 */
export async function payerInvoices(tx: Tx, payerId: string, seasonId: string): Promise<PayerInvoice[]> {
  if (!isUuid(payerId) || !isUuid(seasonId)) return [];
  const rows = await tx
    .select({
      id: invoice.id,
      billingEntityId: invoice.billingEntityId,
      billingEntity: billingEntity.name,
      status: invoice.status,
      number: invoice.number,
      issuedOn: invoice.issuedOn,
      totalInclTaxCents: invoice.totalInclTaxCents,
      toolTotalInclTaxCents: invoice.toolTotalInclTaxCents,
      toolRef: invoice.toolRef,
      attempts: invoice.attempts,
      nextAttemptAt: invoice.nextAttemptAt,
      sendErrorKind: invoice.sendErrorKind,
      sendErrorCode: invoice.sendErrorCode,
      connectorTool: invoicingConnector.tool,
      createdAt: invoice.createdAt,
    })
    .from(invoice)
    .innerJoin(billingEntity, eq(billingEntity.id, invoice.billingEntityId))
    .leftJoin(
      invoicingConnector,
      and(eq(invoicingConnector.billingEntityId, invoice.billingEntityId), eq(invoicingConnector.active, true)),
    )
    .where(
      and(
        eq(invoice.payerId, payerId),
        eq(invoice.seasonId, seasonId),
        isNull(invoice.creditNoteOf),
        ne(invoice.status, "cancelled"),
        sql`NOT ${REPLACED}`,
      ),
    )
    .orderBy(desc(billingEntity.isDefault), asc(billingEntity.name), desc(invoice.createdAt), asc(invoice.id));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const lines = await tx
    .select({
      id: invoiceLine.id,
      invoiceId: invoiceLine.invoiceId,
      label: invoiceLine.label,
      inclTaxCents: invoiceLine.inclTaxCents,
    })
    .from(invoiceLine)
    .where(inArray(invoiceLine.invoiceId, ids))
    // As the tool receives them: charges first, then discounts.
    .orderBy(sql`${invoiceLine.inclTaxCents} < 0`, asc(invoiceLine.id));
  const dues = await tx
    .select({ invoiceId: installment.invoiceId, dueDate: installment.dueDate, amountCents: installment.amountCents })
    .from(installment)
    .where(inArray(installment.invoiceId, ids))
    .orderBy(asc(installment.rank));
  return rows.map((r) => ({
    ...r,
    lines: lines.filter((l) => l.invoiceId === r.id).map(({ invoiceId: _, ...l }) => l),
    installments: dues.filter((d) => d.invoiceId === r.id).map(({ invoiceId: _, ...d }) => d),
  }));
}

export type RejectedOutcome =
  | { ok: true; mode: "retry_in_tool" | "abandoned" }
  | { ok: true; mode: "redraft"; drafted: number }
  | { ok: false; message: string };

export const GONE = "Cette facture n’est plus à reprendre : rechargez la page.";
const PAID =
  "Un paiement est affecté à une échéance de cette facture : elle ne peut pas être abandonnée ni refaite ici.";

/** The rejected invoice, locked for the transaction; null when it is not rejected (any more). */
async function lockRejected(tx: Tx, invoiceId: string) {
  const [row] = await tx
    .select({
      id: invoice.id,
      status: invoice.status,
      toolRef: invoice.toolRef,
      payerId: invoice.payerId,
      seasonId: invoice.seasonId,
    })
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.status, "rejected"), isNull(invoice.creditNoteOf)))
    .for("update");
  return row ?? null;
}

const HELD =
  "Cette facture n’a pas d’échéances couvrant son total : elle ne peut pas encore partir. « Abandonner » rend ses lignes au payeur.";

/** Its installments add up to its total (`isSendable`, #176). */
async function coversTotal(tx: Tx, invoiceId: string): Promise<boolean> {
  const [i] = await tx
    .select({ totalInclTaxCents: invoice.totalInclTaxCents })
    .from(invoice)
    .where(eq(invoice.id, invoiceId));
  const dues = await tx
    .select({ amountCents: installment.amountCents })
    .from(installment)
    .where(eq(installment.invoiceId, invoiceId));
  return (
    !!i && isSendable({ totalInclTaxCents: i.totalInclTaxCents, installmentsCents: dues.map((d) => d.amountCents) })
  );
}

/** A payment allocated to one of its installments: setting the invoice aside would lose it. */
async function hasAllocation(tx: Tx, invoiceId: string): Promise<boolean> {
  const rows = await tx
    .select({ one: sql`1` })
    .from(paymentAllocation)
    .innerJoin(installment, eq(installment.id, paymentAllocation.installmentId))
    .where(eq(installment.invoiceId, invoiceId))
    .limit(1);
  return rows.length > 0;
}

async function setAside(tx: Tx, actor: string | null, invoiceId: string, reason: "abandoned" | "redrafted") {
  await tx
    .update(invoice)
    .set({ status: "cancelled", claimedUntil: null })
    .where(and(eq(invoice.id, invoiceId), eq(invoice.status, "rejected")));
  await audit(tx, actor, invoiceId, { status: "cancelled", reason });
}

/**
 * « Envoyer à nouveau » on a rejected invoice (`sendAgainMode`): one the tool holds goes back
 * to `tool_draft`, due at once (its attempts never decrease: one more failure rejects it again
 * once past the limit); one the tool never held is set aside and the payer's season drafted
 * again. The caller wakes the sending after the commit (`sendSoon`).
 */
export async function sendRejectedAgain(tx: Tx, userId: string, invoiceId: string): Promise<RejectedOutcome> {
  if (!isUuid(invoiceId)) return { ok: false, message: "Saisie invalide." };
  const actor = await memberOf(tx, userId);
  const row = await lockRejected(tx, invoiceId);
  const mode = row ? sendAgainMode(row) : null;
  if (!row || !mode) return { ok: false, message: GONE };
  if (mode === "retry_in_tool") {
    // Back as `tool_draft`, the claim no longer checks its installments (`SENDABLE`): checked
    // here, so a draft held for its due dates (#176) never goes this way.
    if (!(await coversTotal(tx, invoiceId))) return { ok: false, message: HELD };
    await tx
      .update(invoice)
      .set({
        status: "tool_draft",
        nextAttemptAt: sql`now()`,
        claimedUntil: null,
        sendErrorKind: null,
        sendErrorCode: null,
      })
      .where(and(eq(invoice.id, invoiceId), eq(invoice.status, "rejected")));
    await audit(tx, actor, invoiceId, { status: "tool_draft", reason: "sent_again" });
    return { ok: true, mode };
  }
  // Drafts are per season: an invoice of no season cannot be drafted again, only abandoned.
  if (!row.seasonId)
    return {
      ok: false,
      message: "Cette facture n’est d’aucune saison : elle ne peut pas être refaite, abandonnez-la.",
    };
  if (await hasAllocation(tx, invoiceId)) return { ok: false, message: PAID };
  await setAside(tx, actor, invoiceId, "redrafted");
  const drafted = await draftPayerInvoices(tx, actor, row.payerId, row.seasonId);
  if (!drafted.ok) throw new RedraftRefused(drafted.message);
  return { ok: true, mode, drafted: drafted.invoiceIds.length };
}

/** Rolls the setting aside back with the drafting that failed after it; its message is French. */
export class RedraftRefused extends Error {}

/**
 * What « Abandonner » must check first: the tool's document of a rejected invoice, with the
 * business's connector row read under RLS. Null when the invoice is not rejected (any more).
 */
export async function rejectedInTool(
  tx: Tx,
  invoiceId: string,
): Promise<{ toolRef: string | null; connector: EntityConnectorConfig | null } | null> {
  if (!isUuid(invoiceId)) return null;
  const [row] = await tx
    .select({ toolRef: invoice.toolRef, tool: invoice.tool, billingEntityId: invoice.billingEntityId })
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.status, "rejected"), isNull(invoice.creditNoteOf)));
  if (!row) return null;
  const connector = row.toolRef ? await connectorConfigOf(tx, row.billingEntityId) : null;
  // Another tool than the one holding the document would answer « not found » for a document
  // it never had: never asked (the caller then treats the tool as unreachable).
  return { toolRef: row.toolRef, connector: connector && connector.tool === row.tool ? connector : null };
}

/**
 * « Abandonner » a rejected invoice: it is set aside (`cancelled`) and gives its lines back, so
 * the next drafting of the payer bills them again. One the tool holds a document of is abandoned
 * only once the tool said it never issued it (`abandonVerdict`, checked by the caller with
 * `rejectedInTool` before this transaction): `checkedToolRef` is the reference it checked, and
 * the invoice must still carry it.
 */
export async function abandonRejected(
  tx: Tx,
  userId: string,
  invoiceId: string,
  checkedToolRef: string | null,
): Promise<RejectedOutcome> {
  if (!isUuid(invoiceId)) return { ok: false, message: "Saisie invalide." };
  const actor = await memberOf(tx, userId);
  const row = await lockRejected(tx, invoiceId);
  if (!row || row.toolRef !== checkedToolRef) return { ok: false, message: GONE };
  if (await hasAllocation(tx, invoiceId)) return { ok: false, message: PAID };
  await setAside(tx, actor, invoiceId, "abandoned");
  return { ok: true, mode: "abandoned" };
}

/** The payer's invoices of the season drafted again (`draftPayerInvoices`), signed by the member. */
export async function draftForPayer(tx: Tx, userId: string, payerId: string, seasonId: string) {
  return draftPayerInvoices(tx, await memberOf(tx, userId), payerId, seasonId);
}

/** The member of the current school acting, for the audit log; null if no longer one. */
async function memberOf(tx: Tx, userId: string): Promise<string | null> {
  const [m] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true)));
  return m?.id ?? null;
}

// Ids, statuses and technical codes only: never a name in the audit log.
async function audit(tx: Tx, actor: string | null, id: string, after: Record<string, unknown>) {
  await tx
    .insert(auditLog)
    .values(
      rowsOf(auditLog, [
        { schoolId: CURRENT_SCHOOL, actor, targetTable: "invoice", rowId: id, action: "update", after },
      ]),
    );
}
