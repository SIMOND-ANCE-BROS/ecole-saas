/**
 * Remises en banque et journal des encaissements (#98) : règles pures, en
 * centimes, dates `YYYY-MM-DD`.
 */

export const DEPOSIT_METHODS = ["cheque", "especes", "cheque_vacances"] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];
export const isDepositable = (method: string): method is DepositMethod =>
  (DEPOSIT_METHODS as readonly string[]).includes(method);

export type DepositablePayment = {
  id: string;
  method: string;
  amountCents: number;
  /** Montant déjà annulé par des corrections. */
  correctedCents: number;
  plannedPayment: string | null;
  depositId: string | null;
};

/**
 * Paiements à remettre, par moyen : chèques (une fois leur date
 * d'encaissement arrivée), espèces et chèques vacances, pas encore remis ni
 * entièrement annulés par une correction.
 */
export function toDeposit<T extends DepositablePayment>(payments: T[], today: string): Record<DepositMethod, T[]> {
  const r: Record<DepositMethod, T[]> = { cheque: [], especes: [], cheque_vacances: [] };
  for (const p of payments) {
    if (!isDepositable(p.method) || p.amountCents <= 0 || p.depositId !== null) continue;
    if (p.amountCents - p.correctedCents <= 0) continue;
    if (p.plannedPayment !== null && p.plannedPayment > today) continue;
    r[p.method].push(p);
  }
  return r;
}

/** Total général et par moyen. */
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

const amount = (c: number) =>
  `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)},${String(Math.abs(c) % 100).padStart(2, "0")}`;
const dateFr = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
/** Cellule texte : guillemets si besoin, et jamais interprétée comme formule par un tableur. */
function texte(v: string | null): string {
  let t = v ?? "";
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Export CSV pour la comptabilité : séparateur « ; », montants « 123,45 », dates JJ/MM/AAAA, BOM pour Excel. */
export function toCsv(rows: ExportRow[]): string {
  const header = ["Date", "Payeur", "Moyen", "Montant", "Référence", "Émetteur", "Encaissement prévu", "Remise"];
  const body = rows.map((l) =>
    [
      dateFr(l.date),
      texte(l.payer),
      texte(l.method),
      amount(l.amountCents),
      texte(l.reference),
      texte(l.issuer),
      dateFr(l.plannedPayment),
      dateFr(l.deposit),
    ].join(";"),
  );
  return `﻿${[header.join(";"), ...body].join("\r\n")}\r\n`;
}
