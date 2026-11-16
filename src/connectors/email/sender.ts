import { z } from "zod";
import { FROM_NAME_MAX } from "../../domain/email/settings";
import { brevoSender } from "./providers";

/**
 * Sending e-mail (#105, #179, ADR 0009). One interface; the rest of the code
 * never knows the provider (`providers.ts`: Brevo, Resend, plain `fetch`).
 *
 * - The **application sender** (`platformEmailSender`): Brevo, configured by
 *   environment variables (`BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`,
 *   `EMAIL_FROM_NAME`). It alone carries what proves an address (#179): a
 *   school never sees those e-mails in its own provider's logs.
 * - A **school's sender** (`email_connector`, `src/lib/email.ts`): its own
 *   Brevo or Resend account, for invitations and password links; without one,
 *   the application sender is used.
 * - The **fake sender** keeps messages in memory and sends nothing: tests and
 *   demonstration only (`EMAIL_FAKE_ALLOWED=1`), refused when
 *   `NODE_ENV=production` whatever the variable says (#404); used only when
 *   Brevo is not configured.
 *
 * A provider times out, retries a bounded number of times and fails with
 * `{ ok: false, reason }`; it never logs an address, a subject or a body.
 */

export type EmailMessage = { to: string; subject: string; text: string };

/**
 * `refused`: the provider said no (4xx: wrong key, unverified sender, refused
 * address), trying again changes nothing. `unavailable`: network, 5xx, 429.
 * `status` and `code` are the provider's HTTP status and error code, for the
 * screens and the logs: never personal data.
 */
export type SendFailure = { ok: false; reason: "unavailable" | "refused" | "timeout"; status?: number; code?: string };
export type SendResult = { ok: true } | SendFailure;

export interface EmailSender {
  send(message: EmailMessage): Promise<SendResult>;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Messages "sent" by the fake sender of this process, oldest first (tests read them). */
export const FAKE_OUTBOX: EmailMessage[] = [];
const FAKE_OUTBOX_SIZE = 50;

/** Sends nothing: keeps the last messages in memory. */
export const fakeSender: EmailSender = {
  async send(message) {
    FAKE_OUTBOX.push(message);
    if (FAKE_OUTBOX.length > FAKE_OUTBOX_SIZE) FAKE_OUTBOX.shift();
    return { ok: true };
  },
};

export const fakeAllowed = (env: Env = process.env) => env.EMAIL_FAKE_ALLOWED === "1" && env.NODE_ENV !== "production";

const validAddress = z.email();
let warned = false;

/** The application's Brevo account from the environment, or null when it is not (fully) set. */
export function platformConfig(
  env: Env = process.env,
): { apiKey: string; fromAddress: string; fromName: string } | null {
  const apiKey = env.BREVO_API_KEY?.trim();
  const fromAddress = env.EMAIL_FROM_ADDRESS?.trim();
  if (!apiKey) return null;
  if (!fromAddress || !validAddress.safeParse(fromAddress).success) {
    // A typo in production would silently turn every e-mail into a manual link: say it, once (names only).
    if (!warned) console.error("BREVO_API_KEY is set but EMAIL_FROM_ADDRESS is missing or invalid: no e-mail sent");
    warned = true;
    return null;
  }
  const fromName = env.EMAIL_FROM_NAME?.trim() || fromAddress;
  return { apiKey, fromAddress, fromName };
}

/**
 * The application sender: Brevo when configured, else the fake sender where
 * allowed, else null (nothing that needs an e-mail is offered). With
 * `onBehalfOf`, the e-mail reads « École X via <application> ».
 */
export function platformEmailSender(env: Env = process.env, onBehalfOf?: string): EmailSender | null {
  const config = platformConfig(env);
  if (config) {
    const school = onBehalfOf?.replace(/[\r\n]/g, " ").trim();
    const fromName = school ? `${school} via ${config.fromName}`.slice(0, FROM_NAME_MAX) : config.fromName;
    return brevoSender({ ...config, fromName });
  }
  return fakeAllowed(env) ? fakeSender : null;
}
