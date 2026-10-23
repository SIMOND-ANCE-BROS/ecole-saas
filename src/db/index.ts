import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** Connection with the `app_user` role, subject to Row Level Security. */
const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` in a transaction restricted to one school.
 * Every query made with `tx` sees and writes only that school's rows.
 */
export function withSchool<T>(schoolId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.school_id', ${schoolId}, true)`);
    return fn(tx);
  });
}

/**
 * Lists the schools where a user is an active member, at sign-in (before
 * choosing one). A deactivated member no longer has access.
 */
export function schoolsOf(userId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return tx
      .select({ id: schema.school.id, name: schema.school.name, role: schema.member.role })
      .from(schema.member)
      .innerJoin(schema.school, sql`${schema.school.id} = ${schema.member.schoolId}`)
      .where(eq(schema.member.active, true))
      .orderBy(schema.school.name);
  });
}
