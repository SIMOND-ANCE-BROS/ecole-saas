import { and, asc, desc, eq, sql } from "drizzle-orm";
import { columnsOf, rowsOf } from "./columns-of";
import { CURRENT_SCHOOL } from "./invoice-draft-discard";
import { db, type Tx } from "./index";
import { allocatePayer } from "./allocations";
import { todayInParis } from "../domain/people/age";
import { auditLog, billingEntity, installment, invoice, invoiceLine, invoicingConnector, person } from "./schema";
import type { EntityConnectorConfig } from "../connectors/invoicing/connector";
import type { StoredLine } from "../connectors/invoicing/payload";
import type { ToolDocument } from "../connectors/invoicing/contract";
import type { InvoicingToolName } from "../domain/billing/invoicing";
import { CLAIM_MINUTES, type SendFailure } from "../domain/invoicing/outbox";

/**
 * The invoice row as outbox (#304, ADR 0007): what the sending reads and writes. Everything
 * but `dueWork()` runs within `withSchool()` (RLS). Every write after a claim names the claim
 * (`claimed_until`, to the microsecond): a run whose claim ran out and was taken over by
 * another run writes nothing.
 */

export type DueWork = { schoolId: string; billingEntityId: string };

/**
 * The (school, business) pairs with an invoice due for sending, across schools: the one
 * cross-school read of the sending, through the SECURITY DEFINER function
 * `invoicing_due_work()` (migration 0057), which returns ids only. Each pair is then handled
 * inside `withSchool()`.
 */
export async function dueWork(): Promise<DueWork[]> {
  const rows = await db.execute<{ school_id: string; billing_entity_id: string }>(
    sql`SELECT school_id, billing_entity_id FROM invoicing_due_work() ORDER BY school_id, billing_entity_id`,
  );
  return rows.map((r) => ({ schoolId: r.school_id, billingEntityId: r.billing_entity_id }));
}

/** The business's active connector row, read under RLS: never a business of another school. */
export async function connectorConfigOf(tx: Tx, billingEntityId: string): Promise<EntityConnectorConfig | null> {
  const [row] = await tx
    .select({
      billingEntityId: invoicingConnector.billingEntityId,
      tool: invoicingConnector.tool,
      encryptedCredentials: invoicingConnector.encryptedCredentials,
    })
    .from(invoicingConnector)
    .where(and(eq(invoicingConnector.billingEntityId, billingEntityId), eq(invoicingConnector.active, true)));
  return row ?? null;
}

export type Claimed = {
  id: string;
  status: "to_send" | "tool_draft";
  toolRef: string | null;
  /** Attempts including this one. */
  attempts: number;
  /** The claim, as Postgres prints it (microseconds kept): the key of every later write. */
  claim: string;
};

/**
 * The invoice aliased `i` may go to the tool: already a draft there, or its installments add up
 * to its total. Mirrors `isSendable` (src/domain/invoicing/outbox.ts, #176 Q1) in SQL, so the
 * hold is checked in the very statement that claims, whatever the size of the held backlog.
 */
const SENDABLE = sql.raw(`(i.status = 'tool_draft' OR (
  SELECT count(*) > 0 AND coalesce(sum(s.amount_cents), 0) = i.total_incl_tax_cents
  FROM installment s WHERE s.invoice_id = i.id))`);

/**
 * Claims up to `limit` invoices of the business due for sending, oldest due first: each one's
 * attempt is counted and it is held for `CLAIM_MINUTES`. Rows another run holds are skipped
 * (`FOR UPDATE SKIP LOCKED`), and so are rows it claimed (`claimed_until`): two runs never
 * send the same invoice. A draft waiting for its due dates (`SENDABLE`, #176) is left as it is,
 * neither claimed nor counted. A materialized CTE, locked once: an `IN (… LIMIT … SKIP LOCKED)`
 * subquery may be run again on a concurrent update and then claim nothing.
 */
