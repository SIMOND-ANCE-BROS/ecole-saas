import { AccessRemoved, credentials, readBusyRanges, refresh } from "../connectors/calendar/oauth";
import { withSchool } from "../db";
import { errorLabel } from "../jobs/scheduled-task";
import { connectedInstructors, readConnection, recordSync, saveRenewedToken } from "../db/calendar-connections";
import { replaceCalendarUnavailabilities } from "../db/unavailabilities";
import { encrypt, decrypt } from "./encryption";

/** Window read from calendars: from the day before to four months ahead. */
const BEFORE = 1;
const AFTER = 120;
const DAY = 86_400_000;

/** Shown to the school when a sync fails for a reason other than a revoked access. */
export const SYNC_UNAVAILABLE = "Synchronisation impossible pour le moment ; elle sera retentée.";

/**
 * Logs a sync that threw instead of returning (its connection could not be read, or its own
 * error could not be recorded): ids and the error kind only, never a token, a name nor the
 * error message (#373, #377). The sync's result was not recorded: the next hourly run tries again.
 */
export function logSyncException(schoolId: string, instructorId: string, e: unknown): void {
  console.error(
    `École ${schoolId}, intervenant ${instructorId} : synchronisation en échec, erreur non enregistrée (${errorLabel(e)}).`,
  );
}

/**
 * Saves a refresh token the provider renewed, alone, when the sync's error could not be recorded
 * with it (#381). If even that write fails, the loss is logged with ids and the error kind only,
 * never the token: the calendar must be reconnected (runbook in `docs/guides/deployment.md`).
 */
async function keepRenewedToken(
  schoolId: string,
  instructorId: string,
  token: { read: string; renewed: string },
): Promise<void> {
  try {
    await withSchool(schoolId, (tx) =>
      saveRenewedToken(tx, instructorId, { read: token.read, renewed: encrypt(token.renewed) }),
    );
  } catch (e: unknown) {
    console.error(
      `École ${schoolId}, intervenant ${instructorId} : jeton d’agenda renouvelé perdu, agenda à reconnecter (${errorLabel(e)}).`,
    );
  }
}

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
  // A refresh token the provider rotated is saved even when the read that follows fails (#368).
  let renewedToken: string | null = null;
  const failure = async (message: string) => {
    try {
      await withSchool(schoolId, (tx) =>
        recordSync(tx, instructorId, {
          readToken: connection.encryptedToken,
          error: message,
          encryptedToken: renewedToken ? encrypt(renewedToken) : undefined,
        }),
      );
    } catch (e) {
      // The error could not be recorded: the renewed token is still saved on its own, or its
      // loss logged, since the provider may have revoked the old one (#381). Then rethrown.
      if (renewedToken) {
        await keepRenewedToken(schoolId, instructorId, { read: connection.encryptedToken, renewed: renewedToken });
      }
      throw e;
    }
    return { ok: false as const, message };
  };
  const id = credentials(connection.provider);
  if (!id) return failure("Connexion à ce fournisseur non configurée sur le serveur.");

  try {
    const { access, newRefreshToken } = await refresh(
      connection.provider,
      id,
      decrypt(connection.encryptedToken),
      query,
    );
    renewedToken = newRefreshToken;
    const window = {
      start: new Date(now.getTime() - BEFORE * DAY),
      end: new Date(now.getTime() + AFTER * DAY),
    };
    const ranges = await readBusyRanges(connection.provider, access, window, query);
    const count = await withSchool(schoolId, async (tx) => {
      const n = await replaceCalendarUnavailabilities(tx, instructorId, connection.provider, window, ranges);
      await recordSync(tx, instructorId, {
        readToken: connection.encryptedToken,
        error: null,
        encryptedToken: newRefreshToken ? encrypt(newRefreshToken) : undefined,
      });
      return n;
    });
    return { ok: true, ranges: count };
  } catch (e) {
    return failure(e instanceof AccessRemoved ? e.message : SYNC_UNAVAILABLE);
  }
}

/**
 * All connected calendars of a school (background job). One instructor never stops the others
 * (#373): a sync that throws, even while recording its own error (database down, lock
 * timeout), is counted in `failed` and in `unrecorded`, and logged with ids and the error kind
 * only. `unrecorded` failures are not shown to the school: the caller fails the run on them.
 */
export async function syncSchool(
  schoolId: string,
  query: typeof fetch = fetch,
): Promise<{ succeeded: number; failed: number; unrecorded: number }> {
  const ids = await withSchool(schoolId, (tx) => connectedInstructors(tx));
  let succeeded = 0;
  let unrecorded = 0;
  for (const instructorId of ids) {
    try {
      if ((await syncCalendar(schoolId, instructorId, query)).ok) succeeded++;
    } catch (e: unknown) {
      unrecorded++;
      logSyncException(schoolId, instructorId, e);
    }
  }
  return { succeeded, failed: ids.length - succeeded, unrecorded };
}
