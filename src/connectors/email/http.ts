import type { SendResult } from "./sender";

/**
 * One guarded HTTP call to an e-mail provider (#105, ADR 0009): each attempt
 * gives up after `timeoutMs`; a network error, a timeout, a 5xx or a short 429
 * is tried once more after a pause; anything else fails at once. Never throws:
 * the result is `{ ok: true }` or a structured failure carrying the HTTP status
 * and the provider's error code, never the address, the subject nor the body
 * (neither does any log: this module logs nothing).
 */

/** Per attempt: two attempts stay under about 20 s, the time a director waits on a button. */
export const EMAIL_TIMEOUT_MS = 8_000;
/** Pause before the single retry. */
export const EMAIL_RETRY_PAUSE_MS = 1_000;
/** A 429 is retried only when the provider asks to wait this long or less. */
const RETRY_AFTER_MAX_MS = 2_000;
const ATTEMPTS = 2;

export type HttpOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  pauseMs?: number;
};

export type Request = { url: string; headers: Record<string, string>; body: unknown };

export async function postJson(request: Request, options: HttpOptions = {}): Promise<SendResult> {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? EMAIL_TIMEOUT_MS;
  const pauseMs = options.pauseMs ?? EMAIL_RETRY_PAUSE_MS;
  let last: SendResult = { ok: false, reason: "unavailable" };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const signal = AbortSignal.timeout(timeoutMs);
    let wait = pauseMs;
    try {
      const response = await Promise.race([
        doFetch(request.url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", ...request.headers },
          body: JSON.stringify(request.body),
          signal,
          redirect: "error",
          cache: "no-store",
        }),
        // A fetch that ignores its signal still gives up on time.
        rejectedWhenAborted(signal),
      ]);
      if (response.ok) return { ok: true };
      const code = await errorCode(response);
      const status = response.status;
      if (status === 429) {
        const after = retryAfterMs(response.headers.get("retry-after"));
        last = { ok: false, reason: "unavailable", status, code };
        if (after !== null && after > RETRY_AFTER_MAX_MS) return last;
        wait = Math.max(pauseMs, after ?? 0);
      } else if (status >= 500) {
        last = { ok: false, reason: "unavailable", status, code };
      } else {
        // 4xx: a wrong key, an unverified sender, a refused address. Trying again changes nothing.
        return { ok: false, reason: "refused", status, code };
      }
    } catch (e) {
      last = signal.aborted || isTimeout(e) ? { ok: false, reason: "timeout" } : { ok: false, reason: "unavailable" };
    }
    if (attempt < ATTEMPTS) await pause(wait);
  }
  return last;
}

/** The provider's machine-readable error code, if any (Brevo `code`, Resend `name`): never its message. */
async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return undefined;
    const value = (body as Record<string, unknown>).code ?? (body as Record<string, unknown>).name;
    return typeof value === "string" && /^[\w.-]{1,64}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** `Retry-After` in seconds, as milliseconds; null when absent or not a number of seconds. */
function retryAfterMs(header: string | null): number | null {
  if (header === null || !/^\d{1,6}$/.test(header.trim())) return null;
  return Number(header.trim()) * 1000;
}

const isTimeout = (e: unknown) => e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");

const rejectedWhenAborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
