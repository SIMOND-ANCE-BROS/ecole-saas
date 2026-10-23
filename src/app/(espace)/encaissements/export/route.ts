import { withSchool } from "@/db";
import { MOYENS, type Method } from "@/db/paiements";
import { paymentLog } from "@/db/remises";
import { toCsv } from "@/domaine/encaissement/remises";
import { validDate } from "@/domaine/planning/semaine";
import { todayInParis } from "@/domaine/personnes/age";
import { requireRole } from "@/lib/session";

/** Export CSV du journal des encaissements (`?du=&au=&moyen=`), pour la comptabilité (#98). */
export async function GET(query: Request) {
  const { schoolId: schoolId } = await requireRole("direction", "accueil");
  const p = new URL(query.url).searchParams;
  const today = todayInParis();
  const du = validDate(p.get("du")) ?? today;
  const au = validDate(p.get("au")) ?? today;
  const m = p.get("moyen");
  const method = m && m in MOYENS ? (m as Method) : null;
  const rows = await withSchool(schoolId, (tx) => paymentLog(tx, du, au, method));
  const csv = toCsv(
    rows.map((l) => ({
      date: l.date,
      payer: l.payer,
      method: MOYENS[l.method],
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
      "Content-Disposition": `attachment; filename="encaissements-${du}-${au}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
