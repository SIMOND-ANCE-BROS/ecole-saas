import { and, eq, gt, ne, sql } from "drizzle-orm";
import { columnsOf } from "./columns-of";
import { z } from "zod";
import type { Provider } from "../connectors/calendar/oauth";
import type { Tx } from "./index";
import { calendarConnection, unavailability, instructor } from "./schema";

/** Instructors' connected calendars, always within the `withSchool()` transaction (RLS). */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;

export type ConnectionState = {
  provider: Provider;
  account: string | null;
  lastSyncedAt: Date | null;
  error: string | null;
};

/**
 * Saves (or replaces) an active instructor's connected calendar; the token
 * arrives already encrypted. false if the instructor does not exist or is no longer active.
 */
export async function saveConnection(
  tx: Tx,
  instructorId: string,
  c: { provider: Provider; account: string | null; encryptedToken: string },
): Promise<boolean> {
  if (!isUuid(instructorId)) return false;
  const [i] = await tx
    .select({ id: instructor.id })
    .from(instructor)
    .where(and(eq(instructor.id, instructorId), eq(instructor.active, true)));
  if (!i) return false;
  const columns = { provider: c.provider, account: c.account, encryptedToken: c.encryptedToken };
  await tx
    .insert(calendarConnection)
    .values(columnsOf(calendarConnection, { ...columns, instructorId: instructorId, schoolId: CURRENT_SCHOOL }))
    .onConflictDoUpdate({
      target: calendarConnection.instructorId,
      // A sync still running on the replaced connection loses its claim (#370): its writes match nothing.
      set: columnsOf(calendarConnection, {
        ...columns,
        lastSyncedAt: null,
        error: null,
        syncClaimedUntil: null,
        createdAt: sql`now()`,
      }),
    });
  return true;
}

export async function connectionState(tx: Tx, instructorId: string): Promise<ConnectionState | null> {
  if (!isUuid(instructorId)) return null;
  const [c] = await tx
    .select({
      provider: calendarConnection.provider,
      account: calendarConnection.account,
      lastSyncedAt: calendarConnection.lastSyncedAt,
      error: calendarConnection.error,
    })
    .from(calendarConnection)
    .where(eq(calendarConnection.instructorId, instructorId));
  return c ?? null;
}

/** For synchronisation only: includes the encrypted token. */
export async function readConnection(tx: Tx, instructorId: string) {
  if (!isUuid(instructorId)) return null;
  const [c] = await tx
    .select({ provider: calendarConnection.provider, encryptedToken: calendarConnection.encryptedToken })
    .from(calendarConnection)
    .innerJoin(instructor, eq(instructor.id, calendarConnection.instructorId))
    .where(and(eq(calendarConnection.instructorId, instructorId), eq(instructor.active, true)));
  return c ?? null;
}

/** How long a sync holds its calendar (#370): beyond the worst sync (refresh and 20 calendar pages, 10 s each). */
export const SYNC_CLAIM_MINUTES = 5;

/** The connection a sync claimed: what it read, and its claim, the key of every later write. */
export type ClaimedConnection = {
  provider: Provider;
  encryptedToken: string;
  /** The claim, as Postgres prints it (microseconds kept), like the invoice outbox (ADR 0007). */
  claim: string;
};

/**
 * Claims an active instructor's connected calendar for one sync (#370), in one statement: two
 * syncs never both refresh the same token. `busy` when another sync holds a live claim; null when
 * no calendar is connected. Waits at most 5 s for a row lock (`lock_timeout`, then throws); the
 * claim itself is no lock: it runs out after `SYNC_CLAIM_MINUTES` if the sync never records.
 */
export async function claimConnection(tx: Tx, instructorId: string): Promise<ClaimedConnection | "busy" | null> {
  if (!isUuid(instructorId)) return null;
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  const [c] = await tx.execute<{ provider: Provider; encrypted_token: string; claim: string }>(sql`
    UPDATE calendar_connection c
    SET sync_claimed_until = now() + make_interval(mins => ${SYNC_CLAIM_MINUTES})
    FROM instructor i
    WHERE i.id = c.instructor_id AND i.active
      AND c.instructor_id = ${instructorId}
      AND (c.sync_claimed_until IS NULL OR c.sync_claimed_until <= now())
    RETURNING c.provider, c.encrypted_token, c.sync_claimed_until::text AS claim`);
  if (c) return { provider: c.provider, encryptedToken: c.encrypted_token, claim: c.claim };
  return (await readConnection(tx, instructorId)) ? "busy" : null;
}

/** The connection a sync claimed and read, untouched since: the condition of its writes (#370, #383). */
const claimed = (instructorId: string, c: { readToken: string; claim: string }) =>
  and(
    eq(calendarConnection.instructorId, instructorId),
    eq(calendarConnection.encryptedToken, c.readToken),
    sql`${calendarConnection.syncClaimedUntil} = ${c.claim}::timestamptz`,
  );

export async function connectedInstructors(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: calendarConnection.instructorId })
    .from(calendarConnection)
    .innerJoin(instructor, eq(instructor.id, calendarConnection.instructorId))
    .where(eq(instructor.active, true));
  return rows.map((c) => c.id);
}

/**
 * Result of a synchronisation; a token renewed by the provider replaces the old one. Tokens arrive
 * already encrypted. Recorded only on the connection the sync read (`readToken`, compared like
 * `saveRenewedToken`): a calendar reconnected meanwhile keeps its own token and stays « not yet
 * synced » rather than showing the old connection's result (#383). Only while the sync's claim is
 * still its own, which it releases (#370).
 */
export async function recordSync(
  tx: Tx,
  instructorId: string,
  r: { readToken: string; claim: string; error: string | null; encryptedToken?: string },
): Promise<void> {
  await tx
    .update(calendarConnection)
    .set(
      columnsOf(calendarConnection, {
        error: r.error,
        syncClaimedUntil: null,
        ...(r.error ? {} : { lastSyncedAt: sql`now()` }),
        ...(r.encryptedToken ? { encryptedToken: r.encryptedToken } : {}),
      }),
    )
    .where(claimed(instructorId, r));
}

/**
 * Saves a token the provider renewed, without touching the sync's result: used when that result
 * could not be recorded (#381). Both tokens arrive already encrypted; only the token the sync read
 * is replaced, under the sync's claim, which it releases (#370): a calendar reconnected meanwhile
 * keeps its own.
 */
export async function saveRenewedToken(
  tx: Tx,
  instructorId: string,
  token: { read: string; claim: string; renewed: string },
): Promise<void> {
  await tx
    .update(calendarConnection)
    .set({ encryptedToken: token.renewed, syncClaimedUntil: null })
    .where(claimed(instructorId, { readToken: token.read, claim: token.claim }));
}

/** Disconnects the calendar and removes the upcoming slots that came from it (manual entries remain). */
export async function deleteConnection(tx: Tx, instructorId: string): Promise<boolean> {
  if (!isUuid(instructorId)) return false;
  const rows = await tx
    .delete(calendarConnection)
    .where(eq(calendarConnection.instructorId, instructorId))
    .returning({ id: calendarConnection.id });
  await tx
    .delete(unavailability)
    .where(
      and(
        eq(unavailability.instructorId, instructorId),
        ne(unavailability.source, "manual"),
        gt(unavailability.endsAt, sql`now()`),
      ),
    );
  return rows.length === 1;
}
