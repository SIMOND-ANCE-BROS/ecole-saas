/**
 * Legal guardians (#216, recommended rule pending the school's validation):
 * a legal guardian is an individual, and so is the person they are guardian
 * of. An organisation (works council, company, town hall) can still pay for a
 * student (« Facturé à ») or be linked as another relative.
 */

/** Same values as the database enums `person_type` and `relationship_type` (checked in src/db/people.ts). */
export const PERSON_TYPES = ["individual", "organisation"] as const;
export type PersonType = (typeof PERSON_TYPES)[number];
export const RELATIONSHIP_KINDS = ["legal_guardian", "partner", "other"] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

/** Person types offered and accepted on both sides of a legal-guardian relationship. */
export const GUARDIAN_PERSON_TYPES = ["individual"] as const satisfies readonly PersonType[];

export const ORGANISATION_GUARDIAN_REFUSAL =
  "Un organisme ne peut pas être représentant légal. Ajoutez-le comme « Facturé à » ou en contact.";
export const ORGANISATION_WARD_REFUSAL = "Un organisme ne peut pas avoir de représentant légal.";
export const GUARDIAN_BECOMES_ORGANISATION_REFUSAL =
  "Cette personne est représentant légal d’un élève : un organisme ne peut pas l’être. Retirez d’abord ce lien.";
export const WARD_BECOMES_ORGANISATION_REFUSAL =
  "Cette personne a un représentant légal : un organisme ne peut pas en avoir. Retirez d’abord ce lien.";
export const REVERSED_GUARDIAN_PAYER_REFUSAL =
  "Cet organisme est enregistré comme représenté par l’élève : supprimez ce lien avant de le choisir comme payeur.";

export function canBeLegalGuardian(type: PersonType): boolean {
  return GUARDIAN_PERSON_TYPES.some((t) => t === type);
}

/**
 * Refusal message for a relationship where `holder` is <type> of `other`
 * (`person_id` and `related_person_id`); null when it is allowed.
 */
export function guardianRefusal(type: RelationshipKind, holder: PersonType, other: PersonType): string | null {
  if (type !== "legal_guardian") return null;
  if (!canBeLegalGuardian(holder)) return ORGANISATION_GUARDIAN_REFUSAL;
  if (!canBeLegalGuardian(other)) return ORGANISATION_WARD_REFUSAL;
  return null;
}

/**
 * Refusal message when a person's type changes to `type` while they hold
 * (`isGuardian`) or have (`hasGuardian`) a legal-guardian relationship.
 */
export function typeChangeRefusal(
  type: PersonType,
  links: { isGuardian: boolean; hasGuardian: boolean },
): string | null {
  if (canBeLegalGuardian(type)) return null;
  if (links.isGuardian) return GUARDIAN_BECOMES_ORGANISATION_REFUSAL;
  if (links.hasGuardian) return WARD_BECOMES_ORGANISATION_REFUSAL;
  return null;
}