export async function claimDue(tx: Tx, billingEntityId: string, limit: number): Promise<Claimed[]> {
  const rows = await tx.execute<{
    id: string;
    status: Claimed["status"];
    tool_ref: string | null;
    attempts: number;
    claim: string;
  }>(sql`
    WITH picked AS MATERIALIZED (
      SELECT i.id FROM invoice i
      WHERE i.billing_entity_id = ${billingEntityId}
        AND i.status IN ('to_send', 'tool_draft')
        AND i.credit_note_of IS NULL
        AND i.next_attempt_at <= now()
        AND (i.claimed_until IS NULL OR i.claimed_until <= now())
        AND ${SENDABLE}
      ORDER BY i.next_attempt_at, i.id
      LIMIT ${limit}
      FOR UPDATE OF i SKIP LOCKED
    )
    UPDATE invoice SET attempts = attempts + 1, claimed_until = now() + make_interval(mins => ${CLAIM_MINUTES})
    FROM picked WHERE invoice.id = picked.id
    RETURNING invoice.id, invoice.status, invoice.tool_ref, invoice.attempts, invoice.claimed_until::text AS claim`);
  return rows.map((r) => ({ id: r.id, status: r.status, toolRef: r.tool_ref, attempts: r.attempts, claim: r.claim }));
}

/** What the tool is sent for one invoice: the invoice as stored, its payer as the tool's customer. */
export type Sendable = {
  id: string;
  payer: {
    id: string;
    type: "individual" | "organisation";
    name: string;
    firstName: string | null;
    companyName: string | null;
    email: string | null;
    address: string | null;
  };
  vatMention: string | null;
  totals: { inclTaxCents: number; exclTaxCents: number; vatCents: number };
  lines: StoredLine[];
  installments: { dueDate: string; amountCents: number }[];
};

export async function loadForSending(tx: Tx, id: string): Promise<Sendable | null> {
  const [row] = await tx
    .select({
      id: invoice.id,
      inclTaxCents: invoice.totalInclTaxCents,
      exclTaxCents: invoice.totalExclTaxCents,
      vatCents: invoice.totalVatCents,
      vatMention: billingEntity.vatMention,
      payer: {
        id: person.id,
        type: person.type,
        name: person.lastName,
        firstName: person.firstName,
        companyName: person.companyName,
        email: person.email,
        address: person.address,
      },
    })
    .from(invoice)
    .innerJoin(person, eq(person.id, invoice.payerId))
    .innerJoin(billingEntity, eq(billingEntity.id, invoice.billingEntityId))
    .where(eq(invoice.id, id));
  if (!row) return null;
  const lines = await tx
    .select({
      label: invoiceLine.label,
      quantityThousandths: invoiceLine.quantityThousandths,
      unitPriceCents: invoiceLine.unitPriceCents,
      inclTaxCents: invoiceLine.inclTaxCents,
      exclTaxCents: invoiceLine.exclTaxCents,
      vatCents: invoiceLine.vatCents,
      vatCategory: invoiceLine.vatCategory,
      vatRateBps: invoiceLine.vatRateBps,
      vatMention: invoiceLine.vatMention,
    })
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, id))
    .orderBy(sql`${invoiceLine.inclTaxCents} < 0`, asc(invoiceLine.id));
  const installments = await tx
    .select({ dueDate: installment.dueDate, amountCents: installment.amountCents })
    .from(installment)
    .where(eq(installment.invoiceId, id))
    .orderBy(asc(installment.rank));
  return {
    id: row.id,
    payer: row.payer,
    vatMention: row.vatMention,
    totals: { inclTaxCents: row.inclTaxCents, exclTaxCents: row.exclTaxCents, vatCents: row.vatCents },
    lines,
    installments,
  };
}

/** The claim still ours, on an invoice still on its way: the condition of every write below. */
const ours = (id: string, claim: string) =>
  and(
    eq(invoice.id, id),
    sql`${invoice.claimedUntil} = ${claim}::timestamptz`,
    sql`${invoice.status} IN ('to_send', 'tool_draft')`,
  );

