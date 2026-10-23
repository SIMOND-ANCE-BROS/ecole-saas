import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { toDeposit, DEPOSIT_METHODS, type DepositMethod } from "../domaine/encaissement/remises";
import type { Tx } from "./index";
import { alreadyCorrected, type Method } from "./paiements";
import { auditLog, member, payment, person, bankDeposit, bankDepositPayment } from "./schema";

/**
 * Journal des encaissements et remises en banque (#98). Une remise relie des
 * paiements par une table à part : le paiement, inaltérable, n'est jamais
 * modifié. Toujours avec la transaction d'`avecEcole()` (RLS).
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

/** Paiements reçus entre deux dates (incluses), éventuellement d'un seul moyen, du plus ancien au plus récent. */
export async function paymentLog(tx: Tx, du: string, au: string, method: Method | null): Promise<AuditLogRow[]> {
  return rows(tx)
    .where(
      and(sql`${payment.date} BETWEEN ${du}::date AND ${au}::date`, method ? eq(payment.method, method) : undefined),
    )
    .orderBy(asc(payment.date), asc(payment.createdAt));
}

/** Chèques arrivés à échéance, espèces et chèques vacances pas encore remis, par moyen. */
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

/** Crée une remise : chaque paiement doit être à remettre, du moyen de la remise, à la date de la remise. */
export async function createDeposit(
  tx: Tx,
  userId: string,
  saisie: z.input<typeof validDeposit>,
  today: string,
): Promise<Result> {
  const r = validDeposit.safeParse(saisie);
  if (!r.success) return { ok: false, message: r.error.issues[0].message };
  const { date, method: method, paymentIds: paymentIds } = r.data;
  const ids = [...new Set(paymentIds)];
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
  await tx
    .insert(bankDepositPayment)
    .values(ids.map((paymentId) => ({ schoolId: CURRENT_SCHOOL, bankDepositId: id, paymentId: paymentId })));
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

/** Annule une remise faite par erreur (direction) : ses paiements redeviennent à remettre ; trace dans le journal. */
export async function cancelDeposit(tx: Tx, userId: string, id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: "Cette remise n’existe plus." };
  const [x] = await tx
    .select({ date: bankDeposit.date, method: bankDeposit.method })
    .from(bankDeposit)
    .where(eq(bankDeposit.id, id));
  if (!x) return { ok: false, message: "Cette remise n’existe plus." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  await tx.delete(bankDeposit).where(eq(bankDeposit.id, id));
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

export type DepositRow = { id: string; date: string; method: DepositMethod; nombre: number; totalCents: number };

/** Remises, de la plus récente à la plus ancienne. */
export function listDeposits(tx: Tx): Promise<DepositRow[]> {
  return tx
    .select({
      id: bankDeposit.id,
      date: bankDeposit.date,
      method: bankDeposit.method,
      nombre: sql<number>`count(${bankDepositPayment.paymentId})::int`,
      totalCents: sql<number>`coalesce(sum(${payment.amountCents}), 0)::int`,
    })
    .from(bankDeposit)
    .leftJoin(bankDepositPayment, eq(bankDepositPayment.bankDepositId, bankDeposit.id))
    .leftJoin(payment, eq(payment.id, bankDepositPayment.paymentId))
    .groupBy(bankDeposit.id)
    .orderBy(desc(bankDeposit.date), desc(bankDeposit.createdAt));
}

/** Une remise et ses paiements (bordereau), ou null. */
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
    nombre: payments.length,
    totalCents: payments.reduce((s, p) => s + p.amountCents, 0),
  };
}
