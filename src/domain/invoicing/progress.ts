import { formatEuros } from "../../lib/money";
import type { Role } from "../team/rules";
import { isSendable, sendFailureReason } from "./outbox";

/**
 * Where a payer's invoice stands on its way to the business's invoicing tool (#352), as the
 * front desk and management read it on the payer's record: pure, no database, French text.
 * The sending itself is `src/jobs/invoicing/send.ts` (#304).
 */

/**
 * Who drafts a payer's invoices from their record: the front desk and management, as for
 * enrollments and payments (#352 names management only for rejected invoices). The only place
 * it lives.
 */
export const DRAFT_ROLES = ["director", "front_desk"] as const satisfies readonly Role[];
export const mayDraft = (role: Role) => (DRAFT_ROLES as readonly Role[]).includes(role);

/**
 * Whether a record may draft the invoices of the season it shows (#362): the current season
 * (always, as before #362), or one not ended yet (the next season, in June). Invoicing a season
 * already ended is an open question (#380): an import of past seasons could bill again what the
 * previous software billed. Until it is answered, the record only shows those invoices.
 */
export function seasonDraftable(
  season: { id: string; endDate: string },
  currentSeasonId: string | undefined,
  today: string,
): boolean {
  return season.id === currentSeasonId || season.endDate >= today;
}

/** Why « Préparer les factures » is not offered on an ended season, in French. */
export const ENDED_SEASON = (label: string) =>
  `La saison ${label} est terminée : ses factures ne se préparent pas depuis la fiche.`;

/**
 * Who sends again or abandons a rejected invoice: management, who sees them (#304 open
 * question 1, default director only). The only place it lives.
 */
export const REJECTED_ROLES = ["director"] as const satisfies readonly Role[];

export type InvoiceStatus = "to_send" | "tool_draft" | "issued" | "rejected" | "cancelled";

/**
 * Whether the invoice's business can send: `ready` (an active connector this server may run),
 * `unavailable` (a connector this server may not run: the fake tool without
 * `INVOICING_FAKE_ALLOWED=1`, a tool whose connector does not exist yet), `none` (no active one).
 */
export type Connection = "ready" | "unavailable" | "none";

export type ProgressInput = {
  status: InvoiceStatus;
  attempts: number;
  totalInclTaxCents: number;
  installmentsCents: readonly number[];
  sendErrorKind: string | null;
  sendErrorCode: string | null;
  toolTotalInclTaxCents: number | null;
  toolRef: string | null;
  connection: Connection;
};

export type ProgressKind =
  "held" | "not_connected" | "sending" | "retrying" | "issued" | "issued_mismatch" | "rejected" | "cancelled";

export type InvoiceProgress = { kind: ProgressKind; label: string; detail: string | null };

/**
 * Why a draft is held (#176 Q1, open): only quarterly enrollments get installments yet, so a
 * draft billing a yearly or drop-in package or a lesson pack does not go (`isSendable`).
 */
export const HELD_DETAIL =
  "Pas encore envoyée, rien à faire pour l’instant : les dates d’échéance des forfaits à l’année, des cours à l’unité et des carnets ne sont pas encore paramétrées dans le logiciel. Elle pourra partir une fois ces échéances en place.";

