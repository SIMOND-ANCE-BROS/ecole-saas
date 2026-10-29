import { addMonths } from "../invoicing/installments";
import { addDays } from "../schedule/week";
import { isMinor } from "./age";

/**
 * Documents received for each student (#287): which ones the school asks
 * for, and which are still to bring. Only tracking: no file is stored here (#184).
 *
 * Defaults, from the school's answers on #287 (2026-10-29):
 *  1. Only the medical certificate is asked, of every student; no parental
 *     consent is collected; image rights are accepted by signing the
 *     internal rules (#296), not with a document of their own.
 *  2. A medical certificate is valid three years from its date, editable per document.
 *  3. A student may be enrolled without it: it is due within 15 days of the
 *     enrollment, and only overdue after that day.
 * Each of these is a school setting; the defaults live in `DEFAULT_REQUIREMENTS`
 * below, and nowhere else.
 */

/** Document types, in the order of the `document_type` database enum. */
export const DOCUMENT_TYPES = ["medical_certificate", "parental_consent", "image_rights", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Types the school can ask for (« Autre document » has no meaning of its own). */
export const REQUIRABLE_TYPES = [
  "medical_certificate",
  "parental_consent",
  "image_rights",
] as const satisfies readonly DocumentType[];
export type RequirableType = (typeof REQUIRABLE_TYPES)[number];

/** Names shown to the user, shared by the record, the settings and the list (SQL included). */
export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  medical_certificate: "Certificat médical",
  parental_consent: "Autorisation parentale",
  image_rights: "Droit à l’image",
  other: "Autre document",
};

/** What the school asks for one document type. */
export type Requirement = {
  type: RequirableType;
  required: boolean;
  /** Asked only for students under 18 (parental consent). */
  minorsOnly: boolean;
  /** Months a document stays valid from its date; null: it never expires. */
  validityMonths: number | null;
  /** Days after the enrollment to bring it; overdue from the day after. */
  dueWithinDays: number;
};

/** Longest validity a school can set: ten years. */
export const VALIDITY_MONTHS_MAX = 120;
/** Longest delay to bring a document: a year. */
export const DUE_WITHIN_DAYS_MAX = 365;

/** Defaults from the school's answers on #287, until the school sets its own. */
export const DEFAULT_REQUIREMENTS: Record<RequirableType, Omit<Requirement, "type">> = {
  medical_certificate: { required: true, minorsOnly: false, validityMonths: 36, dueWithinDays: 15 },
  parental_consent: { required: false, minorsOnly: true, validityMonths: null, dueWithinDays: 15 },
  image_rights: { required: false, minorsOnly: false, validityMonths: null, dueWithinDays: 15 },
};

/** The school's requirements, one per type: what it saved, else the default. */
export function effectiveRequirements(saved: readonly Requirement[]): Requirement[] {
  return REQUIRABLE_TYPES.map((type) => saved.find((r) => r.type === type) ?? { type, ...DEFAULT_REQUIREMENTS[type] });
}

/** A document as recorded for a student: received (or refused) on a date, valid until a date. */
export type ReceivedDocument = {
  type: DocumentType;
  /** null: recorded before #287, date unknown. */
  receivedOn: string | null;
  /** The family's answer (image rights, parental consent); false: refused. */
  granted: boolean;
  validUntil: string | null;
};

/**
 * Last valid day of a document dated `date`, given the school's validity
 * (dated 2025-09-10, three years: valid until 2028-09-09); null: no expiry.
 */
export function validUntilFor(date: string, validityMonths: number | null): string | null {
  return validityMonths === null ? null : addDays(addMonths(date, validityMonths), -1);
}

export type DocumentState = "missing" | "expired" | "refused" | "received";

/** Where a document stands on `today`: an expired one is to bring again. */
export function documentState(doc: ReceivedDocument | undefined, today: string): DocumentState {
  if (!doc) return "missing";
  if (doc.validUntil !== null && doc.validUntil < today) return "expired";
  return doc.granted ? "received" : "refused";
}

/** Required documents that apply to this student (age on `today`), whatever they handed in. */
export function expectedDocuments(
  requirements: readonly Requirement[],
  birthDate: string | null,
  today: string,
): RequirableType[] {
  return requirements.filter((r) => r.required && (!r.minorsOnly || isMinor(birthDate, today))).map((r) => r.type);
}

/** A required document still to bring: due on `dueOn` (included), overdue after it. */
export type DocumentToBring = { type: RequirableType; dueOn: string; overdue: boolean };

/**
 * Required documents still to bring (never received, or expired) by a student
 * enrolled in the current season (active or trial) since `enrolledOn`, their
 * first enrollment date of the season; none for a student not enrolled: the
 * school only chases papers of students who dance this season. Each is due
 * `dueWithinDays` after that date. A refused answer is an answer: not to bring.
 */
export function documentsToBring({
  requirements,
  documents,
  birthDate,
  enrolledOn,
  today,
}: {
  requirements: readonly Requirement[];
  documents: readonly ReceivedDocument[];
  birthDate: string | null;
  enrolledOn: string | null;
  today: string;
}): DocumentToBring[] {
  if (enrolledOn === null) return [];
  const expected = expectedDocuments(requirements, birthDate, today);
  return requirements.flatMap((r) => {
    if (!expected.includes(r.type)) return [];
    const state = documentState(
      documents.find((d) => d.type === r.type),
      today,
    );
    if (state !== "missing" && state !== "expired") return [];
    const dueOn = addDays(enrolledOn, r.dueWithinDays);
    return [{ type: r.type, dueOn, overdue: today > dueOn }];
  });
}

/** Documents overdue: what the students list shows in « Documents manquants ». */
export function missingDocuments(args: Parameters<typeof documentsToBring>[0]): RequirableType[] {
  return documentsToBring(args)
    .filter((d) => d.overdue)
    .map((d) => d.type);
}
