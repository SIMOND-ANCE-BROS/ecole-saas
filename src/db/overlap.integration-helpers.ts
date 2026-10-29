import type postgres from "postgres";

/**
 * Runs two transactions that overlap (#247): `first` does its work, then calls
 * `hold()` and stays open; `second` starts, and `first` is released only once
 * `second` waits on a row lock, or has finished without waiting (the race the
 * caller's assertions then catch), or after `timeoutMs`. `hold()` resolves the
 * wait even when `first` fails, so a broken test never hangs until Vitest's timeout.
 *
 * Integration files run one after another (`fileParallelism: false`), so a lock
 * wait seen in `pg_locks` is this test's. `pg_locks` is readable by any role,
 * unlike the query text of `pg_stat_activity`.
 */
export async function overlapping<A, B>(
  admin: postgres.Sql,
  first: (hold: () => Promise<void>) => Promise<A>,
  second: () => Promise<B>,
  timeoutMs = 5000,
): Promise<[A, B]> {
  let reached!: () => void;
  const atHold = new Promise<void>((resolve) => (reached = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const a = first(async () => {
    reached();
    await released;
  }).finally(() => reached());
  // Rejections are reported by the Promise.all below; these handlers only keep Node
  // from flagging them as unhandled in the meantime.
  a.catch(() => undefined);
  await atHold;
  let settled = false;
  const b = second().finally(() => (settled = true));
  b.catch(() => undefined);
  try {
    const until = Date.now() + timeoutMs;
    while (!settled && Date.now() < until) {
      const [w] = await admin`
        SELECT count(*)::int AS n FROM pg_locks
        WHERE NOT granted AND (locktype = 'transactionid' OR relation = 'payment'::regclass)`;
      if (w.n > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    release();
  }
  return Promise.all([a, b]);
}
