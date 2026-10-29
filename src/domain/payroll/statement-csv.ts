/** CSV export of instructor statements (#285), same conventions as the payment log (#98). */

import { csvAmount, csvDocument, csvText } from "../../lib/csv";
import { frenchDate } from "../../lib/dates";
import { PAY_UNITS } from "./rate-field";
import { FLAG_TEXTS, type InstructorStatement, lineRemark } from "./statement";

export const STATEMENT_CSV_HEADER = [
  "Intervenant",
  "Date",
  "Heure",
  "Cours",
  "Durée (min)",
  "Taux",
  "Unité",
  "Montant",
  "Remarque",
] as const;

/**
 * One row per lesson owed, then per instructor a « Forfait mensuel » row
 * when one is owed and an « À vérifier » row per flag. The « Montant » column
 * adds up to the amount due: lessons « à chiffrer » and monthly flat lessons
 * have none.
 */
export function statementCsv(statements: readonly InstructorStatement[]): string {
  const rows: string[][] = [];
  for (const s of statements) {
    const name = csvText(s.name);
    for (const c of s.courses)
      for (const l of c.lines)
        rows.push([
          name,
          frenchDate(l.date),
          l.startTime,
          csvText(c.courseLabel),
          String(l.minutes),
          l.rateCents === null ? "" : csvAmount(l.rateCents),
          l.unit === null ? "" : PAY_UNITS[l.unit],
          l.amountCents === null ? "" : csvAmount(l.amountCents),
          csvText(lineRemark(l, s.payMode)),
        ]);
    if (s.flatCents !== null)
      rows.push([
        name,
        "",
        "",
        "Forfait mensuel",
        "",
        csvAmount(s.flatCents),
        PAY_UNITS.monthly_flat,
        csvAmount(s.flatCents),
        "",
      ]);
    for (const f of s.flags) rows.push([name, "", "", "À vérifier", "", "", "", "", csvText(FLAG_TEXTS[f])]);
  }
  return csvDocument(STATEMENT_CSV_HEADER, rows);
}
