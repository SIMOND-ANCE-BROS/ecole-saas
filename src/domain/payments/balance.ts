import { seasonDueCents } from "../enrollment/quarters";
import type { Period } from "../tariff/types";

/**
 * A payer's balance (#97), in cents. What an issued invoice bills is due at the invoice's
 * amount (#305); what no issued invoice bills yet is due at its enrollment or lesson pack
 * price, as before invoices existed. Payments are recorded against the payer.
 */

export type EnrollmentStatus = "trial" | "waitlist" | "active" | "dropped" | "ended";

/**
 * Statuses counted in the amount due. A drop-out stays due: the school's rules say a paid
 * quarter or year not attended is neither carried over nor refunded (#284, #99); management
 * grants a credit case by case. Trial and waitlist are not due yet, shown apart.
 */
export const DUE_STATUSES: EnrollmentStatus[] = ["active", "ended", "dropped"];

/**
 * An enrollment as the balance counts it: its net price, owed once a season, or once per
 * covered quarter for a quarterly package (#291, `seasonDueCents`).
 */
export type EnrollmentDue = { status: EnrollmentStatus; period: Period; netPriceCents: number; quarterCount: number };
export type BalancePayment = { amountCents: number; plannedPayment: string | null };

/**
 * Billed by a line of an issued invoice (#305): then due at the invoice's amount, not at its
 * own price. Absent or false: counted from its price.
 */
export type MaybeInvoiced = { invoiced?: boolean };
/** An issued invoice or credit note (negative) of the payer, at its VAT-inclusive total. */
export type BalanceInvoice = { totalInclTaxCents: number };

export type Balance = {
  due: number;
  paid: number;
  /** Positive: left to pay; negative: overpaid. */
  remaining: number;
  /** Cheques received but to be cashed after today (counted in « payé »). */
  toCollect: number;
  /** Enrollments left out of the calculation, by status (amounts), so that management sees them. */
  outsideCalculation: Partial<Record<EnrollmentStatus, number>>;
};

/** Amount due for these enrollments: the ones whose status is in `DUE_STATUSES`. */
export const amountDue = (enrollments: readonly EnrollmentDue[]): number =>
  enrollments.filter((i) => DUE_STATUSES.includes(i.status)).reduce((s, i) => s + seasonDueCents(i), 0);

export function payerBalance(
  enrollments: readonly (EnrollmentDue & MaybeInvoiced)[],
  lessonPacks: readonly ({ priceCents: number } & MaybeInvoiced)[],
  payments: readonly BalancePayment[],
  today: string,
  invoices: readonly BalanceInvoice[] = [],
): Balance {
  let due =
    invoices.reduce((s, f) => s + f.totalInclTaxCents, 0) +
    lessonPacks.filter((c) => !c.invoiced).reduce((s, c) => s + c.priceCents, 0);
  const outsideCalculation: Balance["outsideCalculation"] = {};
  for (const i of enrollments) {
    if (i.invoiced) continue;
    if (DUE_STATUSES.includes(i.status)) due += seasonDueCents(i);
    else outsideCalculation[i.status] = (outsideCalculation[i.status] ?? 0) + seasonDueCents(i);
  }
  const paid = payments.reduce((s, p) => s + p.amountCents, 0);
  const toCollect = payments
    .filter((p) => p.amountCents > 0 && p.plannedPayment !== null && p.plannedPayment > today)
    .reduce((s, p) => s + p.amountCents, 0);
  return { due, paid, remaining: due - paid, toCollect, outsideCalculation };
}

/** The billing entity an enrollment, a lesson pack or a payment belongs to (ADR 0006). */
type OfEntity = { billingEntityId: string };

/**
 * A payer's balance per billing entity, plus the family total (#300), reading the payer's
 * issued invoices when there are any (#305, `payerBalance`). Each business
 * cashes into its own account (#288 Q4): a payment only settles what is owed to its
 * own entity, an overpayment to one is never netted against the other, and a reverse
 * entry (correction, rejection) carries the entity of the payment it cancels. Only the
 * entities the payer owes or paid appear in `byEntity`.
 */
export function balancesByEntity(
  enrollments: readonly (EnrollmentDue & MaybeInvoiced & OfEntity)[],
  lessonPacks: readonly ({ priceCents: number } & MaybeInvoiced & OfEntity)[],
  payments: readonly (BalancePayment & OfEntity)[],
  today: string,
  invoices: readonly (BalanceInvoice & OfEntity)[] = [],
): { byEntity: Record<string, Balance>; total: Balance } {
  const ids = new Set([...enrollments, ...lessonPacks, ...payments, ...invoices].map((x) => x.billingEntityId));
  const byEntity: Record<string, Balance> = {};
  for (const id of ids) {
    const mine = <T extends OfEntity>(rows: readonly T[]) => rows.filter((r) => r.billingEntityId === id);
    byEntity[id] = payerBalance(mine(enrollments), mine(lessonPacks), mine(payments), today, mine(invoices));
  }
  return { byEntity, total: payerBalance(enrollments, lessonPacks, payments, today, invoices) };
}

/**
 * What a family owes over several entities (#300), never netted: `owed` adds up what is
 * left to pay to each entity, `overpaid` what each entity received in excess. An
 * overpayment to one business never settles a debt to another (separate accounts, #288 Q4).
 */
export function familyOwed(byEntity: readonly Balance[]): { owed: number; overpaid: number } {
  let owed = 0;
  let overpaid = 0;
  for (const b of byEntity) {
    if (b.remaining > 0) owed += b.remaining;
    else overpaid -= b.remaining;
  }
  return { owed, overpaid };
}

/**
 * The entity a new payment is preselected on (#300): among `offered` (the school's
 * default first), the one the payer owes the most; a tie keeps the order offered, and
 * with nothing owed anywhere it is the first one. Null when nothing is offered.
 */
export function entityOwingMost(
  offered: readonly string[],
  byEntity: Readonly<Record<string, Balance>>,
): string | null {
  let best: string | null = null;
  let most = 0;
  for (const id of offered) {
    const owed = byEntity[id]?.remaining ?? 0;
    if (best === null || owed > most) {
      best = id;
      most = Math.max(owed, 0);
    }
  }
  return best;
}
