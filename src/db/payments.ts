import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type Balance, balancesByEntity } from "../domain/payments/balance";
import type { Tx } from "./index";
import { type ReversalKind, rejectionDateRefusal } from "../domain/payments/rejection";
import {
  lessonPack,
  enrollment,
  auditLog,
  bankDeposit,
  bankDepositPayment,
  billingEntity,
  member,
  payment,
  person,
  user,
} from "./schema";
import { issuePath } from "../lib/form-errors";
import { METHOD_LABELS, PAYMENT_METHOD_VALUES, refusedMethod, type Method } from "../domain/payments/methods";
import { readMethodSettings } from "./payment-methods";
import { formatEuros } from "../lib/money";
import { defaultEntityId, entityChoices, listEntities, NO_DEFAULT_ENTITY, resolveEntity } from "./billing-entities";
import {
  heldForPendingEnrollments,
  mayRefund,
  overpaidOf,
  REFUND_METHODS,
  refundableCents,
  refundRefusal,
  uncollectedCents,
  isRefund,
} from "../domain/payments/refund";
import { mayCancelRefund, refundCancellationRefusal, refundLeftCents } from "../domain/payments/refund-cancellation";
import { quarterCountSql } from "./enrollments";

/**
 * Payments (#97): payments recorded against the payer, immutable
 * (trigger); an error is fixed by a negative payment linked to the original
 * payment. Every write leaves a trace in the audit log. Always within
 * the `withSchool()` transaction (RLS).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;

/** Labels of every method, accepted or not: a payment keeps its method's label (#293). */
export const PAYMENT_METHODS = METHOD_LABELS;
export type { Method };

const shortText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

const paymentFields = z.object({
  method: z.enum(PAYMENT_METHOD_VALUES),
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
 * Amount already cancelled by reverse entries, as a positive amount: the corrections and
 * rejection of a payment (negative), or the cancellations of a refund (positive, #346).
 * Identifier written with the table name: in a `select`, Drizzle would write it alone, and
 * it would then refer to the subquery's row.
 */
export const alreadyCorrected = sql<number>`coalesce((SELECT abs(sum(c.amount_cents)) FROM payment c WHERE c.corrects_id = ${payment}.${sql.identifier("id")}), 0)::int`;

/** Member of the current school who enters the data (for `entered_by` and the audit log). */
async function memberOf(tx: Tx, userId: string): Promise<string | null> {
  return (await memberAndRole(tx, userId))?.id ?? null;
}

/** The same member with their role, for a write restricted to management. */
async function memberAndRole(tx: Tx, userId: string) {
  const [m] = await tx
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.active, true)));
  return m ?? null;
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

/** Shown when a school with several entities gets a payment without the entity that cashes it. */
export const ENTITY_REQUIRED = "Choisissez l’entreprise qui encaisse ce paiement : rechargez la page.";

/**
 * Records one or more payments from a payer (three dated cheques, cheque + cash…), all
 * cashed by one billing entity (#300): the one chosen, which must be active. With several
 * active entities (the form then offers the choice) it is always chosen; with one, it is
 * the school's default. Only by a method the school accepts (#293).
 */
export async function collect(
  tx: Tx,
  userId: string,
  payerId: string,
  entry: z.input<typeof validPayments>,
  billingEntityId?: string,
): Promise<Result> {
  const r = validPayments.safeParse(entry);
  if (!r.success) return { ok: false, message: r.error.issues[0].message };
  if (billingEntityId !== undefined && !isUuid(billingEntityId))
    return { ok: false, message: "Entreprise introuvable ou inactive." };
  if (!isUuid(payerId)) return { ok: false, message: "Payeur introuvable." };
  const [p] = await tx.select({ id: person.id }).from(person).where(eq(person.id, payerId));
  if (!p) return { ok: false, message: "Payeur introuvable." };
  const who = await memberOf(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  // The form offers the accepted methods only; one switched off since it was opened is refused (#293).
  const refused = refusedMethod(
    r.data.map((x) => x.method),
    await readMethodSettings(tx),
  );
  if (refused)
    return {
      ok: false,
      message: `Le paiement par « ${METHOD_LABELS[refused]} » n’est plus accepté : rechargez la page pour choisir un autre moyen.`,
    };
  // No entity sent while several are active: the form was opened before a second one was added.
  if (billingEntityId === undefined && (await entityChoices(tx)).length > 1)
    return { ok: false, message: ENTITY_REQUIRED };
  const resolved = await resolveEntity(tx, billingEntityId);
  if (!resolved.ok) return resolved;
  const entity = resolved.id;
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
        billingEntityId: entity,
        payerId: payerId,
        enteredBy: who,
      })
      .returning({ id: payment.id });
    await log(tx, who, id, {
      montant_centimes: x.amountCents,
      method: x.method,
      date: x.date,
      encaissement_prevu: x.plannedPayment,
      billing_entity_id: entity,
    });
    ids.push(id);
  }
  return { ok: true, ids };
}

