/**
 * Who can be a student's legal guardian (#216, recommended rule pending the
 * school's validation): only an individual. An organisation (works council,
 * company, town hall) can still pay for a student (« Facturé à ») or be
 * linked as another relative.
 */

export type PersonType = "individual" | "organisation";
type RelationshipKind = "legal_guardian" | "partner" | "other";

/** Person types offered and accepted as legal guardian. */
export const GUARDIAN_PERSON_TYPES = ["individual"] as const satisfies readonly PersonType[];

export const ORGANISATION_GUARDIAN_REFUSAL =
  "Un organisme ne peut pas être représentant légal. Ajoutez-le comme « Facturé à » ou en contact.";

export function canBeLegalGuardian(type: PersonType): boolean {
  return GUARDIAN_PERSON_TYPES.some((t) => t === type);
}

/**
 * Refusal message for a relationship whose person (`personId` side, who is
 * <type> of the other) has `guardianType`; null when the relationship is allowed.
 */
export function guardianRefusal(relationshipType: RelationshipKind, guardianType: PersonType): string | null {
  return relationshipType === "legal_guardian" && !canBeLegalGuardian(guardianType)
    ? ORGANISATION_GUARDIAN_REFUSAL
    : null;
}
