import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import type { Tx } from "./index";
import { installment, invoice, payment, person } from "./schema";

/**
 * Lock order of every payment write (#360): the one place it is written down.
 *
 * Collecting, correcting or rejecting, refunding, cancelling a refund, making or cancelling a
 * bank deposit, and allocating (#305) all take their row locks in this order, each rank in a
 * statement of its own, ordered by id within a rank:
 *
 *   1. the payers (`person`), `FOR UPDATE`: `lockPayers`;
 *   2. the payments, `FOR NO KEY UPDATE`: `lockPayments`, `lockPaymentsOfPayer`;
 *   3. the installments of the issued invoices they may settle, `FOR NO KEY UPDATE`:
 *      `lockInstallments`.
 *
 * Once a rank is held, no lock of an earlier rank is requested, except one the transaction
 * already holds (asking again returns at once). Two writers then never wait for each other in
 * a circle, so Postgres never aborts one with `40P01 deadlock detected`: they run one after the
 * other. The totals a write checks (what is left to correct, to refund, to allocate) are read
 * after the locks, in statements of their own, so they see what the writer before committed.
 *
 * Why each mode:
 * - The payer `FOR UPDATE`: inserting a payment, a reverse entry or a refund takes KEY SHARE on
 *   the payer through its foreign key, which FOR UPDATE waits for. A refund, reading the payer's
 *   balance under it, sees every payment saved at the same moment. Because that insert takes a
 *   lock on the payer, the payer is locked first, before the payment: taking the payment first
 *   and the payer at the insert is what deadlocked a correction with a refund (#360).
 * - The payment `FOR NO KEY UPDATE`, not UPDATE: a reverse entry's or an allocation's foreign
 *   key to it takes KEY SHARE, which UPDATE would block. A row lock fires no trigger
 *   (`payment_immutable` is on UPDATE and DELETE).
 * - The installment `FOR NO KEY UPDATE`: an allocation's key to it takes KEY SHARE, which only
 *   `discardDrafts` (FOR UPDATE, drafts only) waits for. Only its status is ever updated, as the
 *   frozen invoice allows (`0052_invoice_drafts.sql`).
 *
 * Outside this order: the invoice row. The sending (`recordIssued`, #304) holds the invoice it
 * records before it allocates (payer, payments, installments); no payment write locks an
 * invoice row. Enrollments and drafts lock the payer `FOR NO KEY UPDATE` (`lockPayer`,
 * `draftPayerInvoices`), then their own rows, never a payment.
 *
 * Always within `withSchool()` (RLS): a row of another school is neither seen nor locked.
 */

/** Rank 1: the payers, ordered by id. Returns the ids found (RLS: of the current school only). */
export async function lockPayers(tx: Tx, payerIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(payerIds)];
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: person.id })
    .from(person)
    .where(inArray(person.id, ids))
    .orderBy(asc(person.id))
    .for("update");
  return rows.map((r) => r.id);
}

/**
 * The payers of these payments, read without a lock: a payment's payer never changes (the
 * payment is immutable), so the ids read before rank 1 stay right under it.
 */
export async function payersOfPayments(tx: Tx, paymentIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(paymentIds)];
  if (ids.length === 0) return [];
  const rows = await tx
    .selectDistinct({ id: payment.payerId })
    .from(payment)
    .where(inArray(payment.id, ids))
    .orderBy(asc(payment.payerId));
  return rows.map((r) => r.id);
}

/** Ranks 1 and 2 for a write that names its payments: their payers, then the payments. */
export async function lockPayersAndPayments(tx: Tx, paymentIds: readonly string[]): Promise<void> {
  await lockPayers(tx, await payersOfPayments(tx, paymentIds));
  await lockPayments(tx, paymentIds);
}

/** Rank 2: these payments, ordered by id. Their payers are locked first (`lockPayers`). */
export async function lockPayments(tx: Tx, paymentIds: readonly string[]): Promise<void> {
  const ids = [...new Set(paymentIds)];
  if (ids.length === 0) return;
  await tx
    .select({ id: payment.id })
    .from(payment)
    .where(inArray(payment.id, ids))
    .orderBy(asc(payment.id))
    .for("no key update");
}

/** Rank 2: every payment of a payer with one business, ordered by id. The payer is locked first. */
export async function lockPaymentsOfPayer(tx: Tx, payerId: string, billingEntityId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: payment.id })
    .from(payment)
    .where(and(eq(payment.payerId, payerId), eq(payment.billingEntityId, billingEntityId)))
    .orderBy(asc(payment.id))
    .for("no key update");
  return rows.map((r) => r.id);
}

/** Rank 3: the installments matching `where` (joined to their invoice), ordered by id. */
export async function lockInstallments(tx: Tx, where: SQL | undefined): Promise<string[]> {
  const rows = await tx
    .select({ id: installment.id })
    .from(installment)
    .innerJoin(invoice, eq(invoice.id, installment.invoiceId))
    .where(where)
    .orderBy(asc(installment.id))
    .for("no key update", { of: installment });
  return rows.map((r) => r.id);
}