/**
 * Cancels all or part of a payment: negative payment of the same method, linked
 * to the original, within what is not already corrected. A payment already in a
 * bank deposit is rejected instead (#253, recommended rule pending the school's
 * validation): management only, for the whole amount not yet corrected, dated
 * `rejectedOn` (the day the bank returned it, not before the deposit; required),
 * kind `rejection`, and the deposit slip is left as printed. Any other payment is
 * corrected today, kind `correction`, without `rejectedOn`. The reverse entry keeps
 * the original's reference and issuer (cheque number, bank, #272).
 */
export async function correctPayment(
  tx: Tx,
  userId: string,
  paymentId: string,
  amountCents: number,
  today: string,
  rejectedOn: string | null = null,
): Promise<Result> {
  if (!isUuid(paymentId)) return { ok: false, message: "Ce paiement n’existe plus." };
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, message: "Montant invalide" };
  if (!z.iso.date().safeParse(today).success) return { ok: false, message: "Date invalide." };
  // Two corrections of the same payment wait for each other (#247), so the total read
  // below includes a correction saved at the same moment. NO KEY UPDATE, not UPDATE: the
  // correction's foreign key to this payment takes KEY SHARE, which UPDATE would block.
  // The lock is its own statement: a query that waits on a lock keeps its first snapshot
  // for the subquery of the total, a new statement sees the other correction once
  // committed. A row lock fires no trigger (payment_immutable is on UPDATE and DELETE).
  // createDeposit takes the same lock: whether the payment is deposited is read after it.
  await tx.select({ id: payment.id }).from(payment).where(eq(payment.id, paymentId)).for("no key update");
  const [o] = await tx
    .select({
      payerId: payment.payerId,
      billingEntityId: payment.billingEntityId,
      amount: payment.amountCents,
      method: payment.method,
      reference: payment.reference,
      issuer: payment.issuer,
      date: payment.date,
      correctedId: payment.correctsId,
      alreadyCorrected: alreadyCorrected,
      depositId: bankDepositPayment.bankDepositId,
      depositedOn: bankDeposit.date,
    })
    .from(payment)
    .leftJoin(bankDepositPayment, eq(bankDepositPayment.paymentId, payment.id))
    .leftJoin(bankDeposit, eq(bankDeposit.id, bankDepositPayment.bankDepositId))
    .where(eq(payment.id, paymentId));
  if (!o || o.amount < 0 || o.correctedId) return { ok: false, message: "Ce paiement ne peut pas être corrigé." };
  const deposited = o.depositedOn !== null;
  const who = await memberAndRole(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  if (deposited && who.role !== "director")
    return { ok: false, message: "Seule la direction peut enregistrer un paiement rejeté après sa remise en banque." };
  // The form was opened before the deposit was made, or cancelled: what it asks no longer fits.
  if (deposited && rejectedOn === null)
    return { ok: false, message: "Ce paiement a été remis en banque : rechargez la fiche." };
  if (!deposited && rejectedOn !== null)
    return { ok: false, message: "Ce paiement n’est plus dans une remise en banque : rechargez la fiche." };
  const remaining = o.amount - o.alreadyCorrected;
  if (amountCents > remaining) return { ok: false, message: "La correction dépasse le montant encore non corrigé." };
  // A bank rejects a whole cheque: a rejection is always of everything not yet corrected.
  if (deposited && amountCents !== remaining)
    return {
      ok: false,
      message: `Un rejet porte sur tout le montant restant (${formatEuros(remaining)}) : rechargez la fiche.`,
    };
  const date = rejectedOn ?? today;
  const refusal = o.depositedOn !== null ? rejectionDateRefusal(date, o.depositedOn, today) : null;
  if (refusal) return { ok: false, message: refusal };
  const [{ id }] = await tx
    .insert(payment)
    .values({
      schoolId: CURRENT_SCHOOL,
      // The reverse entry belongs to the original's entity (key payment_corrects_same_entity_fk).
      billingEntityId: o.billingEntityId,
      payerId: o.payerId,
      date,
      amountCents: -amountCents,
      method: o.method,
      reference: o.reference,
      issuer: o.issuer,
      correctsId: paymentId,
      reversalKind: deposited ? "rejection" : "correction",
      enteredBy: who.id,
    })
    .returning({ id: payment.id });
  await log(tx, who.id, id, {
    montant_centimes: -amountCents,
    method: o.method,
    date,
    corrige_id: paymentId,
    reversal_kind: deposited ? "rejection" : "correction",
    // The deposit slip keeps the payment as printed; the audit log says which one it was on.
    ...(deposited ? { rejected: true, bank_deposit_id: o.depositId } : {}),
  });
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
  /** Kind of a reverse entry, null for an ordinary payment (#272). */
  reversalKind: ReversalKind | null;
  /** Amount already cancelled by corrections (positive payments). */
  correctedCents: number;
  enteredBy: string | null;
  /** Date of the bank deposit holding this payment, or null: a deposited payment is rejected, not corrected (#253). */
  depositedOn: string | null;
  /** Name of the billing entity that cashed it (#300). */
  entity: string;
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
      reversalKind: payment.reversalKind,
      correctedCents: alreadyCorrected,
      enteredBy: user.name,
      depositedOn: bankDeposit.date,
      entity: billingEntity.name,
    })
    .from(payment)
    .innerJoin(billingEntity, eq(billingEntity.id, payment.billingEntityId))
    .leftJoin(member, eq(member.id, payment.enteredBy))
    .leftJoin(user, eq(user.id, member.userId))
    .leftJoin(bankDepositPayment, eq(bankDepositPayment.paymentId, payment.id))
    .leftJoin(bankDeposit, eq(bankDeposit.id, bankDepositPayment.bankDepositId))
    .where(eq(payment.payerId, payerId))
    .orderBy(desc(payment.date), desc(payment.createdAt));
}

