import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./index";
import { alreadyCorrected } from "./payments-sql";
import { auditLog, bankDepositPayment, installment, invoice, payment, paymentAllocation } from "./schema";
import { lockInstallments, lockPayers, lockPayersAndPayments, lockPaymentsOfPayer } from "./payment-locks";
import {
  type AllocatablePayment,
  allocateFifo,
  allocationRefusal,
  availableCents,
  entityPoolCents,
  heldCapCents,
  installmentStatusOf,
  OPEN_INSTALLMENT_STATUSES,
  releaseExcess,
  SETTLED_INVOICE_STATUS,
  type Allocation,
  type OpenInstallment,
} from "../domain/payments/allocation";

/**
 * Payment allocations (#305), written under the locks of #254, taken in the order of every
 * payment write (`src/db/payment-locks.ts`, #360): the payers, then the payments, then the
 * installments they may settle, each ordered by id, before any total is read: the reads then
 * see what a transaction that held the same rows committed. The callers lock the payers first
 * (asking again here returns at once). Always within `withSchool()` (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;

export type AllocationOutcome = { ok: true; allocations: Allocation[] } | { ok: false; message: string };

/** Sum of a payment's allocations; written with the table name for the same reason as `alreadyCorrected`. */
const allocatedOfPayment = sql<number>`coalesce((SELECT sum(a.amount_cents) FROM payment_allocation a WHERE a.payment_id = ${payment}.${sql.identifier("id")}), 0)::int`;
const allocatedOfInstallment = sql<number>`coalesce((SELECT sum(a.amount_cents) FROM payment_allocation a WHERE a.installment_id = ${installment}.${sql.identifier("id")}), 0)::int`;

/**
 * Installments of the issued invoices of these payers with these entities, whatever their
 * status: the set locked does not depend on a status another transaction may change meanwhile.
 */
function issuedInstallmentsOf(pairs: readonly Pair[]): SQL | undefined {
  return and(
    eq(invoice.status, SETTLED_INVOICE_STATUS),
    or(...pairs.map((p) => and(eq(invoice.payerId, p.payerId), eq(installment.billingEntityId, p.billingEntityId)))),
  );
}

type Pair = { payerId: string; billingEntityId: string };

/** A payer's payments to one entity as the allocation reads them, oldest first. */
async function paymentsOf(tx: Tx, p: Pair): Promise<(AllocatablePayment & { date: string })[]> {
  return tx
    .select({
      id: payment.id,
      date: payment.date,
      amountCents: payment.amountCents,
      method: payment.method,
      plannedPayment: payment.depositPlannedOn,
      deposited: sql<boolean>`${bankDepositPayment.bankDepositId} IS NOT NULL`,
      correctedCents: alreadyCorrected,
      reversalKind: payment.reversalKind,
      allocatedCents: allocatedOfPayment,
    })
    .from(payment)
    .leftJoin(bankDepositPayment, eq(bankDepositPayment.paymentId, payment.id))
    .where(and(eq(payment.payerId, p.payerId), eq(payment.billingEntityId, p.billingEntityId)))
    .orderBy(asc(payment.date), asc(payment.createdAt), asc(payment.id));
}

/** One audit row per allocation change, keyed by the payment (the allocation has no id of its own); ids and amounts only. */
async function log(
  tx: Tx,
  actor: string | null,
  paymentId: string,
  action: "insert" | "update" | "delete",
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor,
    targetTable: "payment_allocation",
    rowId: paymentId,
    action,
    before,
    after,
  });
}

/** Sets each installment's status from what is now allocated to it (`installmentStatusOf`). */
async function refreshStatuses(tx: Tx, ids: readonly string[], today: string) {
  if (ids.length === 0) return;
  const rows = await tx
    .select({
      id: installment.id,
      status: installment.status,
      amountCents: installment.amountCents,
      dueDate: installment.dueDate,
      allocatedCents: allocatedOfInstallment,
    })
    .from(installment)
    .where(inArray(installment.id, [...ids]));
  for (const r of rows) {
    if (r.status === "cancelled") continue;
    const status = installmentStatusOf(r, today);
    if (status !== r.status) await tx.update(installment).set({ status }).where(eq(installment.id, r.id));
  }
}

