import { unstable_rethrow } from "next/navigation";
import { NOT_SAVED } from "@/lib/action-result";

type Refused = { ok: false; message: string };

/**
 * Runs a server action from the browser. A call that fails on its own (lost
 * connection, server error) becomes a French refusal instead of Next's error
 * screen, so the form keeps what was typed (#243); a redirect or a « not
 * found » still goes through.
 */
export async function settle<T extends { ok: true } | Refused>(call: () => Promise<T>): Promise<T | Refused> {
  try {
    return await call();
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, message: NOT_SAVED };
  }
}
