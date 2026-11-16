import { unstable_rethrow } from "next/navigation";
import { timeoutCodeOf } from "../db/wait-limits";
import { has } from "./has";

/**
 * What a server action returns (CLAUDE.md §8): success, or a French message
 * for the user. Extra fields go on the success side only (`ActionResult<{ removed: number }>`).
 */
export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; message: string };

/** The result of a database write, without its internal fields (`id`…). */
export const actionResult = (r: { ok: true } | { ok: false; message: string }): ActionResult =>
  r.ok ? { ok: true } : { ok: false, message: r.message };

/** Shown when the call itself fails: lost connection or server error. */
export const NOT_SAVED = "Non enregistré : réessayez. Si le problème continue, vérifiez la connexion.";

/** The call never got an answer (`sent: false`): what was typed can stay as it is. */
export type NotSent = { ok: false; message: typeof NOT_SAVED; sent: false };

/**
 * Runs a server action from the browser. A call that fails on its own (lost
 * connection, server error) becomes a French refusal marked `sent: false`
 * instead of Next's error screen (#243); a redirect or a « not found » still
 * goes through.
 */
export async function settle<T extends { ok: boolean }>(call: () => Promise<T>): Promise<T | NotSent> {
  try {
    return await call();
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: NOT_SAVED, sent: false };
  }
}

/**
 * `settle` for an action whose answer has another shape (`{ message }`, a form
 * state…): when the call fails on its own, `failed` builds the answer shown
 * instead, from which the form keeps what was typed (#257). A redirect or a
 * « not found » still goes through.
 */
export async function orNotSaved<T>(call: () => Promise<T>, failed: () => T): Promise<T> {
  try {
    return await call();
  } catch (e) {
    unstable_rethrow(e);
    return failed();
  }
}

/**
 * Shown when an action that creates a record fails on its own: the answer may
 * have been lost after the save, so retrying blindly could record it twice.
 */
export const CONNECTION_LOST =
  "La connexion a été coupée : l’enregistrement a peut-être été fait. Vérifiez avant de réessayer.";

/**
 * `orNotSaved` for an action that creates a record (payment, enrollment,
 * course, person…): `failed` receives `CONNECTION_LOST` to put in the answer,
 * so the screen asks to check before retrying instead of inviting a duplicate.
 */
export const orConnectionLost = <T>(call: () => Promise<T>, failed: (message: typeof CONNECTION_LOST) => T) =>
  orNotSaved(call, () => failed(CONNECTION_LOST));

/** Whether a refusal comes from a call that never got an answer. */
export const notSent = <T extends { ok: boolean }>(r: T | NotSent): r is NotSent => has(r, "sent") && r.sent === false;

/**
 * Shown when a save waited too long for another one on the same records (#364): this attempt
 * saved nothing (an earlier attempt with the same submission key may have; a retry returns it).
 */
export const BUSY = "Réessayez dans un instant.";

/** A refusal because the save waited too long (`WAIT_LIMITS`): retrying in a moment is safe. */
export type Busy = { ok: false; message: typeof BUSY };

/**
 * Runs a server action's `withSchool` call (#364): a lock or statement timeout (55P03, 57014,
 * `WAIT_LIMITS`) becomes the refusal « Réessayez dans un instant. » instead of an error page.
 * The transaction was rolled back whole, so even a creating action can be retried. Any other
 * error goes through. `busy` builds the answer when the action's result has another shape.
 */
export async function orBusy<T>(call: () => Promise<T>): Promise<T | Busy>;
export async function orBusy<T>(call: () => Promise<T>, busy: (message: typeof BUSY) => T): Promise<T>;
export async function orBusy<T>(
  call: () => Promise<T>,
  busy: (message: typeof BUSY) => T | Busy = (message) => ({ ok: false, message }),
): Promise<T | Busy> {
  try {
    return await call();
  } catch (e) {
    const code = timeoutCodeOf(e);
    if (code === null) throw e;
    // Seen in the logs if timeouts keep happening; the SQLSTATE only, never the query or its values.
    console.warn("withSchool wait ran out", { code });
    return busy(BUSY);
  }
}
