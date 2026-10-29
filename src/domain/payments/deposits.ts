/**
 * Bank deposits and payment log (#98): pure rules, in cents, dates
 * `YYYY-MM-DD`.
 */
import { csvAmount, csvDocument, csvText } from "../../lib/csv";
import { frenchDate } from "../../lib/dates";

export const DEPOSIT_METHODS = ["cheque", "cash", "holiday_voucher"] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];
export const isDepositable = (method: string): method is DepositMethod =>
  (DEPOSIT_METHODS as readonly string[]).includes(method);

export type DepositablePayment = {
  id: string;
  method: string;
  amountCents: number;
  /** Amount already cancelled by corrections. */
  correctedCents: number;
  plannedPayment: string | null;
  depositId: string | null;
};

/**
 * Payments to deposit, by method: cheques (once their cashing date has
 * come), cash and holiday vouchers, not yet deposited nor fully cancelled
 * by a correction.
 */
export function toDeposit<T extends DepositablePayment>(payments: T[], today: string): Record<DepositMethod, T[]> {
  const r: Record<DepositMethod, T[]> = { cheque: [], cash: [], holiday_voucher: [] };
  for (const p of payments) {
    if (!isDepositable(p.method) || p.amountCents <= 0 || p.depositId !== null) continue;
    if (p.amountCents - p.correctedCents <= 0) continue;
    if (p.plannedPayment !== null && p.plannedPayment > today) continue;
    r[p.method].push(p);
  }
  return r;
}

/** Grand total and total per method. */
export function totals<T extends { method: string; amountCents: number }>(
  rows: T[],
): { total: number; byMethod: Record<string, number> } {
  const byMethod: Record<string, number> = {};
  let total = 0;
  for (const l of rows) {
    byMethod[l.method] = (byMethod[l.method] ?? 0) + l.amountCents;
    total += l.amountCents;
  }
  return { total, byMethod };
}

export type ExportRow = {
  date: string;
  payer: string;
  method: string;
  amountCents: number;
  reference: string | null;
  issuer: string | null;
  plannedPayment: string | null;
  deposit: string | null;
};

const dateFr = (iso: string | null) => (iso ? frenchDate(iso) : "");

/** CSV export for accounting: separator « ; », amounts « 123,45 », dates DD/MM/YYYY, BOM for Excel. */
export function toCsv(rows: ExportRow[]): string {
  const header = ["Date", "Payeur", "Moyen", "Montant", "Référence", "Émetteur", "Encaissement prévu", "Remise"];
  return csvDocument(
    header,
    rows.map((l) => [
      dateFr(l.date),
      csvText(l.payer),
      csvText(l.method),
      csvAmount(l.amountCents),
      csvText(l.reference),
      csvText(l.issuer),
      dateFr(l.plannedPayment),
      dateFr(l.deposit),
    ]),
  );
}
