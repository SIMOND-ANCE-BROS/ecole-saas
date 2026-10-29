/**
 * CSV for spreadsheets and accounting (#98, #285): separator « ; », amounts
 * « 123,45 », lines ending in CRLF, a BOM so that Excel reads UTF-8.
 */

/** Integer cents → « 1234,56 », « -60,00 » (no thousands separator, no currency). */
export function csvAmount(cents: number): string {
  if (!Number.isInteger(cents)) throw new TypeError("Montant entier attendu");
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Text cell: quoted if needed, and never interpreted as a formula by a spreadsheet. */
export function csvText(v: string | null): string {
  let t = v ?? "";
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** The whole file: BOM, header, rows (cells already written by `csvAmount`, `csvText`…). */
export const csvDocument = (header: readonly string[], rows: readonly (readonly string[])[]) =>
  `﻿${[header, ...rows].map((r) => r.join(";")).join("\r\n")}\r\n`;
