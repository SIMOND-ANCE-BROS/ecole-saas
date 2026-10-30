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
 *
 * The medical certificate is asked of every minor, and of an adult only through
 * their courses (#306): a course in a discipline the school marks « certificat
 * médical exigé des adultes » (jazz, not couple dances), or any competition
 * course. The mark is data on each discipline, set by the school (on by default).
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
  /** Date written on the document (a medical certificate's), from which its validity runs; null: not entered. */
  datedOn: string | null;
  /** The family's answer (image rights, parental consent); false: refused. */
  granted: boolean;
  validUntil: string | null;
};

/**
 * Last valid day of a document dated `date`, given the school's validity: the
 * day before its anniversary (dated 2025-09-10, three years: valid until
 * 2028-09-09; dated 29 February, one year: until 28 February); null: no expiry.
 */
export function validUntilFor(date: string, validityMonths: number | null): string | null {
  if (validityMonths === null) return null;
  const anniversary = addMonths(date, validityMonths);
  // A shorter month already brought the day back (29 February → 28): that day is the last one.
  return anniversary.slice(8) < date.slice(8) ? anniversary : addDays(anniversary, -1);
}

export type DocumentState = "missing" | "expired" | "refused" | "received";

/** Where a document stands on `today`: an expired one is to bring again. */
export function documentState(doc: ReceivedDocument | undefined, today: string): DocumentState {
  if (!doc) return "missing";
  if (doc.validUntil !== null && doc.validUntil < today) return "expired";
  return doc.granted ? "received" : "refused";
}

/** A course the student is enrolled in this season (active or trial), as the documents see it (#306). */
export type EnrolledCourse = {
  /** A competition course: every competitor brings a medical certificate. */
  competition: boolean;
  /** Its discipline asks adults for a medical certificate (a school setting). */
  adultsNeedCertificate: boolean;
};

/** The one document whose requirement of adults follows their courses (#306). */
export const COURSE_DEPENDENT_TYPE = "medical_certificate" satisfies RequirableType;

/** Whether these courses ask an adult for a medical certificate: one in a discipline that requires it, or competing. */
export function certificateAskedOfAdult(courses: readonly EnrolledCourse[]): boolean {
  return courses.some((c) => c.competition || c.adultsNeedCertificate);
}

/**
 * Required documents that apply to this student (age on `today`, courses of
 * the season), whatever they handed in. A document set for minors only is
 * never asked of an adult; the medical certificate, asked of every student,
 * is asked of an adult only when `certificateAskedOfAdult`.
 */
export function expectedDocuments(
  requirements: readonly Requirement[],
  birthDate: string | null,
  today: string,
  courses: readonly EnrolledCourse[],
): RequirableType[] {
  const minor = isMinor(birthDate, today);
  const askedOfAdult = (r: Requirement) =>
    !r.minorsOnly && (r.type !== COURSE_DEPENDENT_TYPE || certificateAskedOfAdult(courses));
  return requirements.filter((r) => r.required && (minor || askedOfAdult(r))).map((r) => r.type);
}

/**
 * Required documents the record offers to enter for this student, whatever
 * their courses: an adult not enrolled yet, or only in couple dances, may
 * still hand in a medical certificate (#306). Those `expectedDocuments` keeps
 * are the ones actually asked.
 */
export function recordableDocuments(
  requirements: readonly Requirement[],
  birthDate: string | null,
  today: string,
): RequirableType[] {
  const minor = isMinor(birthDate, today);
  return requirements.filter((r) => r.required && (minor || !r.minorsOnly)).map((r) => r.type);
}

/** A required document still to bring: due on `dueOn` (included), overdue after it. */
export type DocumentToBring = { type: RequirableType; dueOn: string; overdue: boolean };

/**
 * Required documents still to bring (never received, or expired) by a student
 * enrolled in the current season (active or trial) since `enrolledOn`, their
 * first enrollment date of the season; none for a student not enrolled: the
 * school only chases papers of students who dance this season. Each is due
 * `dueWithinDays` after that date, or after the day it expired when that is
 * later (a certificate running out mid-season gets the same delay to be
 * renewed). A refused answer is an answer: not to bring. `courses`: the
 * student's courses of the season, for `expectedDocuments`.
 */
export function documentsToBring({
  requirements,
  documents,
  birthDate,
  enrolledOn,
  today,
  courses,
}: {
  requirements: readonly Requirement[];
  documents: readonly ReceivedDocument[];
  birthDate: string | null;
  enrolledOn: string | null;
  today: string;
  courses: readonly EnrolledCourse[];
}): DocumentToBring[] {
  if (enrolledOn === null) return [];
  const expected = expectedDocuments(requirements, birthDate, today, courses);
  return requirements.flatMap((r) => {
    if (!expected.includes(r.type)) return [];
    const doc = documents.find((d) => d.type === r.type);
    const state = documentState(doc, today);
    if (state !== "missing" && state !== "expired") return [];
    const expiredOn = state === "expired" && doc?.validUntil ? addDays(doc.validUntil, 1) : null;
    const from = expiredOn !== null && expiredOn > enrolledOn ? expiredOn : enrolledOn;
    const dueOn = addDays(from, r.dueWithinDays);
    return [{ type: r.type, dueOn, overdue: today > dueOn }];
  });
}

/** Documents overdue: what the students list shows in « Documents manquants ». */
export function missingDocuments(args: Parameters<typeof documentsToBring>[0]): RequirableType[] {
  return documentsToBring(args)
    .filter((d) => d.overdue)
    .map((d) => d.type);
}
