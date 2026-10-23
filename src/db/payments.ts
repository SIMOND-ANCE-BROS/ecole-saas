import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type Balance, payerBalance } from "../domain/payments/balance";
import type { Tx } from "./index";
import { lessonPack, enrollment, auditLog, member, payment, person, user } from "./schema";

/**
 * Encaissements (#97) : paiements enregistrés sur le payeur, inaltérables
 * (trigger) ; une erreur se corrige par un paiement négatif lié au paiement
 * d'origine. Chaque écriture laisse une trace dans le journal. Toujours avec
 * la transaction d'`avecEcole()` (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;

export const MOYENS = {
  cheque: "Chèque",
  especes: "Espèces",
  carte: "Carte",
  virement: "Virement",
  prelevement: "Prélèvement",
  cheque_vacances: "Chèques vacances",
  pass_sport: "Pass’Sport",
  autre: "Autre",
} as const;
export type Method = keyof typeof MOYENS;

const shortText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

export const validPayment = z
  .object({
    method: z.enum(Object.keys(MOYENS) as [Method, ...Method[]]),
    amountCents: z.int("Montant invalide").min(1, "Montant invalide").max(10_000_00, "Montant trop élevé"),
    date: z.iso.date("Date invalide"),
    reference: shortText(60),
    issuer: shortText(100),
    plannedPayment: z.iso.date("Date invalide").nullable(),
  })
  .refine((r) => r.plannedPayment === null || r.method === "cheque", {
    path: ["plannedPayment"],
    message: "Seul un chèque s’encaisse plus tard",
  })
  .refine((r) => r.plannedPayment === null || r.plannedPayment >= r.date, {
    path: ["plannedPayment"],
    message: "L’encaissement suit la réception",
  });
export const validPayments = z.array(validPayment).min(1, "Aucun règlement").max(24);

export type Result = { ok: true; ids: string[] } | { ok: false; message: string };

/**
 * Montant déjà annulé par des corrections. Identifiant écrit avec le nom de
 * table : dans un `select`, Drizzle l'écrirait seul, et il désignerait alors
 * la ligne de la sous-requête.
 */
export const alreadyCorrected = sql<number>`coalesce((SELECT -sum(c.amount_cents) FROM payment c WHERE c.corrects_id = ${payment}.${sql.identifier("id")}), 0)::int`;

/** Membre de l'école courante qui saisit (pour `saisi_par` et le journal). */
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

/** Enregistre un ou plusieurs règlements d'un payeur (trois chèques datés, chèque + espèces…). */
export async function collect(
  tx: Tx,
  userId: string,
  payerId: string,
  saisie: z.input<typeof validPayments>,
): Promise<Result> {
  const r = validPayments.safeParse(saisie);
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
 * Annule tout ou partie d'un paiement (direction) : paiement négatif du même
 * moyen, lié à l'original, dans la limite de ce qui n'est pas déjà corrigé.
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
  /** Montant déjà annulé par des corrections (paiements positifs). */
  correctedCents: number;
  enteredBy: string | null;
};

/** Paiements d'un payeur, du plus récent au plus ancien. */
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

/** Solde d'un payeur sur toutes ses inscriptions et ses carnets ; null s'il n'a jamais rien payé ni dû. */
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