/** A payer's balance with one entity (#300). */
export type EntityBalance = { id: string; name: string; balance: Balance };

/**
 * A payer's balances (#300): the family total, and, for a school with several billing
 * entities, one balance per entity the payer owes or paid, in the school's order (the
 * default first). With a single entity `byEntity` is empty: the screens show the total only.
 * « Several » counts every entity, active or not (as `severalEntities`, #299): a debt to a
 * deactivated business stays visible. Only the payment form's choice is limited to active ones.
 */
export type PayerBalances = {
  total: Balance;
  byEntity: EntityBalance[];
  severalEntities: boolean;
  /** Each entity holding an overpayment, with what it may pay back already (#294), in the school's order. */
  refunds: EntityRefund[];
};

/**
 * An overpayment, what of it is not collected yet, what is held for enrollments on trial or
 * on the waitlist, and the part a refund may pay back (#294).
 */
export type Refundable = { overpaid: number; uncollected: number; held: number; refundable: number };
export type EntityRefund = Refundable & { id: string; name: string };

/** Balance of a payer over all their enrollments and lesson packs; null if they never paid nor owed anything. */
export async function balanceOf(tx: Tx, payerId: string, today: string): Promise<PayerBalances | null> {
  if (!isUuid(payerId)) return null;
  const balances = await balancesOf(tx, payerId, today);
  if (!balances) return null;
  const { byEntity, total, refunds } = balances;
  const entities = await listEntities(tx);
  const severalEntities = entities.length > 1;
  return {
    total,
    severalEntities,
    byEntity: severalEntities
      ? entities.flatMap((e) => (byEntity[e.id] ? [{ id: e.id, name: e.name, balance: byEntity[e.id] }] : []))
      : [],
    refunds: entities.flatMap((e) => (refunds[e.id] ? [{ id: e.id, name: e.name, ...refunds[e.id] }] : [])),
  };
}

