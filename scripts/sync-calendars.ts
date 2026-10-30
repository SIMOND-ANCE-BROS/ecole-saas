/**
 * Synchronises the connected calendars of all schools. Scheduled task, every hour
 * (docs/guides/deployment.md, #337):
 *
 *   npm run calendars:sync
 *
 * Administration script: the owner connection is only used to list the schools that have a
 * connected calendar; each school is then processed by the application, under its own RLS.
 * A calendar that fails is recorded on its connection (shown to the school) and retried next
 * run; a school that fails as a whole fails the run. No personal data in the output.
 */
import { syncSchool } from "../src/lib/calendar-sync";
import { errorLabel, runScheduledTask } from "../src/jobs/scheduled-task";

runScheduledTask({ name: "calendars:sync", timeoutMs: 15 * 60_000 }, async (admin) => {
  const schools = await admin<{ id: string }[]>`SELECT DISTINCT school_id AS id FROM calendar_connection`;
  let succeeded = 0;
  let failed = 0;
  let failedSchools = 0;
  for (const { id } of schools) {
    // One school failing does not stop the others.
    try {
      const r = await syncSchool(id);
      succeeded += r.succeeded;
      failed += r.failed;
    } catch (e: unknown) {
      failedSchools += 1;
      console.error(`École ${id} : synchronisation en échec (${errorLabel(e)}).`);
    }
  }
  return {
    summary: `agendas synchronisés : ${succeeded} ; en échec : ${failed} (écoles : ${schools.length} ; en échec : ${failedSchools}).`,
    failures: failedSchools,
  };
});
