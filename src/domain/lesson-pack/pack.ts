import type { Role } from "../team/rules";

/**
 * Lesson packs of private lessons (#286): what a pack sold to a payer allows,
 * and the school's answers or the recommended defaults of the issue's open
 * questions, each decided here and nowhere else.
 *
 * - Q1 (expiry, answered 2026-10-29): « pas de date limite ». A pack never
 *   expires: it stays open until its lessons are used up (`isOpen`).
 * - Q4 (who may change a grid price), default: the front desk and management,
 *   always with a reason (`PRICE_CHANGE_ROLES`, `priceRefusal`).
 * - Q5 (unused lessons when a family stops), default: nothing automatic. No
 *   code refunds or credits a pack; management decides case by case (#99).
 */

/** Q4 default: roles that may sell a pack at another price than the grid's, with a reason. */
export const PRICE_CHANGE_ROLES = ["director", "front_desk"] as const satisfies readonly Role[];

/** Longest reason kept for a price changed from the grid. */
export const MAX_REASON_LENGTH = 200;

/**
 * Bounds of the form, not business rules: the school's grid says which packs exist,
 * a pack outside it is priced on quote.
 */
export const MAX_LESSONS = 100;
export const MAX_PEOPLE = 10;
export const MAX_PRICE_CENTS = 1_000_000;

export type PackCount = { lessonCount: number; usedCount: number };

/** Lessons left on a pack; never below 0 (a pack is never over-used, see the usage lock). */
export const remainingLessons = (p: PackCount): number => Math.max(p.lessonCount - p.usedCount, 0);

/** Q1: a pack never expires, it is open while lessons remain. */
export const isOpen = (p: PackCount): boolean => remainingLessons(p) > 0;

/** « Carnet 10 séances — 7 restantes », « Carnet 1 séance — épuisé ». */
export function packLabel(p: PackCount): string {
  const left = remainingLessons(p);
  const size = `Carnet ${p.lessonCount} séance${p.lessonCount > 1 ? "s" : ""}`;
  if (left === 0) return `${size} — épuisé`;
  return `${size} — ${left} restante${left > 1 ? "s" : ""}`;
}

export type Sale = {
  lessonCount: number;
  /** People the pack is priced for (the grid's band). */
  peopleCount: number;
  /** Students named on the pack: the lessons of any of them can be counted on it. */
  participantIds: readonly string[];
};

/** Why a sale cannot be recorded as entered, or null. */
export function saleRefusal(s: Sale): string | null {
  if (!Number.isInteger(s.lessonCount) || s.lessonCount < 1 || s.lessonCount > MAX_LESSONS)
    return `Nombre de séances invalide (1 à ${MAX_LESSONS}).`;
  if (!Number.isInteger(s.peopleCount) || s.peopleCount < 1 || s.peopleCount > MAX_PEOPLE)
    return `Nombre de personnes invalide (1 à ${MAX_PEOPLE}).`;
  const participants = new Set(s.participantIds).size;
  if (participants === 0) return "Choisissez au moins un élève.";
  if (participants !== s.participantIds.length) return "Un élève est choisi deux fois.";
  if (participants > s.peopleCount)
    return `Ce carnet est pour ${s.peopleCount} personne${s.peopleCount > 1 ? "s" : ""} : ${participants} élèves sont choisis.`;
  return null;
}

export type PriceEntry = {
  /** Price of the grid for this pack; null: no line in the grid, price on quote. */
  gridPriceCents: number | null;
  priceCents: number | null;
  reason: string;
};

export const NO_GRID_PRICE = "Aucun tarif pour ce carnet : saisissez le prix.";
export const REASON_REQUIRED = "Le prix diffère de la grille : indiquez le motif.";

/** A price differs from the grid only with a reason (Q4); without a grid line the price is required. */
export const priceDiffers = (e: Pick<PriceEntry, "gridPriceCents" | "priceCents">): boolean =>
  e.gridPriceCents !== null && e.priceCents !== e.gridPriceCents;

/** Why the price cannot be recorded, or null. */
export function priceRefusal(e: PriceEntry, role: Role): string | null {
  if (e.priceCents === null) return e.gridPriceCents === null ? NO_GRID_PRICE : "Indiquez le prix.";
  if (!Number.isInteger(e.priceCents) || e.priceCents < 0) return "Prix invalide.";
  if (!priceDiffers(e)) return null;
  if (!(PRICE_CHANGE_ROLES as readonly Role[]).includes(role))
    return "Votre rôle ne permet pas de changer le prix de la grille.";
  if (e.reason.trim() === "") return REASON_REQUIRED;
  if (e.reason.trim().length > MAX_REASON_LENGTH) return `Motif trop long (${MAX_REASON_LENGTH} caractères au plus).`;
  return null;
}
