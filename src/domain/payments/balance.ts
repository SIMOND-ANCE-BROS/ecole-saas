/**
 * A payer's balance (#97), in cents. Until invoices exist, the amount due is
 * computed from the payer's enrollments and lesson packs, and payments are
 * recorded against the payer.
 */

export type EnrollmentStatus = "trial" | "waitlist" | "active" | "dropped" | "ended";

/**
 * Statuses counted in the amount due. A drop-out stays due: the school's rules say a paid
 * quarter or year not attended is neither carried over nor refunded (#284, #99); management
 * grants a credit case by case. Trial and waitlist are not due yet, shown apart.
 */
export const DUE_STATUSES: EnrollmentStatus[] = ["active", "ended", "dropped"];

export type EnrollmentDue = { status: EnrollmentStatus; netPriceCents: number };
export type BalancePayment = { amountCents: number; plannedPayment: string | null };

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
  enrollments.filter((i) => DUE_STATUSES.includes(i.status)).reduce((s, i) => s + i.netPriceCents, 0);

export function payerBalance(
  enrollments: EnrollmentDue[],
  lessonPacks: { priceCents: number }[],
  payments: BalancePayment[],
  today: string,
): Balance {
  let due = lessonPacks.reduce((s, c) => s + c.priceCents, 0);
  const outsideCalculation: Balance["outsideCalculation"] = {};
  for (const i of enrollments) {
    if (DUE_STATUSES.includes(i.status)) due += i.netPriceCents;
    else outsideCalculation[i.status] = (outsideCalculation[i.status] ?? 0) + i.netPriceCents;
  }
  const paid = payments.reduce((s, p) => s + p.amountCents, 0);
  const toCollect = payments
    .filter((p) => p.amountCents > 0 && p.plannedPayment !== null && p.plannedPayment > today)
    .reduce((s, p) => s + p.amountCents, 0);
  return { due, paid, remaining: due - paid, toCollect, outsideCalculation };
}
