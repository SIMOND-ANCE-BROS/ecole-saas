import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./index";
import { alreadyCorrected } from "./payments-sql";
import { auditLog, bankDepositPayment, installment, invoice, payment, paymentAllocation } from "./schema";
import {
  type AllocatablePayment,
  allocateFifo,
  allocationRefusal,
  availableCents,
  entityPoolCents,
  installmentStatusOf,
  OPEN_INSTALLMENT_STATUSES,
  releaseExcess,
  SETTLED_INVOICE_STATUS,
  type Allocation,
  type OpenInstallment,
} from "../domain/payments/allocation";

/**
 * Payment allocations (#305), written under the locks of #254: the payments first
 * (`FOR NO KEY UPDATE`, as correctPayment, createDeposit and refundPayer take them, ordered
 * by id), then the installments they may settle, ordered by id, each in a statement of its
 * own, before any total is read: the reads then see what a transaction that held the same
 * rows committed. NO KEY UPDATE on the installment too: an allocation's key to it takes
 * KEY SHARE, which only `discardDrafts` (FOR UPDATE) waits for. A row lock fires no
 * trigger; the installment's status alone is updated, as the frozen invoice allows
 * (`0052_invoice_drafts.sql`). Always within `withSchool()` (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;

export type AllocationOutcome = { ok: true; allocations: Allocation[] } | { ok: false; message: string };

/** Sum of a payment's allocations; written with the table name for the same reason as `alreadyCorrected`. */
const allocatedOfPayment = sql<number>`coalesce((SELECT sum(a.amount_cents) FROM payment_allocation a WHERE a.payment_id = ${payment}.${sql.identifier("id")}), 0)::int`;
const allocatedOfInstallment = sql<number>`coalesce((SELECT sum(a.amount_cents) FROM payment_allocation a WHERE a.installment_id = ${installment}.${sql.identifier("id")}), 0)::int`;

/** Installments a payment may settle: open, on an issued invoice of the same payer and entity. */
function openInstallmentsOf(pairs: readonly Pair[]): SQL | undefined {
  return and(
    eq(invoice.status, SETTLED_INVOICE_STATUS),
    inArray(installment.status, [...OPEN_INSTALLMENT_STATUSES]),
    or(...pairs.map((p) => and(eq(invoice.payerId, p.payerId), eq(installment.billingEntityId, p.billingEntityId)))),
  );
}

type Pair = { payerId: string; billingEntityId: string };

async function lockPayments(tx: Tx, ids: readonly string[]) {
  await tx
    .select({ id: payment.id })
    .from(payment)
    .where(inArray(payment.id, [...ids]))
    .orderBy(asc(payment.id))
    .for("no key update");
}

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
 * Allocates these payments FIFO (#305, `allocateFifo`) over the open installments of their
 * payer's issued invoices with the same entity, within what each payment still offers once
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
  await lockPayments(tx, ids);
  const pairs = await tx
    .selectDistinct({ payerId: payment.payerId, billingEntityId: payment.billingEntityId })
    .from(payment)
    .where(and(inArray(payment.id, ids), sql`${payment.amountCents} > 0`))
    .orderBy(asc(payment.billingEntityId), asc(payment.payerId));
  if (pairs.length === 0) return { ok: true, allocations: [] };
  await tx
    .select({ id: installment.id })
    .from(installment)
    .innerJoin(invoice, eq(invoice.id, installment.invoiceId))
    .where(openInstallmentsOf(pairs))
    .orderBy(asc(installment.id))
    .for("no key update", { of: installment });

  const written: Allocation[] = [];
  for (const pair of pairs) {
    const payments = await paymentsOf(tx, pair);
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
      .where(openInstallmentsOf([pair]));
    const targets = payments.filter((p) => ids.includes(p.id));
    const allocations = allocateFifo(targets, open, entityPoolCents(payments, today), today);
    // Checked again before writing (#254): never more than a payment or an installment still holds.
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
      await tx
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
        });
      await log(tx, actor, a.paymentId, "insert", null, {
        installment_id: a.installmentId,
        amount_cents: a.amountCents,
        billing_entity_id: pair.billingEntityId,
      });
    }
    await refreshStatuses(tx, [...new Set(allocations.map((a) => a.installmentId))], today);
    written.push(...allocations);
  }
  return { ok: true, allocations: written };
}

