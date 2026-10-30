/**
 * Deletes the submission keys older than a week, in every school (#262). Scheduled task, once a
 * day (docs/guides/deployment.md, #337):
 *
 *   npm run submissions:purge
 *
 * Administration script, like calendars:sync: the owner connection only lists the schools that
 * have old keys; each school is then purged by the application, under its own RLS
 * (`withSchool`). No personal data in the output.
 */
import { withSchool } from "../src/db";
import { purgeOldSubmissions, SUBMISSION_RETENTION_DAYS } from "../src/db/submissions";
import { errorLabel, runScheduledTask } from "../src/jobs/scheduled-task";

runScheduledTask({ name: "submissions:purge", timeoutMs: 10 * 60_000 }, async (admin) => {
  const schools = await admin<{ id: string }[]>`SELECT DISTINCT school_id AS id FROM submission
    WHERE created_at < now() - make_interval(days => ${SUBMISSION_RETENTION_DAYS})`;
  let deleted = 0;
  let failed = 0;
  for (const { id } of schools) {
    // One school failing does not stop the others; the next run catches up.
    try {
      deleted += await withSchool(id, (tx) => purgeOldSubmissions(tx));
    } catch (e: unknown) {
      failed += 1;
      console.error(`École ${id} : purge en échec (${errorLabel(e)}).`);
    }
  }
  return {
    summary: `clés de saisie purgées : ${deleted} (écoles : ${schools.length} ; en échec : ${failed}).`,
    failures: failed,
  };
});
