import type { VatCategory } from "../../domain/billing/vat";
import {
  type CreditNotePayload,
  type InvoicePayload,
  InvoicingError,
  type InvoicingOperation,
  type LinePayload,
  type LineVat,
  type Totals,
} from "./contract";

/** An `invoice_line` row as stored (#301, #302). */
export type StoredLine = {
  label: string;
  quantityThousandths: number;
  /** VAT-inclusive unit price. */
  unitPriceCents: number;
  /** The line's total, VAT-inclusive: the source of truth. */
  inclTaxCents: number;
  exclTaxCents: number;
  vatCents: number;
  vatCategory: VatCategory;
  vatRateBps: number;
  vatMention: string | null;
};

const cents = (operation: InvoicingOperation, ...values: number[]) => {
  if (!values.every(Number.isSafeInteger)) throw new InvoicingError("format", operation, "amount_not_cents");
};

/**
 * A stored line as sent to the tool: its amounts exactly as stored, never
 * recomputed (a tool computing VAT per line may differ by a cent; the guard
 * then compares totals). A line without VAT carries its mention, which the law
 * requires: a line missing it is refused rather than sent with an empty one.
 */
export function linePayload(line: StoredLine, operation: InvoicingOperation = "createInvoice"): LinePayload {
  cents(operation, line.quantityThousandths, line.unitPriceCents, line.inclTaxCents, line.exclTaxCents, line.vatCents);
  if (line.exclTaxCents + line.vatCents !== line.inclTaxCents) {
    throw new InvoicingError("format", operation, "line_vat_sum");
  }
  let vat: LineVat;
  if (line.vatCategory === "standard") {
    vat = { category: "standard", rateBps: line.vatRateBps };
  } else {
    const mention = line.vatMention?.trim();
    if (!mention) throw new InvoicingError("format", operation, "missing_vat_mention");
    vat = { category: line.vatCategory, mention };
  }
  return {
    label: line.label,
    quantityThousandths: line.quantityThousandths,
    unitPriceCents: line.unitPriceCents,
    inclTaxCents: line.inclTaxCents,
    exclTaxCents: line.exclTaxCents,
    vatCents: line.vatCents,
    vat,
  };
}

/** Totals of the lines, summed in integer cents. */
export const totalsOf = (lines: readonly Pick<StoredLine, "inclTaxCents" | "exclTaxCents" | "vatCents">[]): Totals =>
  lines.reduce<Totals>(
    (t, l) => ({
      inclTaxCents: t.inclTaxCents + l.inclTaxCents,
      exclTaxCents: t.exclTaxCents + l.exclTaxCents,
      vatCents: t.vatCents + l.vatCents,
    }),
    { inclTaxCents: 0, exclTaxCents: 0, vatCents: 0 },
  );

/**
 * The invoice as sent to its business's tool. `invoiceId` is the idempotency
 * key. `totals` are the invoice row's stored totals, « ours » in ADR 0007: they
 * must equal the lines' sums, and the installments must add up to the
 * VAT-inclusive total; otherwise nothing is sent (`format`).
 */
export function invoicePayload(
  input: {
    invoiceId: string;
    customerRef: string;
    vatMention: string | null;
    totals: Totals;
    lines: readonly StoredLine[];
    installments: readonly { dueDate: string; amountCents: number }[];
  },
  operation: InvoicingOperation = "createInvoice",
): InvoicePayload {
  const lines = input.lines.map((l) => linePayload(l, operation));
  const sums = totalsOf(lines);
  if (
    sums.inclTaxCents !== input.totals.inclTaxCents ||
    sums.exclTaxCents !== input.totals.exclTaxCents ||
    sums.vatCents !== input.totals.vatCents
  ) {
    throw new InvoicingError("format", operation, "totals_differ_from_lines");
  }
  cents(operation, ...input.installments.map((i) => i.amountCents));
  if (
    input.installments.length > 0 &&
    input.installments.reduce((sum, i) => sum + i.amountCents, 0) !== input.totals.inclTaxCents
  ) {
    throw new InvoicingError("format", operation, "installments_differ_from_total");
  }
  return {
    externalRef: input.invoiceId,
    customerRef: input.customerRef,
    vatMention: input.vatMention,
    lines,
    totals: { ...input.totals },
    installments: input.installments.map((i) => ({ dueDate: i.dueDate, amountCents: i.amountCents })),
  };
}

/**
 * A credit note as sent to the tool: the same checks as an invoice (whole
 * cents, mentions, stored totals equal to the lines), every line negative, and
 * no installment. `creditNoteId` (our credit note invoice row) is its idempotency key.
 */
export function creditNotePayload(input: {
  creditNoteId: string;
  customerRef: string;
  vatMention: string | null;
  totals: Totals;
  lines: readonly StoredLine[];
  creditedToolRef: string;
}): CreditNotePayload {
  if (input.lines.length === 0 || input.lines.some((l) => l.inclTaxCents >= 0)) {
    throw new InvoicingError("format", "createCreditNote", "credit_note_not_negative");
  }
  const { installments: _none, ...payload } = invoicePayload(
    { ...input, invoiceId: input.creditNoteId, installments: [] },
    "createCreditNote",
  );
  return { ...payload, creditedToolRef: input.creditedToolRef };
}
