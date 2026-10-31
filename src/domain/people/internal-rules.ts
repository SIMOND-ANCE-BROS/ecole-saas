/**
 * The internal rules a payer accepts each season, image rights included, and
 * how a student's family heard of the school (#296).
 *
 * The family signs the enrollment form: « En signant ce contrat, j’accepte les
 * clauses du règlement intérieur… ». The image rights are part of those rules:
 * there is no separate image-rights document (#287).
 *
 * Defaults, from #296:
 *  1. The rules are accepted per payer and season, on the enrollment date by
 *     default (`defaultAcceptedOn`).
 *  2. A family may sign the rules and still refuse photos: a « Refuse les
 *     photos » flag on the student, off by default (`REFUSES_PHOTOS_DEFAULT`,
 *     also the database default of `person.refuses_photos`).
 *  3. Once the school recorded the season's rules, the rules not signed by a
 *     payer of an enrolled student (active or trial) show among the student's
 *     « Documents manquants », right away: they are signed at the desk with the
 *     enrollment form. A school that recorded no rules is asked for no signature.
 *     (Trial enrollments and a delay are open questions on #296.)
 * The answers to « Comment nous avez-vous connus ? » are school data
 * (`referral_source`), never code.
 */

/** Name shown to the user, on the record and in « Documents manquants » (SQL included). */
export const RULES_LABEL = "Règlement intérieur";

/** Default of #296 Q1: the student does not refuse photos until the family says so. */
export const REFUSES_PHOTOS_DEFAULT = false;

/** What the students list says of a student whose family refuses photos (« Photos » column). */
export const PHOTOS_REFUSED = "refusées";

/** Longest rules text kept per season: a full internal rules document fits. */
export const RULES_TEXT_MAX = 50_000;

/** Longest answer to « Comment nous avez-vous connus ? ». */
export const REFERRAL_LABEL_MAX = 60;

/** The « no answer » row of the statistics and the list filter: never an answer of its own. */
export const REFERRAL_UNANSWERED = "Non renseigné";

/** Most answers a school can offer: a choice list, not a database. */
export const REFERRAL_SOURCES_MAX = 30;

/**
 * The date the rules were accepted, by default: the payer's first enrollment
 * day of the season, else today; never after today (an enrollment entered
 * ahead of its date was still signed today at the latest).
 */
export function defaultAcceptedOn(firstEnrolledOn: string | null, today: string): string {
  return firstEnrolledOn !== null && firstEnrolledOn < today ? firstEnrolledOn : today;
}

/** The rules text as kept: line ends unified, blanks around trimmed; empty means none. */
export function normalisedRules(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

/** Whether saving `next` makes a new version of the season's rules (the text did change). */
export function rulesChanged(current: string | null, next: string): boolean {
  return normalisedRules(next) !== (current === null ? "" : normalisedRules(current));
}

/** An answer as compared for duplicates: « Bouche à oreille » and « bouche  à oreille » are the same. */
export function referralKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

/**
 * Why an answer cannot be saved, or null: empty, too long, or already offered
 * (another answer with the same words, case and spaces aside). `others`: the
 * school's other answers, the one being renamed left out.
 */
export function referralRefusal(label: string, others: readonly string[]): string | null {
  const clean = label.trim().replace(/\s+/g, " ");
  if (clean === "") return "Indiquez la réponse.";
  if (clean.length > REFERRAL_LABEL_MAX) return `La réponse tient en ${REFERRAL_LABEL_MAX} caractères au plus.`;
  if (referralKey(clean) === referralKey(REFERRAL_UNANSWERED))
    return `« ${REFERRAL_UNANSWERED} » désigne déjà les élèves sans réponse.`;
  if (others.some((o) => referralKey(o) === referralKey(clean))) return `« ${clean} » est déjà proposée.`;
  return null;
}

/** A payer of the student this season, as the rules see it. */
export type RulesPayer = {
  payerId: string;
  /** Pays an active or trial enrollment of the student this season. */
  enrolled: boolean;
  /** Day the payer accepted the season's rules; null: not signed. */
  acceptedOn: string | null;
};

/**
 * Whether the student misses the rules: the school recorded the season's
 * rules (`rulesRecorded`) and a payer of one of their active or trial
 * enrollments has not signed them (default 3). The SQL twin is
 * `missingRulesSql` (src/db/internal-rules.ts).
 */
export function rulesMissing(rulesRecorded: boolean, payers: readonly RulesPayer[]): boolean {
  return rulesRecorded && payers.some((p) => p.enrolled && p.acceptedOn === null);
}
