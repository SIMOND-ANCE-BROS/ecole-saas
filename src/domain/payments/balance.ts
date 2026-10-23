/**
 * A payer's balance (#97), in cents. Until invoices exist, the amount due is
 * computed from the payer's enrollments and lesson packs, and payments are
 * recorded against the payer.
 */

export type EnrollmentStatus = "essai" | "liste_attente" | "active" | "abandon" | "terminee";

/** Statuses counted in the amount due. Dropped and trial: rule to be set by the school (#99), shown apart. */
export const DUE_STATUSES: EnrollmentStatus[] = ["active", "terminee"];

export type EnrollmentDue = { status: EnrollmentStatus; netPriceCents: number };
export type BalancePayment = { amountCents: number; plannedPayment: string | null };

export type Balance = {
  du: number;
  paye: number;
  /** Positive: left to pay; negative: overpaid. */
  remaining: number;
  /** Cheques received but to be cashed after today (counted in « payé »). */
  toCollect: number;
  /** Enrollments left out of the calculation, by status (amounts), so that management sees them. */
  outsideCalculation: Partial<Record<EnrollmentStatus, number>>;
};

export function payerBalance(
  enrollments: EnrollmentDue[],
  lessonPacks: { priceCents: number }[],
  payments: BalancePayment[],
  today: string,
): Balance {
  let du = lessonPacks.reduce((s, c) => s + c.priceCents, 0);
  const outsideCalculation: Balance["outsideCalculation"] = {};
  for (const i of enrollments) {
    if (DUE_STATUSES.includes(i.status)) du += i.netPriceCents;
    else outsideCalculation[i.status] = (outsideCalculation[i.status] ?? 0) + i.netPriceCents;
  }
  const paye = payments.reduce((s, p) => s + p.amountCents, 0);
  const toCollect = payments
    .filter((p) => p.amountCents > 0 && p.plannedPayment !== null && p.plannedPayment > today)
    .reduce((s, p) => s + p.amountCents, 0);
  return { du, paye, remaining: du - paye, toCollect, outsideCalculation };
}
