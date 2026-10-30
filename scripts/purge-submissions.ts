/**
 * Deletes the submission keys older than a week, in every school (#262).
 * Scheduled task, for example once a day:
 *
 *   npm run submissions:purge
 *
 * Administration script, like calendars:sync: the owner connection only lists
 * the schools that have old keys; each school is then purged by the
 * application, under its own RLS (`withSchool`). No personal data in the output.
 */
import postgres from "postgres";
import { withSchool } from "../src/db";
import { purgeOldSubmissions, SUBMISSION_RETENTION_DAYS } from "../src/db/submissions";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL manquante");
const admin = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  const schools = await admin`SELECT DISTINCT school_id AS id FROM submission
    WHERE created_at < now() - make_interval(days => ${SUBMISSION_RETENTION_DAYS})`;
  let deleted = 0;
  let failed = 0;
  for (const { id } of schools) {
    // One school failing does not stop the others; the next run catches up.
    try {
      deleted += await withSchool(id, (tx) => purgeOldSubmissions(tx));
    } catch (e: unknown) {
      failed += 1;
      console.error(`École ${id} : purge en échec`, e);
    }
  }
  console.log(`Clés de saisie purgées : ${deleted} (écoles : ${schools.length} ; en échec : ${failed}).`);
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
