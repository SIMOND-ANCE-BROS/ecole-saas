import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type Balance, payerBalance } from "../domain/payments/balance";
import type { Tx } from "./index";
import { lessonPack, enrollment, auditLog, member, payment, person, user } from "./schema";
import { issuePath } from "../lib/form-errors";

/**
 * Payments (#97): payments recorded against the payer, immutable
 * (trigger); an error is fixed by a negative payment linked to the original
 * payment. Every write leaves a trace in the audit log. Always within
 * the `withSchool()` transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;

export const PAYMENT_METHODS = {
  cheque: "Chèque",
  cash: "Espèces",
  card: "Carte",
  transfer: "Virement",
  direct_debit: "Prélèvement",
  holiday_voucher: "Chèques vacances",
  pass_sport: "Pass’Sport",
  other: "Autre",
} as const;
export type Method = keyof typeof PAYMENT_METHODS;

const shortText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

const paymentFields = z.object({
  method: z.enum(Object.keys(PAYMENT_METHODS) as [Method, ...Method[]]),
  amountCents: z.int("Montant invalide").min(1, "Montant invalide").max(10_000_00, "Montant trop élevé"),
  date: z.iso.date("Date invalide"),
  reference: shortText(60),
  issuer: shortText(100),
  plannedPayment: z.iso.date("Date invalide").nullable(),
});

export const validPayment = paymentFields
  .refine((r) => r.plannedPayment === null || r.method === "cheque", {
    path: issuePath(paymentFields, "plannedPayment"),
    message: "Seul un chèque s’encaisse plus tard",
  })
  .refine((r) => r.plannedPayment === null || r.plannedPayment >= r.date, {
    path: issuePath(paymentFields, "plannedPayment"),
    message: "L’encaissement suit la réception",
  });
export const validPayments = z.array(validPayment).min(1, "Aucun règlement").max(24);

export type Result = { ok: true; ids: string[] } | { ok: false; message: string };

/**
 * Amount already cancelled by corrections. Identifier written with the table
 * name: in a `select`, Drizzle would write it alone, and it would then refer to
 * the subquery's row.
 */
export const alreadyCorrected = sql<number>`coalesce((SELECT -sum(c.amount_cents) FROM payment c WHERE c.corrects_id = ${payment}.${sql.identifier("id")}), 0)::int`;

/** Member of the current school who enters the data (for `entered_by` and the audit log). */
async function memberOf(tx: Tx, userId: string): Promise<string | null> {
  const [m] = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true)));
  return m?.id ?? null;
}

async function log(tx: Tx, who: string, id: string, after: Record<string, unknown>) {
  await tx.insert(auditLog).values({
    schoolId: CURRENT_SCHOOL,
    actor: who,
    targetTable: "payment",
    rowId: id,
    action: "insert",
    after: after,
  });
}

