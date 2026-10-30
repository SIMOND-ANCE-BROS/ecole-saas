import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { rowsOf } from "./columns-of";
import { z } from "zod";
import {
  depositGroups,
  toDeposit,
  DEPOSIT_METHODS,
  type DepositGroup,
  type DepositMethod,
} from "../domain/payments/deposits";
import type { ReversalKind } from "../domain/payments/rejection";
import type { Tx } from "./index";
import { allOrNothing } from "./all-or-nothing";
import { allocatePayments, releaseUncovered } from "./allocations";
import { lockPayments, lockPaymentsOfDepositPayers } from "./payment-locks";
import { todayInParis } from "../domain/people/age";
import { alreadyCorrected, type Method } from "./payments";
import { auditLog, member, payment, person, bankDeposit, bankDepositPayment, billingEntity } from "./schema";

/**
 * Payments log and bank deposits (#98). A deposit links
 * payments through a separate table: the payment, immutable, is never
 * modified. Always within the `withSchool()` transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;
const payerName = sql<string>`coalesce(${person.companyName}, concat_ws(' ', ${person.firstName}, ${person.lastName}))`;

export type AuditLogRow = {
  id: string;
  date: string;
  payerId: string;
  payer: string;
  method: Method;
  amountCents: number;
  correctedCents: number;
  /** Kind of a reverse entry, null for an ordinary payment (#272). */
  reversalKind: ReversalKind | null;
  reference: string | null;
  issuer: string | null;
  plannedPayment: string | null;
  depositId: string | null;
  dateDeposit: string | null;
  /** The billing entity that cashed it, and its name (#300). */
  billingEntityId: string;
  entity: string;
};

function rows(tx: Tx) {
  return tx
    .select({
      id: payment.id,
      date: payment.date,
      payerId: payment.payerId,
      payer: payerName,
      method: payment.method,
      amountCents: payment.amountCents,
      correctedCents: alreadyCorrected,
      reversalKind: payment.reversalKind,
      reference: payment.reference,
      issuer: payment.issuer,
      plannedPayment: payment.depositPlannedOn,
      depositId: bankDepositPayment.bankDepositId,
      dateDeposit: bankDeposit.date,
      billingEntityId: payment.billingEntityId,
      entity: billingEntity.name,
    })
    .from(payment)
    .innerJoin(person, eq(person.id, payment.payerId))
    .innerJoin(billingEntity, eq(billingEntity.id, payment.billingEntityId))
    .leftJoin(bankDepositPayment, eq(bankDepositPayment.paymentId, payment.id))
    .leftJoin(bankDeposit, eq(bankDeposit.id, bankDepositPayment.bankDepositId));
}

/** Payments received between two dates (inclusive), optionally of a single method, oldest first. */
export async function paymentLog(tx: Tx, from: string, to: string, method: Method | null): Promise<AuditLogRow[]> {
  return (
    rows(tx)
      .where(
        and(
          sql`${payment.date} BETWEEN ${from}::date AND ${to}::date`,
          method ? eq(payment.method, method) : undefined,
        ),
      )
      // The id last: two payments entered in the same instant keep one order, on screen and in the export.
      .orderBy(asc(payment.date), asc(payment.createdAt), asc(payment.id))
  );
}

/**
 * Cheques that have come due, cash and holiday vouchers not yet deposited, one group per
 * billing entity and method (#300): each group is one deposit slip for that entity's account.
 */
export async function paymentsToDeposit(tx: Tx, today: string): Promise<DepositGroup<AuditLogRow>[]> {
  const candidates = await rows(tx)
    .where(
      and(
        inArray(payment.method, [...DEPOSIT_METHODS]),
        sql`${payment.amountCents} > 0`,
        // Never a reverse entry: the cancellation of a refund is positive too (#346).
        sql`${payment.reversalKind} IS NULL`,
        sql`${bankDepositPayment.bankDepositId} IS NULL`,
      ),
    )
    .orderBy(asc(sql`coalesce(${payment.depositPlannedOn}, ${payment.date})`), asc(payment.createdAt));
  const order = await tx
    .select({ id: billingEntity.id })
    .from(billingEntity)
    .orderBy(desc(billingEntity.isDefault), asc(billingEntity.name));
  return depositGroups(
    candidates,
    today,
    order.map((e) => e.id),
  );
}

export const validDeposit = z.object({
  date: z.iso.date("Date invalide"),
  method: z.enum(DEPOSIT_METHODS),
  paymentIds: z.array(z.uuid()).min(1, "Sélectionnez au moins un paiement.").max(500),
  /** The entity whose slip the form showed (#300): checked against the payments' own. */
  billingEntityId: z.uuid().optional(),
});

