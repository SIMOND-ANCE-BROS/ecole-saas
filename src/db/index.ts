import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { WAIT_LIMITS } from "./wait-limits";

/** Connection with the `app_user` role, subject to Row Level Security. */
const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Sets `setting` for the transaction, with `SET LOCAL lock_timeout` and `statement_timeout`
 * (`WAIT_LIMITS`, #364), in one round trip: `set_config(…, true)` lasts until the transaction
 * ends, so a pooled connection goes back to the server defaults. Admin scripts
 * (`DATABASE_ADMIN_URL`, their own connection) never go through here.
 */
const startBounded = (setting: "app.school_id" | "app.user_id", value: string) =>
  sql`select set_config(${setting}, ${value}, true),
    set_config('lock_timeout', ${WAIT_LIMITS.lockTimeout}, true),
    set_config('statement_timeout', ${WAIT_LIMITS.statementTimeout}, true)`;

/**
 * Runs `fn` in a transaction restricted to one school.
 * Every query made with `tx` sees and writes only that school's rows.
 * Its waits are bounded (`WAIT_LIMITS`, #364): a row lock held too long elsewhere fails it
 * (55P03, or 57014 for a statement) instead of hanging; server actions answer
 * « Réessayez dans un instant. » (`orBusy`, `src/lib/action-result.ts`).
 */
export function withSchool<T>(schoolId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(startBounded("app.school_id", schoolId));
    return fn(tx);
  });
}

/**
 * Lists the schools where a user is an active member, at sign-in (before
 * choosing one). A deactivated member no longer has access.
 */
export function schoolsOf(userId: string) {
  return db.transaction(async (tx) => {
    // Bounded like `withSchool`: choosing a school never hangs either.
    await tx.execute(startBounded("app.user_id", userId));
    return tx
      .select({ id: schema.school.id, name: schema.school.name, role: schema.member.role })
      .from(schema.member)
      .innerJoin(schema.school, sql`${schema.school.id} = ${schema.member.schoolId}`)
      .where(eq(schema.member.active, true))
      .orderBy(schema.school.name);
  });
}