/**
 * Allocates the money of these payments' payers with their entities FIFO (#305,
 * `allocateFifo`): these payments, and whatever the payer's other payments to that entity
 * left unallocated, over the open installments of the payer's issued invoices with the same
 * entity, within what each payment still offers once
 * collected and net of corrections, and within what the payer's money to that entity still
 * offers after refunds (`entityPoolCents`). What no installment needs stays unallocated.
 * Refused, in French, if an allocation would exceed the payment or the installment (#254):
 * the caller's writes are then to be rolled back (`allOrNothing`).
 */
export async function allocatePayments(
  tx: Tx,
  actor: string | null,
  paymentIds: readonly string[],
  today: string,
): Promise<AllocationOutcome> {
  const ids = [...new Set(paymentIds)].filter(isUuid);
  if (ids.length === 0) return { ok: true, allocations: [] };
  await lockPayersAndPayments(tx, ids);
  const pairs = await tx
    .selectDistinct({ payerId: payment.payerId, billingEntityId: payment.billingEntityId })
    .from(payment)
    .where(and(inArray(payment.id, ids), sql`${payment.amountCents} > 0`))
    .orderBy(asc(payment.billingEntityId), asc(payment.payerId));
  if (pairs.length === 0) return { ok: true, allocations: [] };
  const locked = await lockInstallments(tx, issuedInstallmentsOf(pairs));
  if (locked.length === 0) return { ok: true, allocations: [] };

  const written: Allocation[] = [];
  for (const pair of pairs) {
    const payments = await paymentsOf(tx, pair);
    // Only the installments locked above: one whose invoice was issued since waits for the next allocation.
    const open: OpenInstallment[] = await tx
      .select({
        id: installment.id,
        invoiceId: installment.invoiceId,
        rank: installment.rank,
        dueDate: installment.dueDate,
        amountCents: installment.amountCents,
        allocatedCents: allocatedOfInstallment,
      })
      .from(installment)
      .innerJoin(invoice, eq(invoice.id, installment.invoiceId))
      .where(
        and(
          issuedInstallmentsOf([pair]),
          inArray(installment.id, locked),
          inArray(installment.status, [...OPEN_INSTALLMENT_STATUSES]),
        ),
      );
    // Every payment of the pair, oldest first, not only those given: money left unallocated
    // earlier (collected while an invoice was being issued, freed by a release) is spent too.
    // A payment not locked here and corrected meanwhile is released by that correction, which
    // waits for the installment locks above.
    const targets = payments;
    const allocations = allocateFifo(targets, open, entityPoolCents(payments, today), today);
    // Checked again before writing: never more than a payment or an installment still holds.
    // A guard on what `allocateFifo` computed from the same reads; what keeps two writers apart
    // is the locks above (#254), under which those reads were taken.
    const offered = new Map(targets.map((p) => [p.id, availableCents(p, today)]));
    const owed = new Map(open.map((i) => [i.id, i.amountCents - i.allocatedCents]));
    for (const a of allocations) {
      const refusal = allocationRefusal({
        amountCents: a.amountCents,
        availableCents: offered.get(a.paymentId) ?? 0,
        remainingCents: owed.get(a.installmentId) ?? 0,
      });
      if (refusal) return { ok: false, message: refusal };
      offered.set(a.paymentId, (offered.get(a.paymentId) ?? 0) - a.amountCents);
      owed.set(a.installmentId, (owed.get(a.installmentId) ?? 0) - a.amountCents);
      const [{ total }] = await tx
        .insert(paymentAllocation)
        .values({
          schoolId: CURRENT_SCHOOL,
          billingEntityId: pair.billingEntityId,
          paymentId: a.paymentId,
          installmentId: a.installmentId,
          amountCents: a.amountCents,
        })
        .onConflictDoUpdate({
          target: [paymentAllocation.paymentId, paymentAllocation.installmentId],
          set: { amountCents: sql`${paymentAllocation.amountCents} + excluded.amount_cents` },
        })
        .returning({ total: paymentAllocation.amountCents });
      // Added to an allocation already there (the payment settled part of it before): an update.
      const row = { installment_id: a.installmentId, billing_entity_id: pair.billingEntityId };
      if (total === a.amountCents) await log(tx, actor, a.paymentId, "insert", null, { ...row, amount_cents: total });
      else
        await log(
          tx,
          actor,
          a.paymentId,
          "update",
          { ...row, amount_cents: total - a.amountCents },
          { ...row, amount_cents: total },
        );
    }
    await refreshStatuses(tx, [...new Set(allocations.map((a) => a.installmentId))], today);
    written.push(...allocations);
  }
  return { ok: true, allocations: written };
}

