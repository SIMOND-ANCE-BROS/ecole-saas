/**
 * Invoicing connector contract (#303, ADR 0007). Each billing entity sends its
 * invoices through its own tool account (Pennylane, Abby, Shine…, ADR 0006):
 * the rest of the code only knows this contract, never the concrete tool.
 *
 * Rules every tool follows:
 *  - the tool numbers the invoice; this software never makes up a number;
 *  - every call is idempotent by `externalRef` (our invoice, credit note,
 *    payer or payment id): sending the same thing twice returns the first result;
 *  - amounts are integer cents, sent per line exactly as stored on
 *    `invoice_line` (VAT-inclusive, excl. and VAT): a tool computing VAT line by
 *    line may differ by a cent, so its VAT-inclusive total is compared with ours
 *    and a difference rejects the invoice (`total_mismatch`).
 *
 * Tool selection criterion (#303 Q2, ADR 0007): the tool must accept
 * VAT-inclusive line prices.
 */

import type { InvoicingToolName } from "../../domain/billing/invoicing";

export type { InvoicingToolName };

/** VAT of a line as invoiced: a rate, or the mention printed on a line without VAT. */
export type LineVat =
  { category: "standard"; rateBps: number } | { category: "exempt" | "not_subject"; mention: string };

export type LinePayload = {
  label: string;
  /** 1000 = 1: no floating-point quantity. */
  quantityThousandths: number;
  /** VAT-inclusive unit price as stored; the line's own amounts stay the source of truth. */
  unitPriceCents: number;
  /** Source of truth; excl. + VAT = incl., as stored on the line. */
  inclTaxCents: number;
  exclTaxCents: number;
  vatCents: number;
  vat: LineVat;
};

/**
 * Every amount of the contract is integer cents (`invoicePayload` checks it). A
 * real connector converting to a tool's euro strings goes through
 * `src/lib/money.ts`, never a division by 100 on a float.
 */
export type Totals = { inclTaxCents: number; exclTaxCents: number; vatCents: number };

/** A payer as the tool's customer. Personal data: never logged, never in an error. */
export type CustomerPayload = {
  /** Our payer id. */
  externalRef: string;
  kind: "individual" | "organisation";
  name: string;
  email: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
};

export type InvoicePayload = {
  /** Our invoice id: the idempotency key. */
  externalRef: string;
  /** The tool's customer id, from `createCustomer`. */
  customerRef: string;
  /** Invoice-level mention of the business (e.g. its VAT regime), printed once. */
  vatMention: string | null;
  lines: readonly LinePayload[];
  totals: Totals;
  installments: readonly { dueDate: string; amountCents: number }[];
};

/** A credit note cancels all or part of an issued invoice; its lines are negative. */
export type CreditNotePayload = Omit<InvoicePayload, "installments"> & {
  /** The tool's id of the invoice it corrects. */
  creditedToolRef: string;
};

export type PaymentPayload = {
  /** Our payment id. */
  externalRef: string;
  invoiceToolRef: string;
  amountCents: number;
  /** `YYYY-MM-DD`. */
  paidOn: string;
};

/** A document as the tool holds it. */
export type ToolDocument = {
  toolRef: string;
  status: "draft" | "issued" | "cancelled" | "rejected";
  /** Given by the tool when it issues the document; never made up here. */
  number: string | null;
  /** `YYYY-MM-DD`. */
  issuedOn: string | null;
  totalInclTaxCents: number;
  pdfUrl: string | null;
};

export type Capabilities = {
  /** Payment e-reporting through the tool (#303 Q1): off until confirmed. */
  recordPayment: boolean;
};

/** What the rest of the code calls: one instance per billing entity (`connectorFor`). */
export interface InvoicingConnector {
  readonly tool: InvoicingToolName;
  readonly capabilities: Capabilities;
  checkCredentials(): Promise<void>;
  createCustomer(customer: CustomerPayload): Promise<{ customerRef: string }>;
  /** A draft in the tool, not numbered yet. */
  createInvoice(invoice: InvoicePayload): Promise<ToolDocument>;
  /** Issues the draft: the tool numbers it. `totalInclTaxCents`: ours, checked against the tool's. */
  finalize(draft: { toolRef: string; totalInclTaxCents: number }): Promise<ToolDocument>;
  createCreditNote(creditNote: CreditNotePayload): Promise<ToolDocument>;
  readStatus(toolRef: string): Promise<ToolDocument>;
  /** Refused (`unsupported`) unless `capabilities.recordPayment`. */
  recordPayment(payment: PaymentPayload): Promise<void>;
}

/**
 * One tool's raw client, wrapped by `guarded()`: the same calls, each given a
 * signal that aborts after the timeout. It throws `InvoicingError` for what it
 * understands (`server` for a 5xx, `rejected` for a refusal…); anything else is
 * read as a network failure.
 */
export type ToolClient = {
  readonly tool: InvoicingToolName;
  readonly supportsRecordPayment: boolean;
  checkCredentials(signal: AbortSignal): Promise<void>;
  createCustomer(customer: CustomerPayload, signal: AbortSignal): Promise<{ customerRef: string }>;
  createInvoice(invoice: InvoicePayload, signal: AbortSignal): Promise<ToolDocument>;
  finalize(toolRef: string, signal: AbortSignal): Promise<ToolDocument>;
  createCreditNote(creditNote: CreditNotePayload, signal: AbortSignal): Promise<ToolDocument>;
  readStatus(toolRef: string, signal: AbortSignal): Promise<ToolDocument>;
  recordPayment(payment: PaymentPayload, signal: AbortSignal): Promise<void>;
};

export type InvoicingOperation = keyof Omit<InvoicingConnector, "tool" | "capabilities"> | "connectorFor";

/**
 * Why a call failed. Retryable: `timeout`, `network`, `server` (the outbox
 * tries again later, ADR 0007). Final until someone acts: `credentials`,
 * `rejected` (the tool refused the document, or its total differs from ours),
 * `not_found`, `unsupported`, `configuration`, `format`.
 */
export type InvoicingErrorKind =
  | "timeout"
  | "network"
  | "server"
  | "credentials"
  | "rejected"
  | "not_found"
  | "unsupported"
  | "configuration"
  | "format";

const RETRYABLE: readonly InvoicingErrorKind[] = ["timeout", "network", "server"];

/** A technical code: lowercase letters, digits and underscores, never a tool's free text. */
const CODE = /^[a-z0-9_]{1,64}$/;

/**
 * Typed failure of an invoicing call. Its message names the operation, the kind
 * and a technical code only: never a payload, a name or an amount, so it can be
 * logged (CLAUDE.md §8, personal data of minors). A code that is not a plain
 * technical code (a tool's error text…) is replaced by `unrecognised`.
 *
 * `document`: what the tool holds despite the failure. On a `total_mismatch`
 * after `finalize` or `createCreditNote`, the tool has already issued and
 * numbered the document: the caller records it (number, date) and never treats
 * it as never issued; only a credit note in the tool corrects it.
 */
export class InvoicingError extends Error {
  readonly retryable: boolean;
  readonly code: string | null;
  constructor(
    readonly kind: InvoicingErrorKind,
    readonly operation: InvoicingOperation,
    /** Technical code such as `total_mismatch`; no personal data. */
    code: string | null = null,
    readonly document: ToolDocument | null = null,
  ) {
    const safe = code === null || CODE.test(code) ? code : "unrecognised";
    super(`Invoicing ${operation} failed (${kind}${safe ? `: ${safe}` : ""})`);
    this.name = "InvoicingError";
    this.code = safe;
    this.retryable = RETRYABLE.includes(kind);
  }
}
