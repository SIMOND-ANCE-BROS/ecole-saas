import { AccessRemoved, credentials, readBusyRanges, refresh } from "../connectors/calendar/oauth";
import { withSchool } from "../db";
import { connectesInstructors, readConnection, recordSync } from "../db/calendar-connections";
import { replaceCalendarUnavailabilities } from "../db/unavailabilities";
import { encrypt, decrypt } from "./encryption";

/** Window read from calendars: from the day before to four months ahead. */
const BEFORE = 1;
const AFTER = 120;
const DAY = 86_400_000;

/**
 * Reads the busy ranges of an instructor's connected calendar and replaces
 * their unavailabilities that came from this calendar. Network calls happen
 * outside the transaction; no personal data in error messages.
 */
export async function syncCalendar(
  schoolId: string,
  instructorId: string,
  query: typeof fetch = fetch,
  now = new Date(),
): Promise<{ ok: true; ranges: number } | { ok: false; message: string }> {
  const connection = await withSchool(schoolId, (tx) => readConnection(tx, instructorId));
  if (!connection) return { ok: false, message: "Aucun agenda connecté." };
  const failure = async (message: string) => {
    await withSchool(schoolId, (tx) => recordSync(tx, instructorId, { error: message }));
    return { ok: false as const, message };
  };
  const id = credentials(connection.provider);
  if (!id) return failure("Connexion à ce fournisseur non configurée sur le serveur.");

  try {
    const { access: access, newRefreshToken: newRefreshToken } = await refresh(
      connection.provider,
      id,
      decrypt(connection.encryptedToken),
      query,
    );
    const window = {
      start: new Date(now.getTime() - BEFORE * DAY),
      end: new Date(now.getTime() + AFTER * DAY),
    };
    const ranges = await readBusyRanges(connection.provider, access, window, query);
    const nombre = await withSchool(schoolId, async (tx) => {
      const n = await replaceCalendarUnavailabilities(tx, instructorId, connection.provider, window, ranges);
      await recordSync(tx, instructorId, {
        error: null,
        encryptedToken: newRefreshToken ? encrypt(newRefreshToken) : undefined,
      });
      return n;
    });
    return { ok: true, ranges: nombre };
  } catch (e) {
    return failure(
      e instanceof AccessRemoved ? e.message : "Synchronisation impossible pour le moment ; elle sera retentée.",
    );
  }
}

/** All connected calendars of a school (background job). */
export async function syncSchool(
  schoolId: string,
  query: typeof fetch = fetch,
): Promise<{ succeeded: number; failed: number }> {
  const ids = await withSchool(schoolId, (tx) => connectesInstructors(tx));
  let succeeded = 0;
  for (const instructorId of ids) if ((await syncCalendar(schoolId, instructorId, query)).ok) succeeded++;
  return { succeeded, failed: ids.length - succeeded };
}
