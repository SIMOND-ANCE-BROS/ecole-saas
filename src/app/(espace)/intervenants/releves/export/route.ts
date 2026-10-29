import { withSchool } from "@/db";
import { statementData } from "@/db/statements";
import { monthOf, validMonth } from "@/domain/payroll/month";
import { hasStatement, instructorStatement, monthStatement } from "@/domain/payroll/statement";
import { statementCsv } from "@/domain/payroll/statement-csv";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";

/**
 * CSV export of the instructors' statements of a month (#285), management
 * only: `?mois=2027-10`, and `&intervenant=<id>` for one instructor. Read
 * like the pages do, computed live.
 */
export async function GET(query: Request) {
  const { schoolId } = await requireRole("director");
  const p = new URL(query.url).searchParams;
  const today = todayInParis();
  const month = validMonth(p.get("mois")) ?? monthOf(today);
  const one = p.get("intervenant");
  const data = await withSchool(schoolId, (tx) => statementData(tx, month, one ?? undefined));
  const statements =
    one === null
      ? monthStatement({ month, today, ...data }).statements
      : data.instructors.filter(hasStatement).map((instructor) =>
          instructorStatement({
            month,
            today,
            instructor,
            lessons: data.lessons,
            rateChanges: data.rateChanges,
            closures: data.closures,
          }),
        );
  return new Response(statementCsv(statements), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="releves-intervenants-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
