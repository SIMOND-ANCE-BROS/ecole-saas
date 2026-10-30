import postgres, { type Sql } from "postgres";
import { EXIT_CODE, errorLabel, exclusively, exitCodeOf, type TaskResult } from "../../src/jobs/scheduled-task";

/**
 * Entry point of a scheduled script (#337): connects with `DATABASE_ADMIN_URL`, runs `fn` once if
 * no other run of `name` is under way, prints one summary line and exits with an `EXIT_CODE`.
 * Past `timeoutMs`, the process exits with `timedOut`: the next run takes over, every task being
 * idempotent. Lives in `scripts/` on purpose: the owner connection (BYPASSRLS) never reaches
 * application code.
 *
 * `admin` is for listing the ids of the schools that have work, nothing else: every business
 * query goes through `withSchool`, under that school's RLS.
 */
export function runScheduledTask(
  task: { name: string; timeoutMs: number },
  fn: (admin: Sql) => Promise<TaskResult>,
): void {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    console.error(`${task.name} : DATABASE_ADMIN_URL manquante.`);
    process.exit(EXIT_CODE.failed);
  }
  // Two connections: one holds the task's lock, the other lists the schools.
  const admin = postgres(url, { max: 2, connect_timeout: 10, onnotice: () => {} });
  // Not unref'd: a run stuck on a promise that never settles must end in `timedOut`, not in an
  // empty event loop exiting 0.
  const watchdog = setTimeout(() => {
    console.error(`${task.name} : arrêtée après ${Math.round(task.timeoutMs / 1000)} s (délai dépassé).`);
    process.exit(EXIT_CODE.timedOut);
  }, task.timeoutMs);

  let code: number = EXIT_CODE.failed;
  // The application pool (src/db) keeps the process alive: exit explicitly.
  void exclusively(admin, task.name, () => fn(admin))
    .then((outcome) => {
      if (!outcome.ran) {
        console.log(`${task.name} : une autre exécution est en cours, rien à faire.`);
        code = EXIT_CODE.ok;
        return;
      }
      console.log(`${task.name} : ${outcome.value.summary}`);
      code = exitCodeOf(outcome.value);
    })
    .catch((e: unknown) => {
      console.error(`${task.name} : échec (${errorLabel(e)}).`);
      code = EXIT_CODE.failed;
    })
    .finally(async () => {
      clearTimeout(watchdog);
      await admin.end({ timeout: 5 }).catch(() => {});
      process.exit(code);
    });
}
