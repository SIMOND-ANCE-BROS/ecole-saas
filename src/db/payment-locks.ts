import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Tx } from "./index";
import { installment, invoice, payment, person } from "./schema";

/**
 * Lock order of every payment write (#360): the one place it is written down.
 *
 * Collecting, correcting or rejecting, refunding, cancelling a refund, making or cancelling a
 * bank deposit, and allocating (#305) all take their row locks in this order, each rank in a
 * statement of its own, ordered by id within a rank:
 *
 *   1. the payer (`person`): `lockPayers`, by a write that inserts a payment row only;
 *   2. the payments, `FOR NO KEY UPDATE`: `lockPayments`, `lockPaymentsOfPayer`,
 *      `lockPaymentsOfDepositPayers`;
 *   3. the installments of the issued invoices they may settle, `FOR NO KEY UPDATE`:
 *      `lockInstallments`.
 *
 * Within rank 2, a write takes all the payments it will ever need in one statement. One that
 * releases money and spends it again (a correction, a rejection, a cancelled deposit, a refund
 * cancelled, #358) reads every payment of the payer with that business: it locks them all
 * first (`lockPayerAndPaymentsOf`, `lockPaymentsOfDepositPayers`, `lockPaymentsOfPayer`), never
 * the one it reverses alone and the others after, which could take a lower id after a higher one.
 *
 * Outside any payment write, the overdue sweep (`markOverdue`, #358) starts at rank 3: it
 * locks the installments it may mark, ordered by id, and nothing else.
 *
 * A write may start at a later rank, never go back: once a rank is held, no lock of an earlier
 * rank is requested, except one the transaction already holds (asking again returns at once).
 * Two writers then never wait for each other in a circle, so Postgres never aborts one with
 * `40P01 deadlock detected`: they run one after the other. The totals a write checks (what is
 * left to correct, to refund, to allocate) are read after the locks, in statements of their
 * own, so they see what the writer before committed.
 *
 * Why each rank and mode:
 * - The payer, before its payments, by `collect`, `correctPayment`, `refundPayer` and
 *   `cancelRefundPayment`: inserting a payment, a reverse entry or a refund takes KEY SHARE on
 *   the payer through its foreign key; taking the payment first and the payer at the insert is
 *   what deadlocked a correction with a refund (#360).
 * - No payer lock in a deposit, its cancellation or an allocation, which insert no payment
 *   (`bank_deposit_payment` and `payment_allocation` have no key to `person`): they start at
 *   rank 2, and a refund, holding its payer, waits for them on the payments. A slip holds many
 *   payers, while attendance, a couple enrolled or a relationship takes KEY SHARE on several
 *   people in any order: locking all the slip's payers could close a circle with them.
 * - The payer `FOR NO KEY UPDATE` (the default): two writes for one payer wait for each other,
 *   while KEY SHARE taken by someone else's foreign key passes.
 * - The payer `FOR UPDATE` for a refund (`refundPayer`), which reads the payer's balance: it
 *   waits for every write above and for any insert keyed to the payer, so the balance it reads
 *   holds every payment saved at the same moment. It locks a single payer, never a second one.
 * - `allocatePayer` (an invoice issued, #304) locks its one payer first, then its payments.
 * - The payment `FOR NO KEY UPDATE`, not UPDATE: a reverse entry's or an allocation's foreign
 *   key to it takes KEY SHARE, which UPDATE would block. A row lock fires no trigger
 *   (`payment_immutable` is on UPDATE and DELETE).
 * - Inserting a reverse entry fires `payment_reverse_target` (migration 0059, #356), which
 *   locks the payer, then the payment reversed, both `FOR NO KEY UPDATE`, before checking what
 *   is left to cancel: ranks 1 and 2 in this order, already held by `correctPayment` and
 *   `cancelRefundPayment`, so the trigger waits for nothing they do not hold.
 * - The installment `FOR NO KEY UPDATE`: an allocation's key to it takes KEY SHARE, which only
 *   `discardDrafts` (FOR UPDATE, drafts only) waits for. Only its status is ever updated, as the
 *   frozen invoice allows (`0052_invoice_drafts.sql`).
 *
 * Outside this order: the invoice row. The sending (`recordIssued`, #304) holds the invoice it
 * records before it allocates (payer, payments, installments); no payment write locks an
 * invoice row. Sending a rejected invoice again or abandoning it (`src/db/payer-invoices.ts`,
 * #352) locks that invoice only, never a payer, payment or installment. Enrollments and drafts lock the payer `FOR NO KEY UPDATE` (`lockPayer`,
 * `draftPayerInvoices`), then their own rows, never a payment; their inserts, attendance and
 * relationships take KEY SHARE on other people (students), which a payer lock in
 * `FOR NO KEY UPDATE` never blocks.
 *
 * Always within `withSchool()` (RLS): a row of another school is neither seen nor locked.
 */

/** How a payer is locked: `update` by a refund only (see above). */
export type PayerLock = "no key update" | "update";

/**
 * Rank 1: the payers, ordered by id. Returns the ids found (RLS: of the current school only).
 * A transaction asks for one mode only, the first time: asking again for it returns at once.
 */
export async function lockPayers(
  tx: Tx,
  payerIds: readonly string[],
  mode: PayerLock = "no key update",
): Promise<string[]> {
  const ids = [...new Set(payerIds)];
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: person.id })
    .from(person)
    .where(inArray(person.id, ids))
    .orderBy(asc(person.id))
    .for(mode);
  return rows.map((r) => r.id);
}

/**
 * Ranks 1 and 2 for a write that reverses one payment and then spends its payer's money
 * again (`correctPayment`, #358): its payer, then every payment of that payer with the
 * payment's business, ordered by id, the reversed one among them. All of them in one
 * statement: taking the reversed one alone first and the others later could take a lower id
 * after a higher one. Returns the payer and business, or null (another school, gone).
 */
export async function lockPayerAndPaymentsOf(
  tx: Tx,
  paymentId: string,
): Promise<{ payerId: string; billingEntityId: string } | null> {
  // Immutable: read before rank 1, it stays right under it.
  const [p] = await tx
    .select({ payerId: payment.payerId, billingEntityId: payment.billingEntityId })
    .from(payment)
    .where(eq(payment.id, paymentId));
  if (!p) return null;
  await lockPayers(tx, [p.payerId]);
  await lockPaymentsOfPayer(tx, p.payerId, p.billingEntityId);
  return p;
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

/**
 * Rank 2 for cancelling a deposit (#358): every payment of the payers on the slip with the
 * slip's business, ordered by id, the slip's own among them, in one statement. Its cheques
 * go back to the drawer and the money their payers have left is spent again
 * (`releaseUncovered`), which reads all their payments. No payer lock: a deposit
 * inserts no payment (see above).
 */
export async function lockPaymentsOfDepositPayers(tx: Tx, depositId: string): Promise<void> {
  await tx
    .select({ id: payment.id })
    .from(payment)
    .where(
      sql`(${payment.payerId}, ${payment.billingEntityId}) IN (
        SELECT p.payer_id, p.billing_entity_id FROM payment p
        JOIN bank_deposit_payment d ON d.payment_id = p.id
        WHERE d.bank_deposit_id = ${depositId})`,
    )
    .orderBy(asc(payment.id))
    .for("no key update");
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
