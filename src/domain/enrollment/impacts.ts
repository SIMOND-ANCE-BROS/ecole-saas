import type { EnrollmentResult } from "../tariff/types";

/** A saved enrollment as the tariff engine recomputes it: its reference and the discount it was saved with. */
export type SavedDiscount = { reference: string; savedDiscountCents: number };

/** A saved enrollment whose discount would differ after a change (siblings…), told to the front desk. */
export type DiscountImpact = { reference: string; savedDiscountCents: number; recalculatedDiscountCents: number };

/**
 * Q2 (#284, #155): saved enrollments are never re-priced on their own when
 * another enrollment of the payer is created, confirmed, dropped or cancelled.
 * The difference is only reported, so management can decide on a credit note.
 * An enrollment the engine could not price again is not reported.
 */
export function discountImpacts(
  saved: readonly SavedDiscount[],
  recomputed: readonly EnrollmentResult[],
): DiscountImpact[] {
  return saved.flatMap((e) => {
    const r = recomputed.find((x) => x.reference === e.reference);
    if (r?.status !== "ok" || r.discountCents === e.savedDiscountCents) return [];
    return [
      { reference: e.reference, savedDiscountCents: e.savedDiscountCents, recalculatedDiscountCents: r.discountCents },
    ];
  });
}
