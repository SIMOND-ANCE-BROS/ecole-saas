import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { rowsOf } from "./columns-of";
import { z } from "zod";
import { toDeposit, DEPOSIT_METHODS, type DepositMethod } from "../domain/payments/deposits";
import { REJECTED_REFERENCE } from "../domain/payments/rejection";
import type { Tx } from "./index";
import { alreadyCorrected, type Method } from "./payments";
import { auditLog, member, payment, person, bankDeposit, bankDepositPayment } from "./schema";

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
  reference: string | null;
  issuer: string | null;
  plannedPayment: string | null;
  depositId: string | null;
  dateDeposit: string | null;
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
      reference: payment.reference,
      issuer: payment.issuer,
      plannedPayment: payment.depositPlannedOn,
      depositId: bankDepositPayment.bankDepositId,
      dateDeposit: bankDeposit.date,
    })
    .from(payment)
    .innerJoin(person, eq(person.id, payment.payerId))
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

/** Cheques that have come due, cash and holiday vouchers not yet deposited, by method. */
export async function paymentsToDeposit(tx: Tx, today: string): Promise<Record<DepositMethod, AuditLogRow[]>> {
  const candidates = await rows(tx)
    .where(
      and(
        inArray(payment.method, [...DEPOSIT_METHODS]),
        sql`${payment.amountCents} > 0`,
        sql`${bankDepositPayment.bankDepositId} IS NULL`,
      ),
    )
    .orderBy(asc(sql`coalesce(${payment.depositPlannedOn}, ${payment.date})`), asc(payment.createdAt));
  return toDeposit(candidates, today);
}

export const validDeposit = z.object({
  date: z.iso.date("Date invalide"),
  method: z.enum(DEPOSIT_METHODS),
  paymentIds: z.array(z.uuid()).min(1, "Sélectionnez au moins un paiement.").max(500),
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
  // Same lock as correctPayment (#247): a deposit and a correction, or two deposits, of
  // the same payment wait for each other, so the read below sees the other one. Ordered
  // by id so two deposits sharing several payments cannot deadlock; a separate statement
  // so the read takes a snapshot after the wait.
  await tx
    .select({ id: payment.id })
    .from(payment)
    .where(inArray(payment.id, ids))
    .orderBy(asc(payment.id))
    .for("no key update");
  const chosen = await rows(tx).where(inArray(payment.id, ids));
  const eligibles = new Set(toDeposit(chosen, date > today ? date : today)[method].map((p) => p.id));
  if (chosen.length !== ids.length || !ids.every((id) => eligibles.has(id))) {
    return {
      ok: false,
      message:
        "Un des paiements choisis n’est plus à remettre (déjà remis, corrigé, pas encore à encaisser ou d’un autre moyen).",
    };
  }
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  const [{ id }] = await tx
    .insert(bankDeposit)
    .values({ schoolId: CURRENT_SCHOOL, date, method: method, createdBy: who })
    .returning({ id: bankDeposit.id });
  await tx.insert(bankDepositPayment).values(
    rowsOf(
      bankDepositPayment,
      ids.map((paymentId) => ({ schoolId: CURRENT_SCHOOL, bankDepositId: id, paymentId: paymentId })),
    ),
  );
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who,
    targetTable: "bank_deposit",
    rowId: id,
    action: "insert",
    after: { date, method: method, payments: ids.length },
  });
  return { ok: true, id };
}

/** Cancels a deposit made by mistake (management): its payments go back to pending; logged in the audit log. */
export async function cancelDeposit(tx: Tx, userId: string, id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: "Cette remise n’existe plus." };
  const [x] = await tx
    .select({ date: bankDeposit.date, method: bankDeposit.method })
    .from(bankDeposit)
    .where(eq(bankDeposit.id, id));
  if (!x) return { ok: false, message: "Cette remise n’existe plus." };
  // Same lock as createDeposit and correctPayment (#247, #253), ordered by id: a rejection
  // saved at the same moment is seen by the read below, or waits for the cancellation and
  // then finds the payment no longer deposited. A separate statement, for a fresh snapshot.
  await tx
    .select({ id: payment.id })
    .from(payment)
    .innerJoin(bankDepositPayment, eq(bankDepositPayment.paymentId, payment.id))
    .where(eq(bankDepositPayment.bankDepositId, id))
    .orderBy(asc(payment.id))
    .for("no key update", { of: payment });
  // A payment of the deposit rejected by the bank: the slip was used, it stays. Decided by
  // what correctPayment wrote under the same lock (a deposited payment is only ever rejected),
  // not by timestamps: a « Correction » made before the deposit never blocks it (#253).
  const [rejected] = await tx
    .select({ id: payment.id })
    .from(payment)
    .innerJoin(bankDepositPayment, eq(bankDepositPayment.paymentId, payment.id))
    .where(
      and(
        eq(bankDepositPayment.bankDepositId, id),
        sql`EXISTS (SELECT 1 FROM payment c WHERE c.corrects_id = ${payment}.${sql.identifier("id")} AND c.reference = ${REJECTED_REFERENCE})`,
      ),
    )
    .limit(1);
  if (rejected)
    return { ok: false, message: "Un paiement de cette remise a été rejeté : la remise ne peut plus être annulée." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
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
  return { ok: true, id };
}

export type DepositRow = { id: string; date: string; method: DepositMethod; count: number; totalCents: number };

/** Deposits, most recent first. */
export function listDeposits(tx: Tx): Promise<DepositRow[]> {
  return tx
    .select({
      id: bankDeposit.id,
      date: bankDeposit.date,
      method: bankDeposit.method,
      count: sql<number>`count(${bankDepositPayment.paymentId})::int`,
      totalCents: sql<number>`coalesce(sum(${payment.amountCents}), 0)::int`,
    })
    .from(bankDeposit)
    .leftJoin(bankDepositPayment, eq(bankDepositPayment.bankDepositId, bankDeposit.id))
    .leftJoin(payment, eq(payment.id, bankDepositPayment.paymentId))
    .groupBy(bankDeposit.id)
    .orderBy(desc(bankDeposit.date), desc(bankDeposit.createdAt));
}

/** A deposit and its payments (deposit slip), or null. */
export async function readDeposit(tx: Tx, id: string): Promise<(DepositRow & { payments: AuditLogRow[] }) | null> {
  if (!isUuid(id)) return null;
  const [x] = await tx
    .select({ id: bankDeposit.id, date: bankDeposit.date, method: bankDeposit.method })
    .from(bankDeposit)
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
