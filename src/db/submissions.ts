import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from ".";
import { submission } from "./schema";

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

/** Kinds of submission made safe to retry (#260). */
export type SubmissionKind = "payment" | "enrollment" | "course";

/** The same key sent with other values: never replayed, never applied. */
export const KEY_REUSED = "Cette saisie a déjà été envoyée avec d’autres valeurs : rechargez la page.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** JSON with object keys sorted, so that the same values always give the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Fingerprint of what the browser sent with the key. */
export const requestHash = (request: unknown) => createHash("sha256").update(canonical(request)).digest("hex");

type Refused = { ok: false; message: string };

/** What a first payment submission stored: the payments it recorded. */
export const storedPayments = z.object({ ok: z.literal(true), ids: z.array(z.uuid()) });
/** What a first enrollment submission stored: the enrollment it created. */
export const storedEnrollment = z.object({ ok: z.literal(true), id: z.uuid() });
/** What a first course submission stored: the course and the planning to go back to. */
export const storedCourse = z.object({
  ok: z.literal(true),
  id: z.uuid(),
  instructorRateCents: z.number().int().nullable(),
  season: z.string().optional(),
});

/**
 * Runs `create` at most once per key (#260). The key row is written first, in
 * the caller's transaction:
 * - a new key runs `create`; a success stores its result, a refusal frees the
 *   key (row deleted) so that the corrected entry can be sent again;
 * - a key already used, by a first attempt whose response was lost, returns the
 *   stored result without creating anything;
 * - two attempts at the same time: the second waits on the primary key until
 *   the first ends, then sees its row (or inserts its own if it was rolled back).
 * The same key with other values or another kind is refused.
 */
export async function once<T extends { ok: true }, F extends Refused>(
  tx: Tx,
  kind: SubmissionKind,
  key: string,
  request: unknown,
  stored: z.ZodType<T>,
  create: () => Promise<T | F>,
): Promise<T | F | Refused> {
  // The actions already check the key with Zod; this is the only check for direct callers (tests, scripts).
  if (!UUID.test(key)) return { ok: false, message: "Saisie invalide." };
  const hash = requestHash(request);
  const inserted = await tx
    .insert(submission)
    .values({ schoolId: CURRENT_SCHOOL, key: key, kind: kind, requestHash: hash })
    .onConflictDoNothing()
    .returning({ key: submission.key });
  const mine = and(eq(submission.schoolId, CURRENT_SCHOOL), eq(submission.key, key));
  if (inserted.length === 0) {
    const [done] = await tx.select().from(submission).where(mine);
    if (!done || done.kind !== kind || done.requestHash !== hash) return { ok: false, message: KEY_REUSED };
    const result = stored.safeParse(done.result);
    return result.success ? result.data : { ok: false, message: KEY_REUSED };
  }
  // `create` runs inside a savepoint: a refusal rolls back whatever it wrote before
  // refusing (a new room created before the discipline was refused…), then frees the key.
  try {
    const r = await tx.transaction(async () => {
      const x = await create();
      if (!x.ok) throw new RefusedInside(x);
      return x;
    });
    // Only technical ids are stored (and the planning link of a course), never personal data.
    await tx.update(submission).set({ result: r }).where(mine);
    return r;
  } catch (e) {
    if (!(e instanceof RefusedInside)) throw e;
    await tx.delete(submission).where(mine);
    return e.refusal;
  }
}

/** Carries a refusal out of the savepoint, so that the savepoint is rolled back. */
class RefusedInside extends Error {
  constructor(readonly refusal: Refused) {
    super("refused");
  }
}
