/**
 * Pseudonymises the personal values of the audit log 3 years after the end of the relationship,
 * in every school (#184, ADR 0010). Scheduled task, once a month (docs/guides/deployment.md):
 *
 *   npm run audit:pseudonymise
 *
 * Administration script, like submissions:purge: the owner connection only lists the schools whose
 * audit log still holds personal values; each school is then handled by the application, under its
 * own RLS (`withSchool`, one transaction per batch: `pseudonymiseDue`), and the database function writes the change itself
 * (`pseudonymise_audit_entries`, migration 0068). Payments, invoices and their lines are never
 * touched. The output holds counts and key names only, never a value.
 */
import { withSchool } from "../src/db";
import { pseudonymiseDue } from "../src/db/audit-pseudonymisation";
import { todayInParis } from "../src/domain/people/age";
import { errorLabel } from "../src/jobs/scheduled-task";
import { runScheduledTask } from "./lib/scheduled-task";

runScheduledTask({ name: "audit:pseudonymise", timeoutMs: 30 * 60_000 }, async (admin) => {
  const today = todayInParis();
  const schools = await admin<{ id: string }[]>`SELECT DISTINCT a.school_id AS id FROM audit_log a
    WHERE EXISTS (
      SELECT 1 FROM audit_personal_keys() k
      CROSS JOIN LATERAL (VALUES (a.before -> k.key), (a.after -> k.key)) v(value)
      WHERE k.target_table = a.target_table AND jsonb_typeof(v.value) = 'string'
        AND v.value <> to_jsonb(audit_placeholder()))`;
  let pseudonymised = 0;
  let failed = 0;
  const unclassified = new Set<string>();
  for (const { id } of schools) {
    // One school failing does not stop the others; the next run catches up.
    try {
      const run = await pseudonymiseDue((fn) => withSchool(id, fn), today);
      pseudonymised += run.pseudonymised;
      for (const k of run.unclassified) unclassified.add(k);
    } catch (e: unknown) {
      failed += 1;
      console.error(`École ${id} : pseudonymisation en échec (${errorLabel(e)}).`);
    }
  }
  // Key names only (never a value): a writer logging a key no list classifies.
  if (unclassified.size > 0)
    console.error(`Clés du journal à classer (src/domain/audit/pseudonymise.ts) : ${[...unclassified].join(", ")}.`);
  return {
    summary: `entrées du journal pseudonymisées : ${pseudonymised} (écoles : ${schools.length} ; en échec : ${failed}).`,
    failures: failed,
  };
});
