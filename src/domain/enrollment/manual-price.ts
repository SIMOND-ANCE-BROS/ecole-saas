import type { Role } from "../team/rules";

/**
 * A price typed by hand on an enrollment (#292): a pro rata for a student enrolling
 * during the season, a gesture decided case by case, or a combination of courses the
 * grid has no package for. Same rules as a lesson pack sold apart from the grid
 * (#286, `domain/lesson-pack/pack.ts`). The issue's open questions, each decided here
 * and nowhere else with the recommended default:
 *
 * - Q1 (who may change the price), default: the front desk and management, always
 *   with a reason (`PRICE_CHANGE_ROLES`, `manualPriceRefusal`).
 * - Q2 (siblings discount and typed price), default: the typed price is the final
 *   price. The siblings discount is still computed on the grid price and shown, but
 *   it does not apply to the typed price (`savedNetPrice`).
 *
 * One submission may create one enrollment per business (#299): each has its own
 * typed price, or none.
 */

/** Q1 default: roles that may type an enrollment's price, with a reason. */
export const PRICE_CHANGE_ROLES = ["director", "front_desk"] as const satisfies readonly Role[];

/** Longest reason kept for a typed price. */
export const MAX_REASON_LENGTH = 200;

/** Bound of the form, not a business rule. */
export const MAX_PRICE_CENTS = 1_000_000;

export type ManualPrice = { priceCents: number; reason: string };

export const NO_GRID_PRICE = "Aucun forfait de la grille pour ces cours : saisissez le prix.";
export const REASON_REQUIRED = "Prix saisi à la main : indiquez le motif.";

/** The typed price differs from the computed one, or replaces a missing one. */
const differs = (computedNetCents: number | null, manual: ManualPrice) => manual.priceCents !== computedNetCents;

/**
 * Why the price of an enrollment cannot be recorded, or null. `computedNetCents`: the
 * price of the grid after discounts, null when the grid has no package for the courses.
 */
export function manualPriceRefusal(
  e: { computedNetCents: number | null; manual: ManualPrice | null },
  role: Role,
): string | null {
  if (e.manual === null) return e.computedNetCents === null ? NO_GRID_PRICE : null;
  if (!Number.isInteger(e.manual.priceCents) || e.manual.priceCents < 0 || e.manual.priceCents > MAX_PRICE_CENTS)
    return "Prix invalide.";
  if (!differs(e.computedNetCents, e.manual)) return null;
  if (!(PRICE_CHANGE_ROLES as readonly Role[]).includes(role))
    return "Votre rôle ne permet pas de modifier le prix d’une inscription.";
  const reason = e.manual.reason.trim();
  if (reason === "") return REASON_REQUIRED;
  if (reason.length > MAX_REASON_LENGTH) return `Motif trop long (${MAX_REASON_LENGTH} caractères au plus).`;
  return null;
}

/** The typed price to save, with its trimmed reason; null when it is the computed price (nothing to keep). */
export function keptManualPrice(computedNetCents: number | null, manual: ManualPrice | null): ManualPrice | null {
  if (manual === null || !differs(computedNetCents, manual)) return null;
  return { priceCents: manual.priceCents, reason: manual.reason.trim() };
}

/**
 * Q2 default: what the enrollment costs. The typed price when there is one, the grid
 * price less its discount otherwise. Mirrors the generated column `enrollment.net_price_cents`.
 */
export const savedNetPrice = (p: { grossPriceCents: number; discountCents: number; manualPriceCents: number | null }) =>
  p.manualPriceCents ?? p.grossPriceCents - p.discountCents;