/** A payer's balance per entity id and in total (#300), or null if they never paid nor owed anything. */
async function balancesOf(tx: Tx, payerId: string, today: string) {
  const enrollments = await tx
    .select({
      status: enrollment.status,
      period: enrollment.period,
      netPriceCents: sql<number>`coalesce(${enrollment.netPriceCents}, 0)::int`,
      billingEntityId: enrollment.billingEntityId,
      // A quarterly enrollment owes its price once per covered quarter (#291).
      quarterCount: quarterCountSql,
    })
    .from(enrollment)
    .where(eq(enrollment.payerId, payerId))
    .orderBy(asc(enrollment.createdAt));
  const lessonPacks = await tx
    .select({ priceCents: lessonPack.priceCents, billingEntityId: lessonPack.billingEntityId })
    .from(lessonPack)
    .where(eq(lessonPack.payerId, payerId));
  const payments = await tx
    .select({
      amountCents: payment.amountCents,
      plannedPayment: payment.depositPlannedOn,
      billingEntityId: payment.billingEntityId,
      method: payment.method,
      deposited: sql<boolean>`${bankDepositPayment.bankDepositId} IS NOT NULL`,
      correctedCents: alreadyCorrected,
      reversalKind: payment.reversalKind,
    })
    .from(payment)
    .leftJoin(bankDepositPayment, eq(bankDepositPayment.paymentId, payment.id))
    .where(eq(payment.payerId, payerId));
  if (enrollments.length === 0 && lessonPacks.length === 0 && payments.length === 0) return null;
  const { byEntity, total } = balancesByEntity(enrollments, lessonPacks, payments, today);
  // What each entity may pay back (#294): its overpayment, less the cheques it has not
  // collected yet and what its enrollments on trial or on the waitlist would cost.
  const refunds: Record<string, Refundable> = {};
  for (const [id, balance] of Object.entries(byEntity)) {
    const overpaid = overpaidOf(balance);
    if (overpaid === 0) continue;
    const uncollected = uncollectedCents(
      payments.filter((p) => p.billingEntityId === id),
      today,
    );
    const held = heldForPendingEnrollments(balance.outsideCalculation);
    refunds[id] = { overpaid, uncollected, held, refundable: refundableCents(overpaid, uncollected, held) };
  }
  return { byEntity, total, refunds };
}

export const validRefund = z.object({
  method: z.enum(REFUND_METHODS, "Choisissez comment vous remboursez."),
  amountCents: z.int("Montant invalide").min(1, "Montant invalide").max(10_000_00, "Montant trop élevé"),
  date: z.iso.date("Date invalide"),
  // Cheque number or transfer label, as for a payment.
  reference: shortText(60),
});

/** Shown when a school with several entities gets a refund without the entity that pays it back. */
export const REFUND_ENTITY_REQUIRED = "Choisissez l’entreprise qui rembourse : rechargez la fiche.";

/**
 * Pays a payer back what a business received in excess (#294), typically after a works
 * council cheque for an enrollment already paid in full: a negative payment of kind
 * `refund`, cancelling no payment, by cheque, cash or transfer (`REFUND_METHODS`), never
 * on a deposit slip. Management only (`mayRefund`). At most the payer's overpayment with
 * that entity already collected (`refundableCents`: a cheque to cash later or not yet
 * deposited never funds a refund), read under a lock on the payer so that two refunds, or
 * a refund and a payment or correction saved at the same moment, never pay back more than
 * was received in excess. With several entities the one refunding is always named (each has its own
 * account, an overpayment to one is never paid back from the other); with one, it is the
 * default. The invoice is left unchanged (#294 question 2, default).
 */
