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
      set: columnsOf(calendarConnection, { ...columns, lastSyncedAt: null, error: null, createdAt: sql`now()` }),
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

export async function connectedInstructors(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: calendarConnection.instructorId })
    .from(calendarConnection)
    .innerJoin(instructor, eq(instructor.id, calendarConnection.instructorId))
    .where(eq(instructor.active, true));
  return rows.map((c) => c.id);
}

/** Result of a synchronisation; a token renewed by the provider replaces the old one. */
export async function recordSync(
  tx: Tx,
  instructorId: string,
  r: { error: string | null; encryptedToken?: string },
): Promise<void> {
  await tx
    .update(calendarConnection)
    .set(
      columnsOf(calendarConnection, {
        error: r.error,
        ...(r.error ? {} : { lastSyncedAt: sql`now()` }),
        ...(r.encryptedToken ? { encryptedToken: r.encryptedToken } : {}),
      }),
    )
    .where(eq(calendarConnection.instructorId, instructorId));
}

/**
 * Saves a token the provider renewed, without touching the sync's result: used when that result
 * could not be recorded (#381). The token arrives already encrypted.
 */
export async function saveRenewedToken(tx: Tx, instructorId: string, encryptedToken: string): Promise<void> {
  await tx.update(calendarConnection).set({ encryptedToken }).where(eq(calendarConnection.instructorId, instructorId));
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
