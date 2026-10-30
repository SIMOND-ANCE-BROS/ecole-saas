import type { VatCategory } from "../../domain/billing/vat";
import type { InvoicePayload, LinePayload, LineVat, Totals } from "./contract";

/** An `invoice_line` row as stored (#301, #302). */
export type StoredLine = {
  label: string;
  quantityThousandths: number;
  inclTaxCents: number;
  exclTaxCents: number;
  vatCents: number;
  vatCategory: VatCategory;
  vatRateBps: number;
  vatMention: string | null;
};

/**
 * A stored line as sent to the tool: its amounts exactly as stored, never
 * recomputed (a tool computing VAT per line may differ by a cent; the guard
 * then compares totals). A line without VAT carries its mention.
 */
export function linePayload(line: StoredLine): LinePayload {
  const vat: LineVat =
    line.vatCategory === "standard"
      ? { category: "standard", rateBps: line.vatRateBps }
      : { category: line.vatCategory, mention: line.vatMention ?? "" };
  return {
    label: line.label,
    quantityThousandths: line.quantityThousandths,
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
 * key; the totals are the lines' sums, which the draft's stored totals equal.
 */
export function invoicePayload(input: {
  invoiceId: string;
  customerRef: string;
  vatMention: string | null;
  lines: readonly StoredLine[];
  installments: readonly { dueDate: string; amountCents: number }[];
}): InvoicePayload {
  return {
    externalRef: input.invoiceId,
    customerRef: input.customerRef,
    vatMention: input.vatMention,
    lines: input.lines.map(linePayload),
    totals: totalsOf(input.lines),
    installments: input.installments.map((i) => ({ dueDate: i.dueDate, amountCents: i.amountCents })),
  };
}