/**
 * Allocates whatever a payer's collected money to one entity has left (#305), for when an
 * invoice is issued after the payer paid (#304 calls it once the tool issues one). Locks
 * the payer, then every payment of the payer with that entity, ordered by id
 * (`src/db/payment-locks.ts`), before `allocatePayments`.
 */
export async function allocatePayer(
  tx: Tx,
  actor: string | null,
  payerId: string,
  billingEntityId: string,
  today: string,
): Promise<AllocationOutcome> {
  if (!isUuid(payerId) || !isUuid(billingEntityId)) return { ok: true, allocations: [] };
  await lockPayers(tx, [payerId]);
  const ids = await lockPaymentsOfPayer(tx, payerId, billingEntityId);
  return allocatePayments(tx, actor, ids, today);
}

/**
 * Takes back what allocations hold beyond the money behind them (#305, #254): what these
 * payments settle beyond their own net amount once collected, after a correction or a rejected
 * cheque (net of corrections) or a cancelled deposit (a cheque back in the drawer is no longer
 * collected); then, for their payer with that entity, whatever all the allocations hold beyond
 * the payer's money net of refunds (`heldCapCents`: a correction made after a refund). Taken
 * from the latest due installment first (`releaseExcess`), whose status goes back to partial,
 * overdue or upcoming. Same lock order as `allocatePayments` (`src/db/payment-locks.ts`): the
 * payers, the payments, then every installment of the payer's issued invoices with that
 * entity, ordered by id.
 */
export async function releaseUncovered(
  tx: Tx,
  actor: string | null,
  paymentIds: readonly string[],
  today: string,
): Promise<void> {
  const ids = [...new Set(paymentIds)].filter(isUuid);
  if (ids.length === 0) return;
  await lockPayersAndPayments(tx, ids);
  const pairs = await tx
    .selectDistinct({ payerId: payment.payerId, billingEntityId: payment.billingEntityId })
    .from(payment)
    .where(inArray(payment.id, ids))
    .orderBy(asc(payment.billingEntityId), asc(payment.payerId));
  if (pairs.length === 0) return;
  await lockInstallments(tx, issuedInstallmentsOf(pairs));
  const touched = new Set<string>();
  for (const pair of pairs) {
    const payments = await paymentsOf(tx, pair);
    const held = await tx
      .select({
        paymentId: paymentAllocation.paymentId,
        installmentId: paymentAllocation.installmentId,
        amountCents: paymentAllocation.amountCents,
        invoiceId: installment.invoiceId,
        rank: installment.rank,
        dueDate: installment.dueDate,
      })
      .from(paymentAllocation)
      .innerJoin(installment, eq(installment.id, paymentAllocation.installmentId))
      .innerJoin(payment, eq(payment.id, paymentAllocation.paymentId))
      .where(and(eq(payment.payerId, pair.payerId), eq(payment.billingEntityId, pair.billingEntityId)));
    if (held.length === 0) continue;
    const key = (a: { paymentId: string; installmentId: string }) => `${a.paymentId}/${a.installmentId}`;
    const before = new Map(held.map((a) => [key(a), a.amountCents]));
    const now = new Map(held.map((a) => [key(a), { ...a }]));
    // Each payment within its own money first, then all of them within the payer's.
    for (const p of payments.filter((x) => ids.includes(x.id))) {
      const mine = [...now.values()].filter((a) => a.paymentId === p.id);
      for (const c of releaseExcess(mine, availableCents({ ...p, allocatedCents: 0 }, today))) now.set(key(c), c);
    }
    for (const c of releaseExcess([...now.values()], heldCapCents(payments, today))) now.set(key(c), c);
    for (const a of now.values()) {
      const was = before.get(key(a)) ?? 0;
      if (a.amountCents === was) continue;
      const where = and(
        eq(paymentAllocation.paymentId, a.paymentId),
        eq(paymentAllocation.installmentId, a.installmentId),
      );
      if (a.amountCents === 0) await tx.delete(paymentAllocation).where(where);
      else await tx.update(paymentAllocation).set({ amountCents: a.amountCents }).where(where);
      const row = { installment_id: a.installmentId, billing_entity_id: pair.billingEntityId };
      await log(
        tx,
        actor,
        a.paymentId,
        a.amountCents === 0 ? "delete" : "update",
        { ...row, amount_cents: was },
        a.amountCents === 0 ? null : { ...row, amount_cents: a.amountCents },
      );
      touched.add(a.installmentId);
    }
  }
  await refreshStatuses(tx, [...touched], today);
}
