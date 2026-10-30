import postgres, { type Sql } from "postgres";

/**
 * Frame of the administration scripts run on a schedule in production (#337, list and runbook in
 * `docs/guides/deployment.md`): one run at a time per task, a bounded duration, an exit code the
 * host's scheduler can alert on, and logs carrying counts, ids and error kinds only (never a
 * name, an address nor an error message, which may quote a row's values).
 */

/** Exit codes of a scheduled task. A run skipped because another one is running exits `ok`. */
export const EXIT_CODE = { ok: 0, failed: 1, timedOut: 2 } as const;

/** What a run did: one line of counts for the logs, and how many units (schools…) failed. */
export type TaskResult = { summary: string; failures: number };

export const exitCodeOf = (result: TaskResult) => (result.failures > 0 ? EXIT_CODE.failed : EXIT_CODE.ok);

/** A PostgreSQL SQLSTATE or a Node error code (`ECONNREFUSED`): short, upper-case, no spaces. */
const TECHNICAL_CODE = /^[A-Z0-9_]{1,32}$/;

/** An error as it may be logged: its class and technical code, never its message. */
export function errorLabel(e: unknown): string {
  if (!(e instanceof Error)) return "unknown error";
  const code = (e as Error & { code?: unknown }).code;
  return typeof code === "string" && TECHNICAL_CODE.test(code) ? `${e.name} ${code}` : e.name;
}

const LOCK_PREFIX = "ecole-saas:scheduled-task:";

/**
 * Runs `fn` only if no other run of the same task holds its lock, in this database: a session
 * advisory lock on a connection reserved for the whole run, released at the end (or when the
 * process dies and the connection drops). Needs a direct or session-pooled connection, not a
 * transaction pooler. The pool must have a second connection for the task's own queries.
 */
export async function exclusively<T>(
  admin: Sql,
  task: string,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  const key = LOCK_PREFIX + task;
  const lock = await admin.reserve();
  try {
    const [row] = await lock<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(hashtext(${key})) AS locked`;
    if (!row?.locked) return { ran: false };
    try {
      return { ran: true, value: await fn() };
    } finally {
      await lock`SELECT pg_advisory_unlock(hashtext(${key}))`;
    }
  } finally {
    lock.release();
  }
}

/**
 * Entry point of a scheduled script: connects with `DATABASE_ADMIN_URL` (used only to list the
 * schools to process; each school is then handled under its own RLS), runs `fn` once if no other
 * run of `name` is under way, prints one summary line and exits with an `EXIT_CODE`. Past
 * `timeoutMs`, the process exits with `timedOut`: the next run takes over, every task being
 * idempotent.
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
  const watchdog = setTimeout(() => {
    console.error(`${task.name} : arrêtée après ${Math.round(task.timeoutMs / 1000)} s (délai dépassé).`);
    process.exit(EXIT_CODE.timedOut);
  }, task.timeoutMs);
  watchdog.unref();

  let code: number = EXIT_CODE.failed;
  // The application pool (src/db) keeps the process alive: exit explicitly.
  void exclusively(admin, task.name, () => fn(admin))
    .then((outcome) => {
      if (!outcome.ran) {
        process.stdout.write(`${task.name} : une autre exécution est en cours, rien à faire.\n`);
        code = EXIT_CODE.ok;
        return;
      }
      process.stdout.write(`${task.name} : ${outcome.value.summary}\n`);
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
