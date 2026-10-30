/**
 * Sending invoices to each business's invoicing tool (#304, ADR 0007): the invoice row is the
 * outbox. Pure rules of the sending, no database, no network: when a draft may go, when a
 * failed one is tried again, when it is given up, what management reads about it, and what an
 * invoice that never got a number gives back.
 *
 * States: `to_send` → `tool_draft` (the tool holds a draft) → `issued` (numbered by the tool),
 * or `rejected` (given up, with its reason) / `cancelled` (the tool's draft was cancelled there).
 */

/** At most this many attempts per invoice; the next failure rejects it. */
export const MAX_ATTEMPTS = 10;

/** Wait before the next attempt after the 1st, 2nd… failure (ADR 0007); every 12 h afterwards. */
export const BACKOFF_MINUTES = [1, 5, 30, 120, 360, 720] as const;

/** How long a run keeps an invoice it claimed: well above the tool calls of one invoice (4 × 21 s). */
export const CLAIM_MINUTES = 5;

/** How many invoices of one business a run sends at most; the next run takes the rest. */
export const BATCH_SIZE = 25;

/** Minutes to wait after the `attempts`-th failed attempt (1-based). */
export function retryDelayMinutes(attempts: number): number {
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError("attempts must be a positive integer");
  return BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1];
}

/** Why a call to the tool failed, as `InvoicingError` reports it (kind and technical code). */
export type SendFailureKind =
  | "timeout"
  | "network"
  | "server"
  | "credentials"
  | "rejected"
  | "not_found"
  | "unsupported"
  | "configuration"
  | "format"
  /** The tool gave a number the database refuses for that tool (« TEST- » from a real tool…). */
  | "number_tool_mismatch"
  /** Not the tool: this software failed while sending (database, bug). */
  | "internal";

export type SendFailure = { kind: SendFailureKind; code: string | null };

/**
 * Failures worth trying again later: the tool was unreachable or out of order, refused the
 * credentials (management may fix them in the meantime), or this software failed on its side.
 * Anything else is final: the invoice itself is refused, and would be refused again.
 */
const RETRIED: readonly SendFailureKind[] = ["timeout", "network", "server", "credentials", "internal"];

export type AfterFailure = { status: "retry"; delayMinutes: number } | { status: "rejected" };

/**
 * What becomes of an invoice whose `attempts`-th attempt (counted when it was claimed) failed:
 * tried again after the backoff, or rejected for good once final or at the 10th attempt.
 */
export function afterFailure(failure: SendFailure, attempts: number): AfterFailure {
  if (!RETRIED.includes(failure.kind) || attempts >= MAX_ATTEMPTS) return { status: "rejected" };
  return { status: "retry", delayMinutes: retryDelayMinutes(attempts) };
}

/**
 * Whether a draft may be sent. Open question #176 Q1 (when a yearly or drop-in package, or
 * a lesson pack, is due): such amounts get no installment on the drafts (#302), and the owner
 * asked that nothing be issued before it is answered. A draft goes once its installments add
 * up to its total; until then it waits, untouched, and a later drafting may still replace it.
 * Mirrored in SQL by `SENDABLE` (src/db/invoice-outbox.ts), checked in the claiming statement.
 */
export function isSendable(invoice: { totalInclTaxCents: number; installmentsCents: readonly number[] }): boolean {
  return (
    invoice.installmentsCents.length > 0 &&
    invoice.installmentsCents.reduce((sum, c) => sum + c, 0) === invoice.totalInclTaxCents
  );
}

/**
 * Whether an invoice still bills its lines (their enrollments and lesson packs are not drafted
 * again). An invoice the tool never numbered gives them back only when the tool surely never
 * issued it: `cancelled` (the tool says its draft was cancelled), or `rejected` before the tool
 * held any document of it (`toolRef` empty, so it was never asked to issue it). A rejected
 * invoice the tool holds a draft of keeps its lines: the tool may have issued it unseen (a
 * lost answer); management sorts it out with the tool. Mirrored in SQL by `BILLS_ITS_LINES`
 * (`src/db/invoice-draft-discard.ts`).
 */
export function billsItsLines(invoice: { status: string; toolRef: string | null }): boolean {
  if (invoice.status === "cancelled") return false;
  if (invoice.status === "rejected") return invoice.toolRef !== null;
  return true;
}

/** Plain technical codes the reasons below explain; any other code falls back on its kind. */
const CODE_REASONS: Readonly<Record<string, string>> = {
  total_mismatch:
    "L’outil de facturation a calculé un total TTC différent du nôtre : vérifier les lignes et la TVA de la facture.",
  fake_not_allowed: "L’outil de facturation fictif n’est pas autorisé sur ce serveur.",
  tool_not_implemented: "La connexion à cet outil de facturation n’existe pas encore.",
  encryption_key_missing: "La clé de chiffrement du serveur manque : prévenir l’hébergeur.",
  credentials_unreadable: "Les identifiants de l’outil de facturation sont illisibles : les saisir à nouveau.",
  credentials_shape: "Les identifiants de l’outil de facturation sont incomplets : les saisir à nouveau.",
  missing_vat_mention: "Une ligne sans TVA n’a pas de mention d’exonération.",
  totals_differ_from_lines: "Les totaux de la facture ne correspondent pas à ses lignes.",
  installments_differ_from_total: "Les échéances ne correspondent pas au total de la facture.",
  unknown_document: "L’outil de facturation ne trouve plus cette facture.",
};

const KIND_REASONS: Readonly<Record<SendFailureKind, string>> = {
  timeout: "L’outil de facturation n’a pas répondu à temps, plusieurs fois de suite.",
  network: "L’outil de facturation est resté injoignable, plusieurs fois de suite.",
  server: "L’outil de facturation était en panne, plusieurs fois de suite.",
  credentials: "L’outil de facturation refuse les identifiants de l’entreprise.",
  rejected: "L’outil de facturation a refusé la facture.",
  not_found: "L’outil de facturation ne trouve plus cette facture.",
  unsupported: "L’outil de facturation ne permet pas cette opération.",
  configuration: "La connexion à l’outil de facturation est mal paramétrée.",
  format: "La facture est incomplète ou incohérente : elle n’a pas été envoyée.",
  number_tool_mismatch:
    "L’outil de facturation a donné un numéro de facture d’essai (« TEST- ») ou réservé à l’outil fictif : la facture n’a pas été enregistrée comme émise.",
  internal: "Le logiciel a rencontré une erreur pendant l’envoi, plusieurs fois de suite.",
};

/** The reason management reads (French), from the kind and code stored on the invoice. */
export function sendFailureReason(kind: string | null, code: string | null): string {
  if (code && Object.hasOwn(CODE_REASONS, code)) return CODE_REASONS[code];
  if (kind && Object.hasOwn(KIND_REASONS, kind)) return KIND_REASONS[kind as SendFailureKind];
  return "L’envoi à l’outil de facturation a échoué.";
}
