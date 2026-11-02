/**
 * Sending e-mail (#105, #179). One interface; the rest of the code never knows
 * the provider. No provider is chosen yet (#105, blocked): `emailSender()`
 * returns null and the screens offer nothing that needs an e-mail. The fake
 * sender keeps messages in memory and sends nothing: tests and demonstration
 * only, never in production (`EMAIL_FAKE_ALLOWED=1`).
 *
 * A real provider must time out, retry a bounded number of times and fail
 * with `{ ok: false, reason }`; it never logs an address, a subject or a body.
 */

export type EmailMessage = { to: string; subject: string; text: string };

export type SendResult = { ok: true } | { ok: false; reason: "unavailable" | "refused" | "timeout" };

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

/** The sender configured on this server, or null when none is (no provider until #105). */
export function emailSender(env: Env = process.env): EmailSender | null {
  if (env.EMAIL_FAKE_ALLOWED === "1") return fakeSender;
  return null;
}