export type Result = { ok: true; id: string } | { ok: false; message: string };

async function memberOf(tx: Tx, userId: string) {
  const [m] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true)));
  return m?.id ?? null;
}

/** Creates a deposit: each payment must be pending deposit, of the deposit's method, at the deposit date. */
export async function createDeposit(
  tx: Tx,
  userId: string,
  entry: z.input<typeof validDeposit>,
  today: string,
): Promise<Result> {
  const r = validDeposit.safeParse(entry);
  if (!r.success) return { ok: false, message: r.error.issues[0].message };
  const { date, method: method, paymentIds: paymentIds } = r.data;
  const ids = [...new Set(paymentIds)];
  // Same lock as correctPayment (#247), rank 2 of `src/db/payment-locks.ts` (#360): a
  // deposit inserts no payment, so it locks no payer. A deposit and a correction, or two
  // deposits, of the same payment wait for each other, so the read below sees the other
  // one. Ordered by id so two deposits sharing several payments cannot deadlock; a separate
  // statement so the read takes a snapshot after the wait.
  await lockPayments(tx, ids);
  const chosen = await rows(tx).where(inArray(payment.id, ids));
  const eligibles = new Set(toDeposit(chosen, date > today ? date : today)[method].map((p) => p.id));
  if (chosen.length !== ids.length || !ids.every((id) => eligibles.has(id))) {
    return {
      ok: false,
      message:
        "Un des paiements choisis n’est plus à remettre (déjà remis, corrigé, pas encore à encaisser ou d’un autre moyen).",
    };
  }
  // A slip goes to one entity's bank account (#298, #300): its payments all belong to that
  // entity, the one whose group the form showed. The page groups them so; a crafted or stale
  // request mixing two is refused here, and by the deposit line's key in the database.
  const entities = await tx
    .selectDistinct({ id: payment.billingEntityId })
    .from(payment)
    .where(inArray(payment.id, ids));
  if (entities.length !== 1 || (r.data.billingEntityId !== undefined && entities[0].id !== r.data.billingEntityId))
    return { ok: false, message: "Une remise ne regroupe que les paiements d’une même entreprise." };
  const entity = entities[0].id;
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  // The deposit and the allocations of its now collected payments (#305) go together.
  return allOrNothing(tx, async (tx) => {
    const id = await insertDeposit(tx, who, entity, date, method, ids);
    // Deposited, a cheque is collected: it settles the oldest installments of its payer with
    // this entity, under the payment locks taken above, then the installments' (#254).
    const allocated = await allocatePayments(tx, who, ids, today);
    return allocated.ok ? { ok: true as const, id } : allocated;
  });
}

async function insertDeposit(
  tx: Tx,
  who: string,
  entity: string,
  date: string,
  method: DepositMethod,
  ids: readonly string[],
): Promise<string> {
  const [{ id }] = await tx
    .insert(bankDeposit)
    .values({ schoolId: CURRENT_SCHOOL, billingEntityId: entity, date, method: method, createdBy: who })
    .returning({ id: bankDeposit.id });
  await tx.insert(bankDepositPayment).values(
    rowsOf(
      bankDepositPayment,
      ids.map((paymentId) => ({
        schoolId: CURRENT_SCHOOL,
        billingEntityId: entity,
        bankDepositId: id,
        paymentId: paymentId,
      })),
    ),
  );
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who,
    targetTable: "bank_deposit",
    rowId: id,
    action: "insert",
    after: { date, method: method, payments: ids.length, billing_entity_id: entity },
  });
  return id;
}

