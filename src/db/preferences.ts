import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { member, listPreference } from "./schema";

/**
 * Column layout of the lists, specific to each member (#89). The
 * member is found by their account in the current school (RLS): an account
 * that is a member of two schools has one layout per school. Validating the
 * columns is up to the caller (`readLayout`).
 */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

/** Columns saved by this account for this list, or null (default layout). */
export async function readPreference(tx: Tx, userId: string, list: string): Promise<string[] | null> {
  const [p] = await tx
    .select({ columns: listPreference.columns })
    .from(listPreference)
    .innerJoin(member, eq(member.id, listPreference.memberId))
    .where(and(eq(member.userId, userId), eq(listPreference.list, list)));
  return p?.columns ?? null;
}

/** Saves (or replaces) the layout; false if the account is not a member of the current school. */
export async function savePreference(tx: Tx, userId: string, list: string, columns: string[]): Promise<boolean> {
  const [m] = await tx.select({ id: member.id }).from(member).where(eq(member.userId, userId));
  if (!m) return false;
  await tx
    .insert(listPreference)
    .values({ schoolId: CURRENT_SCHOOL, memberId: m.id, list: list, columns: columns })
    .onConflictDoUpdate({
      target: [listPreference.memberId, listPreference.list],
      set: { columns: columns, updatedAt: sql`now()` },
    });
  return true;
}
