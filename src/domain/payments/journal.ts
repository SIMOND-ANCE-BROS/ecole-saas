import { PAYMENT_COLUMNS, type ColumnId } from "../filters/columns";
import { applyFilter, type Cell, type Filter, type Sort, sortRows } from "../filters/filters";

/**
 * The payment log as a list (#98, #107): the period's payments, filtered and
 * sorted by the table's columns. The page and the CSV export use the same
 * rules, so the export holds exactly the rows shown (all pages).
 */

export type JournalRow = {
  date: string;
  payer: string;
  /** Method label as shown (« Chèque »), so the checkboxes match it. */
  methodLabel: string;
  amountCents: number;
  reference: string | null;
  issuer: string | null;
  plannedPayment: string | null;
  dateDeposit: string | null;
};

type PaymentColumn = ColumnId<typeof PAYMENT_COLUMNS>;

/** A cheque's cashing date, shown only while it is still to come. */
export const futureCashing = (row: Pick<JournalRow, "plannedPayment">, today: string) =>
  row.plannedPayment && row.plannedPayment > today ? row.plannedPayment : null;

/** « 0012345, Banque Populaire »: the cheque number and its bank, or null. */
export const referenceOf = (row: Pick<JournalRow, "reference" | "issuer">) =>
  [row.reference, row.issuer].filter(Boolean).join(", ") || null;

/** A column's value for filtering and sorting; the amount sorts in cents. */
export function journalValue(row: JournalRow, column: PaymentColumn, today: string): Cell {
  switch (column) {
    case "recu":
      return row.date;
    case "payeur":
      return row.payer;
    case "moyen":
      return row.methodLabel;
    case "reference":
      return referenceOf(row);
    case "montant":
      return row.amountCents;
    case "encaissement":
      return futureCashing(row, today);
    case "remise":
      return row.dateDeposit;
  }
}

/** The rows shown: the column filters, then the sort (the period's order, oldest first, otherwise). */
export function shownJournal<T extends JournalRow>(rows: T[], filter: Filter, sort: Sort | null, today: string): T[] {
  const filtered = applyFilter(
    rows,
    filter,
    PAYMENT_COLUMNS.map((c) => ({ ...c, value: (r: T) => journalValue(r, c.id, today) })),
  );
  return sortRows(filtered, sort, (r, column) => {
    const c = PAYMENT_COLUMNS.find((d) => d.id === column);
    return c ? journalValue(r, c.id, today) : null;
  });
}
