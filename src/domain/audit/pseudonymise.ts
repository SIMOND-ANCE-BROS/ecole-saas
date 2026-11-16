/**
 * Pseudonymisation of personal values in the audit log (#184, ADR 0010).
 *
 * Owner decision (2026-11-15): money entries and their audit rows are kept 10 years; the personal
 * values inside audit entries (`before`/`after`) are replaced by a placeholder 3 years after the end
 * of the relationship, the row and its technical values (amounts, dates, ids, methods) kept.
 *
 * The database applies it (`pseudonymise_audit_entries`, migration 0069) from its own list
 * (`audit_personal_keys()`); `PERSONAL_KEYS` is its mirror, kept equal by an integration test, so
 * the code can say which keys it expects to be redacted and spot keys nobody classified.
 */
import { isKeyOf } from "../../lib/has";

/** What a personal value becomes; `audit_placeholder()` in the database. */
export const PLACEHOLDER = "[pseudonymisé]";

/** Years after the end of the relationship before personal values are pseudonymised. */
export const RETENTION_YEARS = 3;

/**
 * Personal keys of each audited table: top-level keys of `before`/`after` whose string value is
 * replaced. Mirror of `audit_personal_keys()`: a new one takes a migration.
 */
export const PERSONAL_KEYS = {
  // The e-mail of an invited person (#178); `name` is not logged today.
  invitation: ["email", "name"],
  // Free text typed for a price apart from the grid (#292, #316, #297).
  enrollment: ["reason"],
  lesson_pack: ["reason"],
  workshop_signup: ["reason", "priceReason"],
} as const satisfies Record<string, readonly string[]>;

export type PersonalTable = keyof typeof PERSONAL_KEYS;

/**
 * Technical keys of the tables whose entries name people: ids, amounts, dates, statuses, never
 * redacted. A key in neither list is reported (`unclassifiedKeys`) so that a new writer is noticed.
 */
export const TECHNICAL_KEYS: Readonly<Record<string, readonly string[]>> = {
  invitation: ["id", "type", "role", "userId", "createdBy", "expiresAt"],
  enrollment: [
    "payerId",
    "seasonId",
    "billingEntityId",
    "status",
    "studentIds",
    "courseIds",
    "quarterIds",
    "courses",
    "grossPriceCents",
    "discountCents",
    "netPriceCents",
    "manualPriceCents",
    "computedNetPriceCents",
    "droppedOn",
  ],
  lesson_pack: ["payerId", "participantIds", "lessonCount", "peopleCount", "priceCents", "gridPriceCents"],
  lesson_pack_usage: ["lessonPackId", "lessonId"],
  workshop_signup: [
    "courseId",
    "payerId",
    "participantIds",
    "billingEntityId",
    "vatTreatmentId",
    "unitPriceCents",
    "workshopPriceCents",
    "signedUpOn",
  ],
  student_document: ["studentId", "type", "receivedOn", "datedOn", "granted", "validUntil"],
  rules_acceptance: ["payerId", "seasonId", "acceptedOn", "rulesVersionId"],
  person: ["refusesPhotos", "referralSourceId"],
  member: ["role", "active"],
  instructor: ["payMode", "rateCents", "isOwner"],
  internal_rules_version: ["seasonId", "versionId", "length"],
};

/**
 * Tables whose entries hold the school's own settings or money records, never a value of a
 * family or an invitee: not listed key by key. `email_connector` is the school's sender address
 * and name (removing the account is how the school drops them); open question in #184.
 */
export const SCHOOL_DATA_TABLES: readonly string[] = [
  "audit_log",
  "bank_deposit",
  "billing_entity",
  "course",
  "document_requirement",
  "email_connector",
  "installment_plan_setting",
  "invoice",
  "payment",
  "payment_allocation",
  "payment_method_setting",
  "referral_source",
  "vat_treatment",
];

const personalKeysOf = (table: string): readonly string[] =>
  isKeyOf(PERSONAL_KEYS, table) ? PERSONAL_KEYS[table] : [];

/**
 * `value` with the string values of the table's personal keys replaced by the placeholder; the
 * other values, and anything that is not a JSON object, unchanged. Same rule as `audit_redacted()`.
 */
export function redactJson(table: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const personal = personalKeysOf(table);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, personal.includes(k) && typeof v === "string" ? PLACEHOLDER : v]),
  );
}

export type AuditEntry = { targetTable: string; before: unknown; after: unknown };

/** The entry with its personal values pseudonymised: the mirror of `audit_redacted()`, tested equal. */
export function redactEntry<E extends AuditEntry>(entry: E): E {
  return {
    ...entry,
    before: redactJson(entry.targetTable, entry.before),
    after: redactJson(entry.targetTable, entry.after),
  };
}

/**
 * Keys found in the audit log that no list classifies, as `table.key` (or `table.*` for a table
 * no list knows): reported by the pseudonymisation run, never redacted.
 */
export function unclassifiedKeys(found: readonly { targetTable: string; key: string }[]): string[] {
  const out = new Set<string>();
  for (const { targetTable, key } of found) {
    if (SCHOOL_DATA_TABLES.includes(targetTable)) continue;
    const technical = isKeyOf(TECHNICAL_KEYS, targetTable) ? TECHNICAL_KEYS[targetTable] : undefined;
    const personal = personalKeysOf(targetTable);
    if (!technical && personal.length === 0) out.add(`${targetTable}.*`);
    else if (!personal.includes(key) && !(technical ?? []).includes(key)) out.add(`${targetTable}.${key}`);
  }
  return [...out].sort();
}

/**
 * The day before which a relationship counts as ended: `RETENTION_YEARS` before `today`
 * (`YYYY-MM-DD`, Europe/Paris). A 29 February falls back to the 28th.
 */
export function pseudonymisationCutoff(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const year = y - RETENTION_YEARS;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
