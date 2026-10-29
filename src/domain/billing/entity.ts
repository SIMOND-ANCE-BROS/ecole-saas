/**
 * Identifiers of a billing entity (#298, ADR 0006), as typed at the desk:
 * « 000 000 001 », « 000 000 001 00012 », « fr 12 000000001 ». Pure functions,
 * shared by the form validation and its tests.
 */

/** The text without spaces (ordinary, non-breaking, narrow) nor dots, as French papers print them. */
export const compact = (s: string): string => s.replace(/[\s.  ]/g, "");

/** A SIREN is 9 digits. */
export const isSiren = (s: string): boolean => /^\d{9}$/.test(s);

/** A SIRET is 14 digits: the SIREN followed by 5 digits of the establishment. */
export const isSiret = (s: string): boolean => /^\d{14}$/.test(s);

/** The SIRET belongs to this SIREN (either missing: nothing to compare). */
export const siretMatchesSiren = (siret: string | null, siren: string | null): boolean =>
  siret === null || siren === null || siret.slice(0, 9) === siren;

/** The SIREN to store: the one typed, or the first 9 digits of the SIRET when only the SIRET was typed. */
export const sirenOf = (siren: string | null, siret: string | null): string | null =>
  siren ?? (siret === null ? null : siret.slice(0, 9));

/** An intra-EU VAT number: 2-letter country code, then 2 to 13 letters or digits (FR: 11 characters). */
export const isVatNumber = (s: string): boolean => /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(s);

/**
 * Names of the fields whose value differs between two versions of a record, in
 * the order of `after`: what the audit log keeps of an edit, without the values
 * (a sole trader's SIREN or address is personal data).
 */
export function changedFields<T extends Record<string, unknown>>(before: T, after: T): (keyof T & string)[] {
  return (Object.keys(after) as (keyof T & string)[]).filter((k) => before[k] !== after[k]);
}

/**
 * Looks like an IBAN (country code, 2 check digits, at least 11 more characters):
 * the bank account label is printed on deposit slips and must never hold one.
 */
export const looksLikeIban = (s: string): boolean => /[A-Z]{2}\d{2}[A-Z0-9]{11,30}/.test(compact(s).toUpperCase());
