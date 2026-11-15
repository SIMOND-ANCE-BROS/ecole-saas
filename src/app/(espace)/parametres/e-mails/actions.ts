"use server";

import { revalidatePath } from "next/cache";
import type { SendFailure } from "@/connectors/email/sender";
import { withSchool } from "@/db";
import { deleteEmailSetting, type EmailSettingEntry, saveEmailSetting } from "@/db/email-connectors";
import { routeLabel, sendFailureMessage } from "@/domain/email/settings";
import { actionResult, type ActionResult } from "@/lib/action-result";
import { schoolEmailSender } from "@/lib/email";
import { TokenBucket } from "@/lib/rate-limit";
import { currentSession, requireRole } from "@/lib/session";

const PATH = "/parametres/e-mails";

/** The school's own e-mail account (#105): management only, checked before anything else. */
export async function saveEmailSettings(entry: EmailSettingEntry): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director");
  const saved = await withSchool(schoolId, (tx) => saveEmailSetting(tx, userId, entry));
  revalidatePath(PATH);
  return actionResult(saved);
}

/** Back to the application's sender. */
export async function removeEmailSettings(): Promise<ActionResult> {
  const { schoolId, userId } = await requireRole("director");
  const removed = await withSchool(schoolId, (tx) => deleteEmailSetting(tx, userId));
  revalidatePath(PATH);
  return actionResult(removed);
}

// Test e-mails per school: three at once, then one a minute (this server only), against a stuck key.
const TESTS = new Map<string, TokenBucket>();

/**
 * Sends a test e-mail with the saved setting to the director's own address
 * (never an address typed on screen: the button cannot be used to write to
 * anyone else). Says in French what to check when it fails.
 */
export async function sendTestEmail(): Promise<ActionResult<{ to: string }>> {
  const { schoolId } = await requireRole("director");
  const { user } = await currentSession();
  const now = Date.now();
  for (const [id, b] of TESTS) if (b.idle(now)) TESTS.delete(id);
  const bucket = TESTS.get(schoolId) ?? new TokenBucket(3, 1 / 60, now);
  TESTS.set(schoolId, bucket);
  if (!bucket.take(now)) return { ok: false, message: "Trop d’essais d’envoi : réessayez dans une minute." };
  const { route, sender } = await schoolEmailSender(schoolId);
  if (!sender) return { ok: false, message: routeLabel(route) };
  const r = await sender
    .send({
      to: user.email,
      subject: "Essai d’envoi d’e-mail",
      text: [
        "Bonjour,",
        "",
        "Cet e-mail d’essai confirme que le logiciel de l’école peut envoyer des e-mails : les invitations et les liens de mot de passe partiront ainsi.",
        "",
        routeLabel(route),
      ].join("\n"),
    })
    .catch((): SendFailure => ({ ok: false, reason: "unavailable" }));
  if (r.ok) return { ok: true, to: user.email };
  console.error(`School ${schoolId}: test e-mail not sent (${route.kind}, ${r.reason})`);
  return { ok: false, message: sendFailureMessage(r) };
}