export async function refundPayer(
  tx: Tx,
  userId: string,
  payerId: string,
  entry: z.input<typeof validRefund>,
  today: string,
  billingEntityId?: string,
): Promise<Result> {
  const r = validRefund.safeParse(entry);
  if (!r.success) return { ok: false, message: r.error.issues[0].message };
  if (!z.iso.date().safeParse(today).success) return { ok: false, message: "Date invalide." };
  if (billingEntityId !== undefined && !isUuid(billingEntityId))
    return { ok: false, message: "Entreprise introuvable." };
  if (!isUuid(payerId)) return { ok: false, message: "Payeur introuvable." };
  const who = await memberAndRole(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  if (!mayRefund(who.role)) return { ok: false, message: "Seule la direction peut rembourser un payeur." };
  // Refunds of one payer wait for each other, and for a payment or a reverse entry being
  // saved for them (its key to the payer takes KEY SHARE, which FOR UPDATE waits for):
  // the balance read below, in a statement of its own, sees what they wrote once committed.
  const [p] = await tx.select({ id: person.id }).from(person).where(eq(person.id, payerId)).for("update");
  if (!p) return { ok: false, message: "Payeur introuvable." };
  const entities = await listEntities(tx);
  let entity: string;
  if (billingEntityId === undefined) {
    // The record was opened before a second entity was added: it did not say which one refunds.
    if (entities.length > 1) return { ok: false, message: REFUND_ENTITY_REQUIRED };
    const id = await defaultEntityId(tx);
    if (!id) return { ok: false, message: NO_DEFAULT_ENTITY };
    entity = id;
  } else {
    // An inactive entity may still pay back what it received in excess.
    if (!entities.some((e) => e.id === billingEntityId)) return { ok: false, message: "Entreprise introuvable." };
    entity = billingEntityId;
  }
  // Same lock as createDeposit, cancelDeposit and correctPayment (#247, #253), ordered by id:
  // a deposit cancelled or a cheque rejected at the same moment is seen by the read below,
  // so a refund is never paid out of a cheque that is no longer collected.
  await tx
    .select({ id: payment.id })
    .from(payment)
    .where(and(eq(payment.payerId, payerId), eq(payment.billingEntityId, entity)))
    .orderBy(asc(payment.id))
    .for("no key update");
  const owed = (await balancesOf(tx, payerId, today))?.refunds[entity];
  const refusal = refundRefusal({
    amountCents: r.data.amountCents,
    overpaidCents: owed?.overpaid ?? 0,
    refundableCents: owed?.refundable ?? 0,
    uncollectedCents: owed?.uncollected ?? 0,
    date: r.data.date,
    today,
  });
  if (refusal) return { ok: false, message: refusal };
  const [{ id }] = await tx
    .insert(payment)
    .values({
      schoolId: CURRENT_SCHOOL,
      billingEntityId: entity,
      payerId: payerId,
      date: r.data.date,
      amountCents: -r.data.amountCents,
      method: r.data.method,
      reference: r.data.reference,
      reversalKind: "refund",
      enteredBy: who.id,
    })
    .returning({ id: payment.id });
  await log(tx, who.id, id, {
    montant_centimes: -r.data.amountCents,
    method: r.data.method,
    date: r.data.date,
    reversal_kind: "refund",
    billing_entity_id: entity,
  });
  return { ok: true, ids: [id] };
}

/**
 * Cancels all or part of a refund entered by mistake (#346): wrong amount, method, date,
 * payer or business. The refund stays, immutable; a positive reverse entry of kind
 * `refund_cancellation` cancels it, `corrects_id` = the refund, same business (key
 * payment_corrects_same_entity_fk), method, reference and issuer, dated today, at most what
 * is not cancelled yet. It is never on a deposit slip (`toDeposit`) and the payment log
 * totals it with the refunds (`totals`). Management only (`mayCancelRefund`, default of #346
 * question 1). The payer is locked first, as `refundPayer` does: two cancellations of one
 * refund, or a cancellation and a refund for the same payer, wait for each other.
 */
export async function cancelRefundPayment(
  tx: Tx,
  userId: string,
  refundId: string,
  amountCents: number,
  today: string,
): Promise<Result> {
  if (!isUuid(refundId)) return { ok: false, message: "Ce remboursement n’existe plus." };
  if (!z.iso.date().safeParse(today).success) return { ok: false, message: "Date invalide." };
  const who = await memberAndRole(tx, userId);
  if (!who) return { ok: false, message: "Accès refusé." };
  if (!mayCancelRefund(who.role)) return { ok: false, message: "Seule la direction peut annuler un remboursement." };
  // The payer and the business of a payment never change: read before taking the locks.
  const [r] = await tx
    .select({ payerId: payment.payerId, billingEntityId: payment.billingEntityId })
    .from(payment)
    .where(eq(payment.id, refundId));
  if (!r) return { ok: false, message: "Ce remboursement n’existe plus." };
  await tx.select({ id: person.id }).from(person).where(eq(person.id, r.payerId)).for("update");
  // Only the refund's row: a correction or a deposit locks the payments it handles, then
  // waits for the payer when it inserts, so locking them all here could deadlock with it.
  await tx.select({ id: payment.id }).from(payment).where(eq(payment.id, refundId)).for("no key update");
  // A statement of its own, after the locks: it sees a cancellation committed meanwhile.
  const [o] = await tx
    .select({
      amount: payment.amountCents,
      method: payment.method,
      reference: payment.reference,
      issuer: payment.issuer,
      reversalKind: payment.reversalKind,
      cancelled: alreadyCorrected,
    })
    .from(payment)
    .where(eq(payment.id, refundId));
  if (!o || !isRefund(o)) return { ok: false, message: "Ce paiement n’est pas un remboursement." };
  const refusal = refundCancellationRefusal({
    amountCents,
    leftCents: refundLeftCents({ amountCents: o.amount, cancelledCents: o.cancelled }),
  });
  if (refusal) return { ok: false, message: refusal };
  const [{ id }] = await tx
    .insert(payment)
    .values({
      schoolId: CURRENT_SCHOOL,
      billingEntityId: r.billingEntityId,
      payerId: r.payerId,
      date: today,
      amountCents: amountCents,
      method: o.method,
      reference: o.reference,
      issuer: o.issuer,
      correctsId: refundId,
      reversalKind: "refund_cancellation",
      enteredBy: who.id,
    })
    .returning({ id: payment.id });
  await log(tx, who.id, id, {
    montant_centimes: amountCents,
    method: o.method,
    date: today,
    corrige_id: refundId,
    reversal_kind: "refund_cancellation",
    billing_entity_id: r.billingEntityId,
  });
  return { ok: true, ids: [id] };
}