/** Cancels a deposit made by mistake (management): its payments go back to pending; logged in the audit log. */
export async function cancelDeposit(
  tx: Tx,
  userId: string,
  id: string,
  today: string = todayInParis(),
): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: "Cette remise n’existe plus." };
  const [x] = await tx
    .select({ date: bankDeposit.date, method: bankDeposit.method })
    .from(bankDeposit)
    .where(eq(bankDeposit.id, id));
  if (!x) return { ok: false, message: "Cette remise n’existe plus." };
  // Same lock as createDeposit and correctPayment (#247, #253), rank 2 of
  // `src/db/payment-locks.ts` (#360, no payer: nothing here inserts a payment), ordered by
  // id: a rejection saved at the same moment is seen by the read below, or waits for the
  // cancellation and then finds the payment no longer deposited. Every payment of the slip's
  // payers with its business, not only the slip's, in one statement: what the cheques gave
  // back is spent again from the payers' other money (#358, `releaseUncovered`), which reads
  // them all. The slip's payments are read after, in a separate statement, for a fresh snapshot.
  await lockPaymentsOfDepositPayers(tx, id);
  const held = await tx
    .select({ id: bankDepositPayment.paymentId })
    .from(bankDepositPayment)
    .where(eq(bankDepositPayment.bankDepositId, id))
    .orderBy(asc(bankDepositPayment.paymentId));
  // A payment of the deposit rejected by the bank: the slip was used, it stays. Decided by
  // what correctPayment wrote under the same lock (a deposited payment is only ever rejected),
  // not by timestamps: a correction made before the deposit never blocks it (#253). Read
  // from the stored kind of the reverse entry, never from a label (#272).
  const [rejected] = await tx
    .select({ id: payment.id })
    .from(payment)
    .innerJoin(bankDepositPayment, eq(bankDepositPayment.paymentId, payment.id))
    .where(
      and(
        eq(bankDepositPayment.bankDepositId, id),
        sql`EXISTS (SELECT 1 FROM payment c WHERE c.corrects_id = ${payment}.${sql.identifier("id")} AND c.reversal_kind = ${"rejection" satisfies ReversalKind})`,
      ),
    )
    .limit(1);
  if (rejected)
    return { ok: false, message: "Un paiement de cette remise a été rejeté : la remise ne peut plus être annulée." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  // The cancellation and what it gives back to the installments go together, or not at all.
  return allOrNothing(tx, async (tx) => {
    // Two cancellations at the same moment both pass the lock above (#273): the second
    // deletes nothing, and must neither succeed nor log a second deletion.
    const deleted = await tx.delete(bankDeposit).where(eq(bankDeposit.id, id)).returning({ id: bankDeposit.id });
    if (deleted.length === 0) return { ok: false, message: "Cette remise a déjà été annulée." };
    await tx.insert(auditLog).values({
      schoolId: CURRENT_SCHOOL,
      actor: who,
      targetTable: "bank_deposit",
      rowId: id,
      action: "delete",
      before: { date: x.date, method: x.method },
    });
    // Back in the drawer, its cheques are no longer collected: what they settled goes back to
    // the installments (#305), and the payers' other money settles them again (#358), under
    // the payment locks taken above.
    const released = await releaseUncovered(
      tx,
      who,
      held.map((p) => p.id),
      today,
    );
    return released.ok ? { ok: true as const, id } : released;
  });
}

export type DepositRow = {
  id: string;
  date: string;
  method: DepositMethod;
  count: number;
  totalCents: number;
  /** Name of the billing entity whose account it goes to (#300). */
  entity: string;
};

/** Deposits, most recent first. */
export function listDeposits(tx: Tx): Promise<DepositRow[]> {
  return tx
    .select({
      id: bankDeposit.id,
      date: bankDeposit.date,
      method: bankDeposit.method,
      count: sql<number>`count(${bankDepositPayment.paymentId})::int`,
      totalCents: sql<number>`coalesce(sum(${payment.amountCents}), 0)::int`,
      entity: billingEntity.name,
    })
    .from(bankDeposit)
    .innerJoin(billingEntity, eq(billingEntity.id, bankDeposit.billingEntityId))
    .leftJoin(bankDepositPayment, eq(bankDepositPayment.bankDepositId, bankDeposit.id))
    .leftJoin(payment, eq(payment.id, bankDepositPayment.paymentId))
    .groupBy(bankDeposit.id, billingEntity.id)
    .orderBy(desc(bankDeposit.date), desc(bankDeposit.createdAt));
}

/** A deposit slip: the deposit, its payments, and the entity's legal name and account label printed on it (#300). */
export type DepositSlip = DepositRow & {
  payments: AuditLogRow[];
  legalName: string;
  bankAccountLabel: string | null;
};

/** A deposit and its payments (deposit slip), or null. */
export async function readDeposit(tx: Tx, id: string): Promise<DepositSlip | null> {
  if (!isUuid(id)) return null;
  const [x] = await tx
    .select({
      id: bankDeposit.id,
      date: bankDeposit.date,
      method: bankDeposit.method,
      entity: billingEntity.name,
      legalName: billingEntity.legalName,
      bankAccountLabel: billingEntity.bankAccountLabel,
    })
    .from(bankDeposit)
    .innerJoin(billingEntity, eq(billingEntity.id, bankDeposit.billingEntityId))
    .where(eq(bankDeposit.id, id));
  if (!x) return null;
  const payments = await rows(tx)
    .where(eq(bankDepositPayment.bankDepositId, id))
    .orderBy(asc(person.lastName), asc(payment.reference));
  return {
    ...x,
    payments,
    count: payments.length,
    totalCents: payments.reduce((s, p) => s + p.amountCents, 0),
  };
}