/** The tool holds a draft of the invoice. False when the claim was lost meanwhile. */
export async function recordToolDraft(
  tx: Tx,
  c: Pick<Claimed, "id" | "claim">,
  tool: InvoicingToolName,
  toolRef: string,
): Promise<boolean> {
  const rows = await tx
    .update(invoice)
    .set({ status: "tool_draft", tool, toolRef })
    .where(ours(c.id, c.claim))
    .returning({ id: invoice.id });
  return rows.length > 0;
}

/**
 * The tool issued the invoice: its number, date and PDF are recorded in the statement that
 * moves the row to `issued` (the immutability trigger freezes it afterwards). `mismatch`: the
 * tool's VAT-inclusive total differs from ours (#303): the invoice is recorded as issued all the
 * same, never left without the tool's number, and flagged for a correcting credit note.
 */
export async function recordIssued(
  tx: Tx,
  c: Pick<Claimed, "id" | "claim">,
  tool: InvoicingToolName,
  doc: ToolDocument & { number: string; issuedOn: string },
  mismatch: boolean,
): Promise<boolean> {
  const rows = await tx
    .update(invoice)
    .set({
      status: "issued",
      tool,
      toolRef: doc.toolRef,
      number: doc.number,
      issuedOn: doc.issuedOn,
      pdfUrl: doc.pdfUrl,
      toolTotalInclTaxCents: doc.totalInclTaxCents,
      claimedUntil: null,
      sendErrorKind: mismatch ? "rejected" : null,
      sendErrorCode: mismatch ? "total_mismatch" : null,
    })
    .where(ours(c.id, c.claim))
    .returning({ id: invoice.id, payerId: invoice.payerId, billingEntityId: invoice.billingEntityId });
  if (rows.length === 0) return false;
  await audit(tx, c.id, {
    status: "issued",
    tool,
    number: doc.number,
    issued_on: doc.issuedOn,
    ...(mismatch ? { send_error_code: "total_mismatch", tool_total_incl_tax_cents: doc.totalInclTaxCents } : {}),
  });
  // Issued, its installments can be settled (#305): what the payer already paid this business
  // and no other installment holds goes to them, oldest due date first. In a savepoint: the
  // record of an invoice the tool issued never depends on it; a failed allocation is caught up
  // by the payer's next payment, deposit or issued invoice (`allocatePayments`).
  try {
    await tx.transaction(async (sp) => {
      const allocated = await allocatePayer(sp, null, rows[0].payerId, rows[0].billingEntityId, todayInParis());
      if (!allocated.ok) throw new Error("allocation refused");
    });
  } catch (e) {
    // Technical ids only, never a name.
    console.error(`Invoice ${c.id}: issued, payments not allocated`, e instanceof Error ? e.name : "");
  }
  return true;
}

/** The tool says its draft was cancelled there: the invoice gives its lines back (`billsItsLines`). */
export async function recordCancelled(tx: Tx, c: Pick<Claimed, "id" | "claim">): Promise<boolean> {
  const rows = await tx
    .update(invoice)
    .set({ status: "cancelled", claimedUntil: null, sendErrorKind: null, sendErrorCode: null })
    .where(ours(c.id, c.claim))
    .returning({ id: invoice.id });
  if (rows.length > 0) await audit(tx, c.id, { status: "cancelled" });
  return rows.length > 0;
}

/**
 * A failed attempt: tried again after `retryInMinutes`, or rejected for good (`null`). The
 * claim is released either way; the failure's kind and technical code are kept for management.
 * `held`: the tool's document of it, when the tool returned one before failing (a draft, an
 * issued document whose number cannot be recorded): written down, so its lines stay billed.
 */
