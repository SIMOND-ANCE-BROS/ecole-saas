import type { Role } from "../team/rules";

/**
 * Workshop sign-ups (#297): a payer signs one or more of their students up for a workshop
 * (a course of type `workshop`), at the price per participant set on it, or at another price
 * with a reason. Sold by the workshop's business with its VAT treatment, both frozen on the
 * sign-up like a lesson pack's. The issue's open questions, each decided here and nowhere
 * else with the recommended default:
 *
 * - Q1 (price per person, per couple or by length), default: a price per participant set on
 *   the workshop (`course.workshop_price_cents`): a sign-up owes it once per participant
 *   (`signupDueCents`).
 * - Q2 (siblings discount on workshops), default: no. Nothing is taken off a sign-up.
 *
 * Not decided here, open without a default (#297): what a workshop the school cancels owes,
 * whether a full workshop refuses a sign-up (capacity is only shown, `placesLeft`), when a
 * sign-up is due (#176) and how it reads on an invoice. Until then a sign-up counts on the
 * payer's balance at its price and on no invoice draft; the front desk may cancel one entered
 * by mistake.
 */

/** Who may type another price than the workshop's, with a reason (as #286 Q4, #292 Q1). */
export const PRICE_CHANGE_ROLES = ["director", "front_desk"] as const satisfies readonly Role[];

/** Longest reason kept for a typed price. */
export const MAX_REASON_LENGTH = 200;

/** Bounds of the form, not business rules. */
export const MAX_PARTICIPANTS = 10;
export const MAX_PRICE_CENTS = 1_000_000;

export const NO_WORKSHOP_PRICE = "Ce stage n’a pas de prix : saisissez le prix par participant.";
export const REASON_REQUIRED = "Le prix diffère de celui du stage : indiquez le motif.";
export const ALREADY_SIGNED_UP = "Un des élèves choisis est déjà inscrit à ce stage.";

export type SignupPriceEntry = {
  /** Price per participant set on the workshop; null when it has none. */
  workshopPriceCents: number | null;
  /** Price per participant typed or prefilled; null when nothing was typed. */
  priceCents: number | null;
  reason: string;
};

/** A price differs from the workshop's only with a reason; without a price on the workshop it is required. */
export const signupPriceDiffers = (e: Pick<SignupPriceEntry, "workshopPriceCents" | "priceCents">): boolean =>
  e.workshopPriceCents !== null && e.priceCents !== e.workshopPriceCents;

/** Why the price per participant cannot be recorded, or null. */
export function signupPriceRefusal(e: SignupPriceEntry, role: Role): string | null {
  if (e.priceCents === null) return e.workshopPriceCents === null ? NO_WORKSHOP_PRICE : "Indiquez le prix.";
  if (!Number.isInteger(e.priceCents) || e.priceCents < 0 || e.priceCents > MAX_PRICE_CENTS) return "Prix invalide.";
  if (!signupPriceDiffers(e)) return null;
  if (!(PRICE_CHANGE_ROLES as readonly Role[]).includes(role))
    return "Votre rôle ne permet pas de changer le prix d’un stage.";
  const reason = e.reason.trim();
  if (reason === "") return REASON_REQUIRED;
  if (reason.length > MAX_REASON_LENGTH) return `Motif trop long (${MAX_REASON_LENGTH} caractères au plus).`;
  return null;
}

/** Why these participants cannot be signed up, or null. `alreadySignedUp`: students already on the workshop. */
export function signupRefusal(s: {
  participantIds: readonly string[];
  alreadySignedUp: readonly string[];
}): string | null {
  const unique = new Set(s.participantIds).size;
  if (unique === 0) return "Choisissez au moins un élève.";
  if (unique !== s.participantIds.length) return "Un élève est choisi deux fois.";
  if (unique > MAX_PARTICIPANTS) return `${MAX_PARTICIPANTS} participants au plus par inscription.`;
  if (s.participantIds.some((id) => s.alreadySignedUp.includes(id))) return ALREADY_SIGNED_UP;
  return null;
}

export type SignupDue = { unitPriceCents: number; participantCount: number };

/** Q1 default: what a sign-up owes, its price per participant once per participant; Q2: no discount. */
export const signupDueCents = (s: SignupDue): number => s.unitPriceCents * s.participantCount;

/** Places left on a workshop, shown to the front desk; null without a capacity. Never refuses (open question). */
export function placesLeft(w: { maxCapacity: number | null; participants: number }): number | null {
  return w.maxCapacity === null ? null : Math.max(w.maxCapacity - w.participants, 0);
}