/**
 * Allocates whatever a payer's collected money to one entity has left (#305), for when an
 * invoice is issued after the payer paid (#304 calls it once the tool issues one). Locks
 * every payment of the payer with that entity, ordered by id, before `allocatePayments`.
 */
export async function allocatePayer(
  tx: Tx,
  actor: string | null,
  payerId: string,
  billingEntityId: string,
  today: string,
): Promise<AllocationOutcome> {
  if (!isUuid(payerId) || !isUuid(billingEntityId)) return { ok: true, allocations: [] };
  const rows = await tx
    .select({ id: payment.id })
    .from(payment)
    .where(and(eq(payment.payerId, payerId), eq(payment.billingEntityId, billingEntityId)))
    .orderBy(asc(payment.id))
    .for("no key update");
  return allocatePayments(
    tx,
    actor,
    rows.map((r) => r.id),
    today,
  );
}

/**
 * Takes back what these payments settle beyond what they still hold (#305, #254): after a
 * correction or a rejected cheque (net of corrections), or a cancelled deposit (a cheque back
 * in the drawer is no longer collected). Taken from the latest due installment first
 * (`releaseExcess`), whose status goes back to partial, overdue or upcoming. Same lock order
 * as `allocatePayments`: the payments, then their installments, ordered by id.
 */
export async function releaseUncovered(
  tx: Tx,
  actor: string | null,
  paymentIds: readonly string[],
  today: string,
): Promise<void> {
  const ids = [...new Set(paymentIds)].filter(isUuid);
  if (ids.length === 0) return;
  await lockPayments(tx, ids);
  await tx
    .select({ id: installment.id })
    .from(installment)
    .innerJoin(paymentAllocation, eq(paymentAllocation.installmentId, installment.id))
    .where(inArray(paymentAllocation.paymentId, ids))
    .orderBy(asc(installment.id))
    .for("no key update", { of: installment });
  const payments = await tx
    .select({
      id: payment.id,
      amountCents: payment.amountCents,
      method: payment.method,
      plannedPayment: payment.depositPlannedOn,
      deposited: sql<boolean>`${bankDepositPayment.bankDepositId} IS NOT NULL`,
      correctedCents: alreadyCorrected,
      reversalKind: payment.reversalKind,
    })
    .from(payment)
    .leftJoin(bankDepositPayment, eq(bankDepositPayment.paymentId, payment.id))
    .where(inArray(payment.id, ids))
    .orderBy(asc(payment.id));
  const touched = new Set<string>();
  for (const p of payments) {
    const held = await tx
      .select({
        installmentId: paymentAllocation.installmentId,
        amountCents: paymentAllocation.amountCents,
        invoiceId: installment.invoiceId,
        rank: installment.rank,
        dueDate: installment.dueDate,
      })
      .from(paymentAllocation)
      .innerJoin(installment, eq(installment.id, paymentAllocation.installmentId))
      .where(eq(paymentAllocation.paymentId, p.id));
    if (held.length === 0) continue;
    const keep = availableCents({ ...p, allocatedCents: 0 }, today);
    for (const change of releaseExcess(held, keep)) {
      const before = held.find((h) => h.installmentId === change.installmentId)?.amountCents ?? 0;
      const where = and(
        eq(paymentAllocation.paymentId, p.id),
        eq(paymentAllocation.installmentId, change.installmentId),
      );
      if (change.amountCents === 0) await tx.delete(paymentAllocation).where(where);
      else await tx.update(paymentAllocation).set({ amountCents: change.amountCents }).where(where);
      await log(
        tx,
        actor,
        p.id,
        change.amountCents === 0 ? "delete" : "update",
        { installment_id: change.installmentId, amount_cents: before },
        change.amountCents === 0 ? null : { installment_id: change.installmentId, amount_cents: change.amountCents },
      );
      touched.add(change.installmentId);
    }
  }
  await refreshStatuses(tx, [...touched], today);
}
