/**
 * Bank deposits and payment log (#98): pure rules, in cents, dates
 * `YYYY-MM-DD`.
 */
import { csvAmount, csvDocument, csvText } from "../../lib/csv";
import { frenchDate } from "../../lib/dates";
import type { ReversalKind } from "./rejection";

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

/** Payments of one bank deposit to make: one billing entity, one method (#300). */
export type DepositGroup<T> = { billingEntityId: string; method: DepositMethod; payments: T[] };

/**
 * Payments to deposit grouped by billing entity, then method (#300): each business
 * deposits into its own bank account (#288 Q4), so a slip never mixes two of them.
 * Entities in the order of `entityOrder` (the default first), any other after them;
 * methods in `DEPOSIT_METHODS` order; empty groups left out.
 */
export function depositGroups<T extends DepositablePayment & { billingEntityId: string }>(
  payments: T[],
  today: string,
  entityOrder: readonly string[],
): DepositGroup<T>[] {
  const entities = [...new Set([...entityOrder, ...payments.map((p) => p.billingEntityId)])];
  return entities.flatMap((id) => {
    const byMethod = toDeposit(
      payments.filter((p) => p.billingEntityId === id),
      today,
    );
    return DEPOSIT_METHODS.filter((m) => byMethod[m].length > 0).map((m) => ({
      billingEntityId: id,
      method: m,
      payments: byMethod[m],
    }));
  });
}

/**
 * Grand total, total per method of what came in, and refunds apart (#294): money paid
 * back to payers is never netted into a method's total (a cheque refund would hide the
 * cheques received), it shows as its own negative amount. `total` is the net of all of them.
 */
export function totals<T extends { method: string; amountCents: number; reversalKind?: ReversalKind | null }>(
  rows: T[],
): { total: number; byMethod: Record<string, number>; refunded: number } {
  const byMethod: Record<string, number> = {};
  let total = 0;
  let refunded = 0;
  for (const l of rows) {
    total += l.amountCents;
    if (l.reversalKind === "refund") refunded += l.amountCents;
    else byMethod[l.method] = (byMethod[l.method] ?? 0) + l.amountCents;
  }
  return { total, byMethod, refunded };
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
  /** Name of the billing entity that cashed it (#300). */
  entity: string;
};

const dateFr = (iso: string | null) => (iso ? frenchDate(iso) : "");

/**
 * CSV export for accounting: separator « ; », amounts « 123,45 », dates DD/MM/YYYY, BOM for Excel.
 * « Entreprise » always comes last, even with a single entity (#300): the accountant's
 * import keeps the same columns whatever the school.
 */
export function toCsv(rows: ExportRow[]): string {
  const header = [
    "Date",
    "Payeur",
    "Moyen",
    "Montant",
    "Référence",
    "Émetteur",
    "Encaissement prévu",
    "Remise",
    "Entreprise",
  ];
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
      csvText(l.entity),
    ]),
  );
}
