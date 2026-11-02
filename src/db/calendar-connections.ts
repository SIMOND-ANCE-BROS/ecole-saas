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
 * Replacing a calendar of another provider removes the upcoming slots read from the previous
 * one, like a disconnection (#386): no sync replaces them any more. With the same provider, they
 * stay until the next sync replaces them, so the instructor never looks free meanwhile.
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
  const [previous] = await tx
    .select({ provider: calendarConnection.provider })
    .from(calendarConnection)
    .where(eq(calendarConnection.instructorId, instructorId))
    .for("update");
  const columns = { provider: c.provider, account: c.account, encryptedToken: c.encryptedToken };
  await tx
    .insert(calendarConnection)
    .values(columnsOf(calendarConnection, { ...columns, instructorId: instructorId, schoolId: CURRENT_SCHOOL }))
    .onConflictDoUpdate({
      target: calendarConnection.instructorId,
      set: columnsOf(calendarConnection, { ...columns, lastSyncedAt: null, error: null, createdAt: sql`now()` }),
    });
  if (previous && previous.provider !== c.provider) await removeUpcomingSlots(tx, instructorId, previous.provider);
  return true;
}

/** Removes the upcoming slots read from a calendar (of one provider, or all); manual entries remain. */
async function removeUpcomingSlots(tx: Tx, instructorId: string, provider?: Provider): Promise<void> {
  await tx
    .delete(unavailability)
    .where(
      and(
        eq(unavailability.instructorId, instructorId),
        provider ? eq(unavailability.source, provider) : ne(unavailability.source, "manual"),
        gt(unavailability.endsAt, sql`now()`),
      ),
    );
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
 * synced » rather than showing the old connection's result (#383). Tells whether it was recorded
 * (#386): false when the calendar was reconnected or disconnected meanwhile.
 */
export async function recordSync(
  tx: Tx,
  instructorId: string,
  r: { readToken: string; error: string | null; encryptedToken?: string },
): Promise<boolean> {
  const rows = await tx
    .update(calendarConnection)
    .set(
      columnsOf(calendarConnection, {
        error: r.error,
        ...(r.error ? {} : { lastSyncedAt: sql`now()` }),
        ...(r.encryptedToken ? { encryptedToken: r.encryptedToken } : {}),
      }),
    )
    .where(and(eq(calendarConnection.instructorId, instructorId), eq(calendarConnection.encryptedToken, r.readToken)))
    .returning({ id: calendarConnection.id });
  return rows.length === 1;
}

/**
 * Saves a token the provider renewed, without touching the sync's result: used when that result
 * could not be recorded (#381). Both tokens arrive already encrypted; only the token the sync read
 * is replaced, so a calendar reconnected meanwhile keeps its own.
 */
export async function saveRenewedToken(
  tx: Tx,
  instructorId: string,
  token: { read: string; renewed: string },
): Promise<void> {
  await tx
    .update(calendarConnection)
    .set({ encryptedToken: token.renewed })
    .where(and(eq(calendarConnection.instructorId, instructorId), eq(calendarConnection.encryptedToken, token.read)));
}

/** Disconnects the calendar and removes the upcoming slots that came from it (manual entries remain). */
export async function deleteConnection(tx: Tx, instructorId: string): Promise<boolean> {
  if (!isUuid(instructorId)) return false;
  const rows = await tx
    .delete(calendarConnection)
    .where(eq(calendarConnection.instructorId, instructorId))
    .returning({ id: calendarConnection.id });
  await removeUpcomingSlots(tx, instructorId);
  return rows.length === 1;
}
