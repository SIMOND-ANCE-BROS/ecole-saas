import type { EnrollmentResult } from "../tariff/types";

/** A saved enrollment as the tariff engine recomputes it: its reference and the discount it was saved with. */
export type SavedDiscount = { reference: string; savedDiscountCents: number };

/** A saved enrollment whose discount would differ after a change (siblings…), told to the front desk. */
export type DiscountImpact = { reference: string; savedDiscountCents: number; recalculatedDiscountCents: number };

/**
 * Q2 (#284, #155): the saved enrollments of the payer whose discount differs once
 * another enrollment is created, confirmed, dropped or cancelled. A raise is applied
 * when nothing bills the enrollment yet (`raisedNow`); any other difference is only
 * reported. An enrollment the engine could not price again is not reported.
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

/** Where a saved enrollment stands for being re-priced: what the tariff engine cannot know. */
export type RepricingState = {
  /** Its price was typed by hand (#292): final, never re-priced. */
  manual: boolean;
  /** A line of an invoice other than an unsent draft bills it: frozen once issued. */
  invoiced: boolean;
  /** A payment is allocated to an installment of an unsent draft billing it: that draft cannot be drafted again. */
  paidDraft: boolean;
  /** It was saved at the grid price the engine finds now: its discount is computed on what it costs. */
  sameGross: boolean;
};

/**
 * #155 Q2 (owner, 2026-11-15): a discount raised by a new sibling applies to the installments
 * not invoiced yet, with no credit note on what is invoiced. An enrollment no invoice bills yet
 * (an unsent draft aside, drafted again) has only future installments: it gets the raised
 * discount at once. One already invoiced is only reported: its issued invoice and installments
 * are frozen, and lowering what is left of them has no mechanism yet (#155). A lowered discount
 * (a sibling leaving) is never applied (#284 Q2), and neither is a raise when the same change
 * lowers another sibling (`raisesMayApply`).
 */
export function raisedNow(impact: DiscountImpact, state: RepricingState): boolean {
  return (
    impact.recalculatedDiscountCents > impact.savedDiscountCents &&
    !state.manual &&
    !state.invoiced &&
    !state.paidDraft &&
    state.sameGross
  );
}

/**
 * Whether the raises of one change may be applied at all: not when the same change lowers
 * another saved enrollment's discount (a child moving up the ranking, #290), which is only
 * reported. Applying the raise alone would discount the family twice.
 */
export function raisesMayApply(impacts: readonly DiscountImpact[]): boolean {
  return impacts.every((i) => i.recalculatedDiscountCents >= i.savedDiscountCents);
}
