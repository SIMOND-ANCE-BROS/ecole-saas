import { and, eq, exists, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { rowsOf } from "./columns-of";
import type { Tx } from "./index";
import { auditLog, installment, invoice, invoiceLine, paymentAllocation } from "./schema";

/**
 * Unsent invoice drafts (#302): an invoice still `to_send` that the outbox never attempted
 * (#304) has no number and was never handed to the invoicing tool, so it can be thrown away
 * and drafted again. Never one the outbox attempted (the tool may hold it, even after a lost
 * answer), handed to the tool or issued: only the sending, then a credit note, settle those.
 * Always within `withSchool()`.
 */

export const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

/** The invoice aliased `i` is an unsent draft: never attempted by the outbox. */
export const UNSENT_DRAFT = sql.raw(`(i.status = 'to_send' AND i.attempts = 0)`);

/**
 * The invoice aliased `i` still bills its lines (`billsItsLines`, src/domain/invoicing/outbox.ts):
 * all but a cancelled one, or one rejected before the tool held any document of it.
 */
export const BILLS_ITS_LINES = sql.raw(
  `(i.status <> 'cancelled' AND NOT (i.status = 'rejected' AND i.tool_ref IS NULL))`,
);

export const PAID_DRAFT =
  "Un paiement est déjà affecté à une échéance de ce brouillon de facture : il ne peut pas être refait.";

/** Unsent drafts matching `where`, locked for the transaction. */
export async function lockDrafts(tx: Tx, where: SQL | undefined): Promise<string[]> {
  const rows = await tx
    .select({ id: invoice.id })
    .from(invoice)
    .where(and(eq(invoice.status, "to_send"), eq(invoice.attempts, 0), isNull(invoice.creditNoteOf), where))
    .for("update");
  return rows.map((r) => r.id);
}

/** The unsent drafts billing an enrollment, locked. */
export const draftsBillingEnrollment = (tx: Tx, enrollmentId: string) =>
  lockDrafts(
    tx,
    exists(
      tx
        .select({ one: sql`1` })
        .from(invoiceLine)
        .where(and(eq(invoiceLine.invoiceId, invoice.id), eq(invoiceLine.enrollmentId, enrollmentId))),
    ),
  );

/**
 * Deletes unsent drafts with their lines and installments; the audit log keeps their ids and
 * amounts (never a name). Refused, in French, once a payment is allocated to one of their
 * installments (#254): the allocation would be lost.
 */
export async function discardDrafts(
  tx: Tx,
  actor: string | null,
  ids: readonly string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (ids.length === 0) return { ok: true };
  // Their installments locked first: a payment allocated meanwhile waits, then finds them gone.
  await tx
    .select({ id: installment.id })
    .from(installment)
    .where(inArray(installment.invoiceId, [...ids]))
    .for("update");
  const paid = await tx
    .select({ one: sql`1` })
    .from(paymentAllocation)
    .innerJoin(installment, eq(installment.id, paymentAllocation.installmentId))
    .where(inArray(installment.invoiceId, [...ids]))
    .limit(1);
  if (paid.length > 0) return { ok: false, message: PAID_DRAFT };
  const gone = await tx
    .select({
      id: invoice.id,
      billingEntityId: invoice.billingEntityId,
      payerId: invoice.payerId,
      seasonId: invoice.seasonId,
      totalInclTaxCents: invoice.totalInclTaxCents,
    })
    .from(invoice)
    .where(inArray(invoice.id, [...ids]));
  await tx.delete(invoiceLine).where(inArray(invoiceLine.invoiceId, [...ids]));
  await tx.delete(installment).where(inArray(installment.invoiceId, [...ids]));
  await tx.delete(invoice).where(inArray(invoice.id, [...ids]));
  await tx.insert(auditLog).values(
    rowsOf(
      auditLog,
      gone.map((i) => ({
        schoolId: CURRENT_SCHOOL,
        actor,
        targetTable: "invoice",
        rowId: i.id,
        action: "delete",
        before: {
          billing_entity_id: i.billingEntityId,
          payer_id: i.payerId,
          season_id: i.seasonId,
          total_incl_tax_cents: i.totalInclTaxCents,
        },
      })),
    ),
  );
  return { ok: true };
}
