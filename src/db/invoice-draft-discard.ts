import { and, eq, exists, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { rowsOf } from "./columns-of";
import type { Tx } from "./index";
import { auditLog, installment, invoice, invoiceLine, paymentAllocation } from "./schema";

/**
 * Unsent invoice drafts (#302): an invoice still `to_send` has no number and was never handed
 * to the invoicing tool, so it can be thrown away and drafted again. Never an invoice handed
 * to the tool or issued: only a credit note corrects those. Always within `withSchool()`.
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

export const PAID_DRAFT =
  "Un paiement est déjà affecté à une échéance de ce brouillon de facture : il ne peut pas être refait.";

/** Unsent drafts matching `where`, locked for the transaction. */
export async function lockDrafts(tx: Tx, where: SQL | undefined): Promise<string[]> {
  const rows = await tx
    .select({ id: invoice.id })
    .from(invoice)
    .where(and(eq(invoice.status, "to_send"), isNull(invoice.creditNoteOf), where))
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
