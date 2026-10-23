/**
 * Solde d'un payeur (#97), en centimes. Tant que les factures n'existent pas,
 * le dû se calcule sur les inscriptions et les carnets du payeur, et les
 * paiements s'enregistrent sur le payeur.
 */

export type EnrollmentStatus = "essai" | "liste_attente" | "active" | "abandon" | "terminee";

/** Statuts comptés dans le dû. Abandon et essai : règle à fixer par l'école (#99), montrés à part. */
export const DUE_STATUSES: EnrollmentStatus[] = ["active", "terminee"];

export type EnrollmentDue = { status: EnrollmentStatus; netPriceCents: number };
export type BalancePayment = { amountCents: number; plannedPayment: string | null };

export type Balance = {
  du: number;
  paye: number;
  /** Positif : reste à payer ; négatif : trop-perçu. */
  remaining: number;
  /** Chèques reçus mais à encaisser après aujourd'hui (comptés dans « payé »). */
  toCollect: number;
  /** Inscriptions hors du calcul, par statut (montants), pour que la direction les voie. */
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
