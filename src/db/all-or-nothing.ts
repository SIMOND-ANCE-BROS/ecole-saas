import type { Tx } from "./index";

type Refused = { ok: false; message: string };

/** Thrown out of the savepoint of `allOrNothing`, so that the savepoint is rolled back. */
class RefusedInside extends Error {
  constructor() {
    super("refused");
  }
}

/**
 * Runs a multi-step change inside a savepoint of the caller's transaction
 * (#260, #269). A returned refusal does not roll back a transaction by itself:
 * here it undoes whatever `change` already wrote (a cleared payer, a person or
 * a room just created…), then is returned as is. Any other error goes through.
 */
export async function allOrNothing<R extends { ok: true } | Refused>(
  tx: Tx,
  change: (savepoint: Tx) => Promise<R>,
): Promise<R> {
  const refused: { result?: R } = {};
  try {
    return await tx.transaction(async (savepoint) => {
      const r = await change(savepoint);
      if (!r.ok) {
        refused.result = r;
        throw new RefusedInside();
      }
      return r;
    });
  } catch (e) {
    if (e instanceof RefusedInside && refused.result) return refused.result;
    throw e;
  }
}
