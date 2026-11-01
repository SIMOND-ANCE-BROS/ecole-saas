/**
 * Marks `overdue` the unpaid installments of issued invoices whose due date is past, in every
 * school (#358). Scheduled task, once a day, after midnight Europe/Paris
 * (docs/guides/deployment.md, #337):
 *
 *   npm run installments:overdue
 *
 * Administration script, like submissions:purge: the owner connection only lists the schools
 * that have such installments; each school is then updated by the application, under its own
 * RLS (`withSchool`, `markOverdue`). No personal data in the output.
 */
import { withSchool } from "../src/db";
import { markOverdue } from "../src/db/allocations";
import { SETTLED_INVOICE_STATUS } from "../src/domain/payments/allocation";
import { todayInParis } from "../src/domain/people/age";
import { errorLabel } from "../src/jobs/scheduled-task";
import { runScheduledTask } from "./lib/scheduled-task";

runScheduledTask({ name: "installments:overdue", timeoutMs: 10 * 60_000 }, async (admin) => {
  const today = todayInParis();
  const schools = await admin<{ id: string }[]>`SELECT DISTINCT i.school_id AS id FROM installment i
    JOIN invoice f ON f.id = i.invoice_id
    WHERE i.status = 'upcoming' AND i.due_date < ${today} AND f.status = ${SETTLED_INVOICE_STATUS}`;
  let marked = 0;
  let failed = 0;
  for (const { id } of schools) {
    // One school failing does not stop the others; the next run catches up.
    try {
      marked += await withSchool(id, (tx) => markOverdue(tx, today));
    } catch (e: unknown) {
      failed += 1;
      console.error(`École ${id} : échéances en retard non marquées (${errorLabel(e)}).`);
    }
  }
  return {
    summary: `échéances passées en retard : ${marked} (écoles : ${schools.length} ; en échec : ${failed}).`,
    failures: failed,
  };
});
