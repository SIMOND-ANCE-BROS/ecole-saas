import { withSchool } from "@/db";
import { PAYMENT_METHODS } from "@/db/payments";
import { paymentLog } from "@/db/deposits";
import { toCsv } from "@/domain/payments/deposits";
import { validDate } from "@/domain/schedule/week";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { isKeyOf } from "@/lib/has";

/** CSV export of the payment log (`?du=&au=&moyen=`), for the accounts (#98). */
export async function GET(query: Request) {
  const { schoolId: schoolId } = await requireRole("director", "front_desk");
  const p = new URL(query.url).searchParams;
  const today = todayInParis();
  const from = validDate(p.get("du")) ?? today;
  const to = validDate(p.get("au")) ?? today;
  const m = p.get("moyen");
  const method = m && isKeyOf(PAYMENT_METHODS, m) ? m : null;
  const rows = await withSchool(schoolId, (tx) => paymentLog(tx, from, to, method));
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