/** Records one or more payments from a payer (three dated cheques, cheque + cash…). */
export async function collect(
  tx: Tx,
  userId: string,
  payerId: string,
  entry: z.input<typeof validPayments>,
): Promise<Result> {
  const r = validPayments.safeParse(entry);
  if (!r.success) return { ok: false, message: r.error.issues[0].message };
  if (!isUuid(payerId)) return { ok: false, message: "Payeur introuvable." };
  const [p] = await tx.select({ id: person.id }).from(person).where(eq(person.id, payerId));
  if (!p) return { ok: false, message: "Payeur introuvable." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  const ids: string[] = [];
  for (const x of r.data) {
    const [{ id }] = await tx
      .insert(payment)
      .values({
        method: x.method,
        amountCents: x.amountCents,
        date: x.date,
        reference: x.reference,
        issuer: x.issuer,
        depositPlannedOn: x.plannedPayment,
        schoolId: CURRENT_SCHOOL,
        payerId: payerId,
        enteredBy: who,
      })
      .returning({ id: payment.id });
    await log(tx, who, id, {
      montant_centimes: x.amountCents,
      method: x.method,
      date: x.date,
      encaissement_prevu: x.plannedPayment,
    });
    ids.push(id);
  }
  return { ok: true, ids };
}

/**
 * Cancels all or part of a payment (management): negative payment of the same
 * method, linked to the original, within what is not already corrected.
 */
export async function correctPayment(
  tx: Tx,
  userId: string,
  paymentId: string,
  amountCents: number,
  date: string,
): Promise<Result> {
  if (!isUuid(paymentId)) return { ok: false, message: "Ce paiement n’existe plus." };
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, message: "Montant invalide" };
  if (!z.iso.date().safeParse(date).success) return { ok: false, message: "Date invalide" };
  const [o] = await tx
    .select({
      payerId: payment.payerId,
      amount: payment.amountCents,
      method: payment.method,
      correctedId: payment.correctsId,
      alreadyCorrected: alreadyCorrected,
    })
    .from(payment)
    .where(eq(payment.id, paymentId));
  if (!o || o.amount < 0 || o.correctedId) return { ok: false, message: "Ce paiement ne peut pas être corrigé." };
  if (amountCents > o.amount - o.alreadyCorrected)
    return { ok: false, message: "La correction dépasse le montant encore non corrigé." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  const [{ id }] = await tx
    .insert(payment)
    .values({
      schoolId: CURRENT_SCHOOL,
      payerId: o.payerId,
      date,
      amountCents: -amountCents,
      method: o.method,
      reference: "Correction",
      correctsId: paymentId,
      enteredBy: who,
    })
    .returning({ id: payment.id });
  await log(tx, who, id, { montant_centimes: -amountCents, method: o.method, date, corrige_id: paymentId });
  return { ok: true, ids: [id] };
}

export type PaymentRow = {
  id: string;
  date: string;
  amountCents: number;
  method: Method;
  reference: string | null;
  issuer: string | null;
  plannedPayment: string | null;
  correctedId: string | null;
  /** Amount already cancelled by corrections (positive payments). */
  correctedCents: number;
  enteredBy: string | null;
};

/** Payments of a payer, most recent first. */
export async function paymentsOf(tx: Tx, payerId: string): Promise<PaymentRow[]> {
  if (!isUuid(payerId)) return [];
  return tx
    .select({
      id: payment.id,
      date: payment.date,
      amountCents: payment.amountCents,
      method: payment.method,
      reference: payment.reference,
      issuer: payment.issuer,
      plannedPayment: payment.depositPlannedOn,
      correctedId: payment.correctsId,
      correctedCents: alreadyCorrected,
      enteredBy: user.name,
    })
    .from(payment)
    .leftJoin(member, eq(member.id, payment.enteredBy))
    .leftJoin(user, eq(user.id, member.userId))
    .where(eq(payment.payerId, payerId))
    .orderBy(desc(payment.date), desc(payment.createdAt));
}

/** Balance of a payer over all their enrollments and lesson packs; null if they never paid nor owed anything. */
export async function balanceOf(tx: Tx, payerId: string, today: string): Promise<Balance | null> {
  if (!isUuid(payerId)) return null;
  const enrollments = await tx
    .select({ status: enrollment.status, netPriceCents: sql<number>`${enrollment.netPriceCents}::int` })
    .from(enrollment)
    .where(eq(enrollment.payerId, payerId))
    .orderBy(asc(enrollment.createdAt));
  const lessonPacks = await tx
    .select({ priceCents: lessonPack.priceCents })
    .from(lessonPack)
    .where(eq(lessonPack.payerId, payerId));
  const payments = await tx
    .select({ amountCents: payment.amountCents, plannedPayment: payment.depositPlannedOn })
    .from(payment)
    .where(eq(payment.payerId, payerId));
  if (enrollments.length === 0 && lessonPacks.length === 0 && payments.length === 0) return null;
  return payerBalance(enrollments, lessonPacks, payments, today);
}