export async function recordFailure(
  tx: Tx,
  c: Pick<Claimed, "id" | "claim">,
  failure: SendFailure,
  retryInMinutes: number | null,
  held: { tool: InvoicingToolName; toolRef: string } | null = null,
): Promise<boolean> {
  const common = {
    claimedUntil: null,
    sendErrorKind: failure.kind,
    sendErrorCode: failure.code,
    ...(held ? { tool: held.tool, toolRef: held.toolRef } : {}),
  };
  const rows =
    retryInMinutes === null
      ? await tx
          .update(invoice)
          .set(columnsOf(invoice, { ...common, status: "rejected" as const }))
          .where(ours(c.id, c.claim))
          .returning({ id: invoice.id })
      : await tx
          .update(invoice)
          .set(columnsOf(invoice, { ...common, nextAttemptAt: sql`now() + make_interval(mins => ${retryInMinutes})` }))
          .where(ours(c.id, c.claim))
          .returning({ id: invoice.id });
  if (rows.length > 0 && retryInMinutes === null)
    await audit(tx, c.id, {
      status: "rejected",
      send_error_kind: failure.kind,
      send_error_code: failure.code,
      ...(held ? { tool_ref: held.toolRef } : {}),
    });
  return rows.length > 0;
}

// Ids, statuses, numbers and technical codes only: never a name in the audit log.
async function audit(tx: Tx, id: string, after: Record<string, unknown>) {
  await tx
    .insert(auditLog)
    .values(
      rowsOf(auditLog, [
        { schoolId: CURRENT_SCHOOL, actor: null, targetTable: "invoice", rowId: id, action: "update", after },
      ]),
    );
}

/** An invoice the sending gave up on, or one the tool issued with another total, for management. */
export type SendingProblem = {
  id: string;
  billingEntity: string;
  payerId: string;
  payer: string;
  payerFirstName: string | null;
  payerCompanyName: string | null;
  status: "rejected" | "issued";
  number: string | null;
  totalInclTaxCents: number;
  /** The total the tool issued, when it differs from ours. */
  toolTotalInclTaxCents: number | null;
  attempts: number;
  sendErrorKind: string | null;
  sendErrorCode: string | null;
  /** The lines are back on the next drafting (`billsItsLines`). */
  linesGivenBack: boolean;
  createdAt: Date;
};

const PROBLEM = sql`(${invoice.status} = 'rejected' OR (${invoice.status} = 'issued' AND ${invoice.sendErrorCode} = 'total_mismatch'))`;

/** How many invoices management must look at (`sendingProblems`), for the settings index. */
export async function sendingProblemCount(tx: Tx): Promise<number> {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(invoice)
    .where(PROBLEM);
  return n;
}

/**
 * Invoices management must look at (#304): rejected ones, and issued ones whose total in the
 * tool differs from ours (a credit note is due), most recent first.
 */
export async function sendingProblems(tx: Tx): Promise<SendingProblem[]> {
  return tx
    .select({
      id: invoice.id,
      billingEntity: billingEntity.name,
      payerId: person.id,
      payer: person.lastName,
      payerFirstName: person.firstName,
      payerCompanyName: person.companyName,
      status: sql<SendingProblem["status"]>`${invoice.status}`,
      number: invoice.number,
      totalInclTaxCents: invoice.totalInclTaxCents,
      toolTotalInclTaxCents: invoice.toolTotalInclTaxCents,
      attempts: invoice.attempts,
      sendErrorKind: invoice.sendErrorKind,
      sendErrorCode: invoice.sendErrorCode,
      linesGivenBack: sql<boolean>`${invoice.status} = 'rejected' AND ${invoice.toolRef} IS NULL`,
      createdAt: invoice.createdAt,
    })
    .from(invoice)
    .innerJoin(person, eq(person.id, invoice.payerId))
    .innerJoin(billingEntity, eq(billingEntity.id, invoice.billingEntityId))
    .where(PROBLEM)
    .orderBy(desc(invoice.createdAt), asc(invoice.id));
}