/** What the record says of one invoice of the payer. */
export function invoiceProgress(i: ProgressInput): InvoiceProgress {
  switch (i.status) {
    case "issued":
      if (i.sendErrorCode === "total_mismatch")
        return {
          kind: "issued_mismatch",
          label: "Émise, total différent",
          detail:
            i.toolTotalInclTaxCents === null
              ? "L’outil de facturation l’a émise avec un autre total : la direction doit faire un avoir."
              : `L’outil de facturation l’a émise pour ${formatEuros(i.toolTotalInclTaxCents)} au lieu de ${formatEuros(i.totalInclTaxCents)} : la direction doit faire un avoir.`,
        };
      return { kind: "issued", label: "Émise", detail: null };
    case "rejected":
      return {
        kind: "rejected",
        label: "Non émise",
        detail: `${sendFailureReason(i.sendErrorKind, i.sendErrorCode)} La direction la reprend dans Paramètres › Entreprises.`,
      };
    case "cancelled":
      return { kind: "cancelled", label: "Abandonnée", detail: null };
    case "to_send":
    case "tool_draft":
      // A draft the tool holds already went past the hold when it was claimed.
      if (i.status === "to_send" && !isSendable(i))
        return { kind: "held", label: "En attente des échéances", detail: HELD_DETAIL };
      if (i.connection !== "ready")
        return {
          kind: "not_connected",
          label: "Pas encore envoyée",
          detail:
            i.connection === "none"
              ? "Aucun outil de facturation n’est branché pour cette entreprise : la direction le règle dans Paramètres › Entreprises."
              : "L’outil de facturation de cette entreprise n’est pas disponible sur ce serveur : prévenir la direction.",
        };
      if (i.sendErrorKind !== null)
        return {
          kind: "retrying",
          label: "Nouvel essai prévu",
          // The reasons of `sendFailureReason` are written for a rejection (« plusieurs fois de suite »).
          detail: "Le dernier essai d’envoi a échoué : le logiciel réessaie de lui-même, rien à faire.",
        };
      return {
        kind: "sending",
        label: "Envoi en cours",
        detail: "Elle part d’elle-même vers l’outil de facturation, qui lui donnera son numéro.",
      };
  }
}

/** An unsent draft: never attempted by the outbox, so drafting again replaces it (`UNSENT_DRAFT`). */
export const isUnsentDraft = (i: { status: InvoiceStatus; attempts: number }) =>
  i.status === "to_send" && i.attempts === 0;

/**
 * What the tool answered about its document of a rejected invoice, before « Abandonner » gives
 * the invoice's lines back (#352): `unreachable` when it could not be asked.
 */
export type ToolAnswer = "draft" | "issued" | "cancelled" | "rejected" | "not_found" | "unreachable";

/**
 * Whether a rejected invoice the tool holds a document of may be abandoned: only once the tool
 * says it never issued it (`billsItsLines`: management's word alone is not enough, the tool may
 * have issued it after a lost answer). A document the tool cancelled, refused or no longer knows
 * was never issued.
 */
export function abandonVerdict(answer: ToolAnswer): { ok: true } | { ok: false; message: string } {
  switch (answer) {
    case "cancelled":
    case "rejected":
    case "not_found":
      return { ok: true };
    case "draft":
      return {
        ok: false,
        message:
          "Son brouillon existe encore dans l’outil de facturation : supprimez-le d’abord dans l’outil, puis « Abandonner ».",
      };
    case "issued":
      return {
        ok: false,
        message:
          "L’outil de facturation l’a émise : « Envoyer à nouveau » l’enregistre comme émise. Si elle est fausse, un avoir la corrigera.",
      };
    case "unreachable":
      return {
        ok: false,
        message:
          "L’outil de facturation n’a pas pu être consulté : impossible de vérifier que cette facture n’a pas été émise. Réessayez plus tard.",
      };
  }
}

/**
 * What « Envoyer à nouveau » does with a rejected invoice (#352), management only:
 * - the tool holds a document of it (`toolRef`): back to `tool_draft`, tried again in the tool
 *   (the tool is asked where it stands first, so it is never issued twice);
 * - the tool never held one: its lines are already back (`billsItsLines`), so it is set aside
 *   (`cancelled`) and the payer's season drafted again, which bills them on a fresh draft:
 *   never two invoices for the same lines.
 * Null on any other invoice.
 */
export function sendAgainMode(i: {
  status: InvoiceStatus;
  toolRef: string | null;
}): "retry_in_tool" | "redraft" | null {
  if (i.status !== "rejected") return null;
  return i.toolRef === null ? "redraft" : "retry_in_tool";
}
