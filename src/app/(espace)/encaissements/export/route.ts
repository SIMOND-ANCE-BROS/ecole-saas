import { withSchool } from "@/db";
import { PAYMENT_METHODS } from "@/db/payments";
import { paymentLog } from "@/db/deposits";
import { toCsv } from "@/domain/payments/deposits";
import { paymentLogQuery, shownPaymentLog } from "@/domain/payments/payment-log";
import { validDate } from "@/domain/schedule/week";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";

/**
 * CSV export of the payment log, for the accounts (#98): the period
 * (`?du=&au=`) and the table's column filters and sort (`f`, `mode`, `sort`,
 * `order`, #107), read like the page does (`paymentLogQuery`), so it holds the
 * rows shown, all pages; an older `?moyen=` becomes the method filter.
 */
export async function GET(query: Request) {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const p = new URL(query.url).searchParams;
  const today = todayInParis();
  // Same default period as the page: from the 1st of the month.
  const from = validDate(p.get("du")) ?? `${today.slice(0, 8)}01`;
  const to = validDate(p.get("au")) ?? today;
  const { filter, sort } = paymentLogQuery(p, PAYMENT_METHODS);
  const log = await withSchool(schoolId, (tx) => paymentLog(tx, from, to, null));
  const rows = shownPaymentLog(
    log.map((l) => ({ ...l, methodLabel: PAYMENT_METHODS[l.method] })),
    filter,
    sort,
    today,
  );
  const csv = toCsv(
    rows.map((l) => ({
      date: l.date,
      payer: l.payer,
      method: PAYMENT_METHODS[l.method],
      amountCents: l.amountCents,
      reference: l.reference,
      issuer: l.issuer,
      plannedPayment: l.plannedPayment,
      deposit: l.dateDeposit,
    })),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="encaissements-${from}-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
