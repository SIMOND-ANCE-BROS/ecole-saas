import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { account, session, user } from "../db/schema";

/**
 * A sign-in racing a change of password (#404, ADR 0008). Better Auth reads
 * the password hash, checks the password (slow on purpose), then writes the
 * session. An account taken back (`consumeLink` with credentials) in between
 * closes the sessions before that one exists: whoever chose the old password
 * would keep a session with it. The sign-in action reads the hash before
 * signing in (`credentialBefore`) and keeps the new session only if the hash
 * is still the same afterwards (`keepSessionIfPasswordUnchanged`).
 *
 * Global tables of Better Auth (no school, no RLS), like `school-access.ts`.
 */

export type CredentialBefore = { userId: string; passwordHash: string | null };

/** The account of this address and its password hash as stored now, or null without an account. */
export async function credentialBefore(email: string): Promise<CredentialBefore | null> {
  const [row] = await db
    .select({ userId: user.id, passwordHash: account.password })
    .from(user)
    .leftJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "credential")))
    .where(eq(user.email, email.trim().toLowerCase()));
  return row ?? null;
}

/**
 * Keeps the session just opened (`token`) only if the account's password hash
 * is still the one read before the sign-in; otherwise deletes it and returns
 * false. Locks the account row first: a take-back or reset under way holds it
 * until its commit (`consumeLink`), so the comparison reads its new hash. A
 * change committed before that lock is seen too; one starting after it closes
 * this session itself, already written. A legitimate change racing the
 * person's own sign-in only asks them to sign in again.
 */
export async function keepSessionIfPasswordUnchanged(
  token: string,
  userId: string,
  before: CredentialBefore | null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [locked] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("share");
    const [now] = await tx
      .select({ passwordHash: account.password })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
    const unchanged =
      !!locked &&
      !!before &&
      before.userId === userId &&
      before.passwordHash !== null &&
      now?.passwordHash === before.passwordHash;
    if (!unchanged) await tx.delete(session).where(and(eq(session.token, token), eq(session.userId, userId)));
    return unchanged;
  });
}
