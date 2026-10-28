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
