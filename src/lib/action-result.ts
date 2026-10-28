import { unstable_rethrow } from "next/navigation";
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

/** Whether a refusal comes from a call that never got an answer. */
export const notSent = <T extends { ok: boolean }>(r: T | NotSent): r is NotSent => has(r, "sent") && r.sent === false;
