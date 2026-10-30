/**
 * Marks `overdue` the unpaid installments of issued invoices whose due date is past, in
 * every school (#358). Scheduled task, once a day, after midnight Europe/Paris:
 *
 *   npm run installments:overdue
 *
 * Administration script, like submissions:purge: the owner connection only lists the
 * schools that have such installments; each school is then updated by the application,
 * under its own RLS (`withSchool`, `markOverdue`). No personal data in the output.
 */
import postgres from "postgres";
import { withSchool } from "../src/db";
import { markOverdue } from "../src/db/allocations";
import { todayInParis } from "../src/domain/people/age";
import { SETTLED_INVOICE_STATUS } from "../src/domain/payments/allocation";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante");
const admin = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  const today = todayInParis();
  const schools = await admin`SELECT DISTINCT i.school_id AS id FROM installment i
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
      console.error(`École ${id} : échéances en retard non marquées`, e);
    }
  }
  console.log(`Échéances passées en retard : ${marked} (écoles : ${schools.length} ; en échec : ${failed}).`);
  if (failed > 0) process.exitCode = 1;
}

// The application pool (src/db) keeps the process alive: exit explicitly.
void main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.end();
    process.exit(process.exitCode ?? 0);
  });
