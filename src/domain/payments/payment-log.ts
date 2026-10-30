import { PAYMENT_COLUMNS, type ColumnId } from "../filters/columns";
import { applyFilter, type Cell, type Filter, readFilter, readSort, type Sort, sortRows } from "../filters/filters";
import type { ExportRow } from "./deposits";
import { type ReversalKind, reversalLabel } from "./rejection";

/**
 * The payment log as a list (#98, #107): the period's payments, filtered and
 * sorted by the table's columns. The page and the CSV export read the same
 * query (`paymentLogQuery`) and apply the same rules (`shownPaymentLog`), so
 * the export holds exactly the rows shown, all pages together.
 * (« Journal » in the lexicon is the audit log; this is the payment log.)
 */

export type PaymentLogRow = {
  date: string;
  payer: string;
  /** Method label as shown (« Chèque »), so the checkboxes match it. */
  methodLabel: string;
  amountCents: number;
  /** Kind of a reverse entry, null for an ordinary payment (#272). */
  reversalKind: ReversalKind | null;
  reference: string | null;
  issuer: string | null;
  plannedPayment: string | null;
  dateDeposit: string | null;
  /** Name of the billing entity that cashed it (#300). */
  entity: string;
};

type PaymentColumn = ColumnId<typeof PAYMENT_COLUMNS>;

/** A cheque's cashing date, shown only while it is still to come. */
export const futureCashing = (row: Pick<PaymentLogRow, "plannedPayment">, today: string) =>
  row.plannedPayment && row.plannedPayment > today ? row.plannedPayment : null;

/**
 * The reference column of the export: the cheque number, preceded by what a reverse
 * entry is (« Paiement rejeté, 0012345 »), so the accountant links a rejection to the
 * bounced cheque (#272). Null when there is nothing to show.
 */
export const exportReference = (row: Pick<PaymentLogRow, "reversalKind" | "reference">) =>
  [reversalLabel(row.reversalKind), row.reference].filter(Boolean).join(", ") || null;

/** A row of the payment log as the CSV export writes it. */
export const exportRowOf = (row: PaymentLogRow): ExportRow => ({
  date: row.date,
  payer: row.payer,
  method: row.methodLabel,
  amountCents: row.amountCents,
  reference: exportReference(row),
  issuer: row.issuer,
  plannedPayment: row.plannedPayment,
  deposit: row.dateDeposit,
  entity: row.entity,
});

/** « 0012345, Banque Populaire »: the cheque number and its bank, after the kind of a reverse entry; or null. */
export const referenceOf = (row: Pick<PaymentLogRow, "reversalKind" | "reference" | "issuer">) =>
  [exportReference(row), row.issuer].filter(Boolean).join(", ") || null;

/** A column's value for filtering and sorting; the amount sorts in cents. */
export function paymentLogValue(row: PaymentLogRow, column: PaymentColumn, today: string): Cell {
  switch (column) {
    case "recu":
      return row.date;
    case "payeur":
      return row.payer;
    case "montant":
      return row.amountCents;
    case "moyen":
      return row.methodLabel;
    case "reference":
      return referenceOf(row);
    case "encaissement":
      return futureCashing(row, today);
    case "remise":
      return row.dateDeposit;
    case "entreprise":
      return row.entity;
  }
}

/** The rows shown: the column filters, then the sort (the period's order, oldest first, otherwise). */
export function shownPaymentLog<T extends PaymentLogRow>(
  rows: T[],
  filter: Filter,
  sort: Sort | null,
  today: string,
): T[] {
  const filtered = applyFilter(
    rows,
    filter,
    PAYMENT_COLUMNS.map((c) => ({ ...c, value: (r: T) => paymentLogValue(r, c.id, today) })),
  );
  return sortRows(filtered, sort, (r, column) => {
    const c = PAYMENT_COLUMNS.find((d) => d.id === column);
    return c ? paymentLogValue(r, c.id, today) : null;
  });
}

/**
 * The table's filters and sort from the address. An older link's
 * `?moyen=cheque` (before #107) becomes the « Moyen » column's checkbox
 * condition, so the page and the export agree; `legacy` tells the page to
 * rewrite its address. `methodLabels`: method code → label shown.
 */
export function paymentLogQuery(
  params: URLSearchParams,
  methodLabels: Readonly<Record<string, string>>,
): { filter: Filter; sort: Sort | null; legacy: boolean } {
  const filter = readFilter(params.getAll("f"), params.get("mode"), PAYMENT_COLUMNS);
  const sort = readSort(params.get("sort"), params.get("order"), PAYMENT_COLUMNS);
  const code = params.get("moyen");
  const label = code && Object.hasOwn(methodLabels, code) ? methodLabels[code] : null;
  if (!label) return { filter, sort, legacy: params.has("moyen") };
  const merged: Filter = filter.conditions.some((c) => c.column === "moyen")
    ? filter
    : {
        // An « or » filter would loosen the method; old links never had other filters anyway.
        mode: "et",
        conditions: [...filter.conditions, { column: "moyen", operator: "parmi", value: label }],
      };
  return { filter: merged, sort, legacy: true };
}
