import { and, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Provider } from "../connectors/calendar/oauth";
import type { Tx } from "./index";
import { calendarConnection, unavailability, instructor } from "./schema";

/** Agendas connectés des intervenants, toujours avec la transaction d'`withSchool()` (RLS). */

const CURRENT_SCHOOL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;
const isUuid = (v: string) => z.uuid().safeParse(v).success;

export type ConnectionState = {
  provider: Provider;
  account: string | null;
  lastSyncedAt: Date | null;
  error: string | null;
};

/**
 * Enregistre (ou remplace) l'agenda connecté d'un intervenant actif ; le jeton
 * arrive déjà chiffré. false si l'intervenant n'existe pas ou n'est plus actif.
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
    .values({ ...columns, instructorId: instructorId, schoolId: CURRENT_SCHOOL })
    .onConflictDoUpdate({
      target: calendarConnection.instructorId,
      set: { ...columns, lastSyncedAt: null, error: null, createdAt: sql`now()` },
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

/** Pour la synchronisation seulement : jeton chiffré compris. */
export async function readConnection(tx: Tx, instructorId: string) {
  if (!isUuid(instructorId)) return null;
  const [c] = await tx
    .select({ provider: calendarConnection.provider, encryptedToken: calendarConnection.encryptedToken })
    .from(calendarConnection)
    .innerJoin(instructor, eq(instructor.id, calendarConnection.instructorId))
    .where(and(eq(calendarConnection.instructorId, instructorId), eq(instructor.active, true)));
  return c ?? null;
}

export async function connectesInstructors(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: calendarConnection.instructorId })
    .from(calendarConnection)
    .innerJoin(instructor, eq(instructor.id, calendarConnection.instructorId))
    .where(eq(instructor.active, true));
  return rows.map((c) => c.id);
}

/** Résultat d'une synchronisation ; un jeton renouvelé par le fournisseur remplace l'ancien. */
export async function recordSync(
  tx: Tx,
  instructorId: string,
  r: { error: string | null; encryptedToken?: string },
): Promise<void> {
  await tx
    .update(calendarConnection)
    .set({
      error: r.error,
      ...(r.error ? {} : { lastSyncedAt: sql`now()` }),
      ...(r.encryptedToken ? { encryptedToken: r.encryptedToken } : {}),
    })
    .where(eq(calendarConnection.instructorId, instructorId));
}

/** Déconnecte l'agenda et retire les plages à venir qui en venaient (les saisies restent). */
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
        ne(unavailability.source, "saisie"),
        gt(unavailability.endsAt, sql`now()`),
      ),
    );
  return rows.length === 1;
}
