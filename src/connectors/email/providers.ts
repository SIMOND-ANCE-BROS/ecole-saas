import { randomUUID } from "node:crypto";
import type { EmailProvider } from "../../domain/email/settings";
import { type HttpOptions, postJson } from "./http";
import type { EmailSender } from "./sender";

/**
 * The two e-mail providers (#105, ADR 0009), each one HTTP call with `fetch`:
 * no SDK. Brevo is the application's default sender; a school may configure
 * its own Brevo or Resend account (`email_connector`). Resend is a US provider:
 * a school choosing it accepts a transfer outside the EU (owner, 2026-11-15).
 */

/** What a provider needs: the account's API key and who the e-mails come from. */
export type ProviderConfig = { apiKey: string; fromAddress: string; fromName: string };

export const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
export const RESEND_URL = "https://api.resend.com/emails";

/** Brevo transactional API: `api-key` header, plain-text content. */
export function brevoSender(config: ProviderConfig, options: HttpOptions = {}): EmailSender {
  return {
    send: (message) =>
      postJson(
        {
          url: BREVO_URL,
          headers: { "api-key": config.apiKey },
          body: {
            sender: { email: config.fromAddress, name: config.fromName },
            to: [{ email: message.to }],
            subject: message.subject,
            textContent: message.text,
          },
        },
        options,
      ),
  };
}

/**
 * Resend API: bearer key. One idempotency key per message, the same on the
 * retry: a first attempt that did go out is not sent twice.
 */
export function resendSender(config: ProviderConfig, options: HttpOptions = {}): EmailSender {
  return {
    send: (message) =>
      postJson(
        {
          url: RESEND_URL,
          headers: { authorization: `Bearer ${config.apiKey}`, "idempotency-key": randomUUID() },
          body: {
            from: `${quotedName(config.fromName)} <${config.fromAddress}>`,
            to: [message.to],
            subject: message.subject,
            text: message.text,
          },
        },
        options,
      ),
  };
}

export function providerSender(provider: EmailProvider, config: ProviderConfig, options?: HttpOptions): EmailSender {
  switch (provider) {
    case "brevo":
      return brevoSender(config, options);
    case "resend":
      return resendSender(config, options);
  }
}

/** A display name as RFC 5322 allows it in `From`: quoted, without quotes, backslashes or line breaks. */
const quotedName = (name: string) => `"${name.replace(/["\\\r\n]/g, "")}"`;
