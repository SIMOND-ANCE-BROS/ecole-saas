/**
 * How long a `withSchool` transaction waits (#364): set with `SET LOCAL` at its start, so a
 * save never hangs behind a transaction that stalls while holding a row lock (a payer, a
 * course…). Past `lockTimeout`, the statement waiting for a lock fails with 55P03; past
 * `statementTimeout`, any statement is cancelled with 57014. The whole transaction is then
 * rolled back, nothing is half written, and the server action answers « Réessayez dans un
 * instant. » (`orBusy`, `src/lib/action-result.ts`).
 *
 * The longest legitimate statements (season copy, `syncLessons`, invoice drafting) take well
 * under a second; the lock waits of the lock orders (`payment-locks.ts`, `attendance-locks.ts`)
 * last as long as the holder's own transaction, a few hundred milliseconds at most.
 *
 * Pure module (no driver import): the SQLSTATE check is also used by `action-result.ts`.
 */
export const WAIT_LIMITS = { lockTimeout: "5s", statementTimeout: "30s" } as const;

/** `lock_not_available` (lock timeout) and `query_canceled` (statement timeout). */
const TIMEOUT_CODES = ["55P03", "57014"] as const;
type TimeoutCode = (typeof TIMEOUT_CODES)[number];
const isTimeoutCode = (code: unknown): code is TimeoutCode => TIMEOUT_CODES.some((c) => c === code);

/**
 * The SQLSTATE of a wait that ran out (`WAIT_LIMITS`), or null for any other error. Drizzle
 * wraps the driver's error (`DrizzleQueryError`), whose Postgres code is on `cause`: the chain
 * is followed a few levels.
 */
export function timeoutCodeOf(e: unknown): TimeoutCode | null {
  let current: unknown = e;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (isTimeoutCode(code)) return code;
    current = cause;
  }
  return null;
}

/** Whether `e` is a wait that ran out (`WAIT_LIMITS`). */
export const waitedTooLong = (e: unknown): boolean => timeoutCodeOf(e) !== null;
