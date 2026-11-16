/**
 * The e-mails carrying an invitation or a password link (#105), in plain text
 * (read by any mail client). The link alone gives access: the e-mail says how
 * long it works and what to do if it was not expected.
 */

import { addressWait } from "./email-proof";

export type LinkKind = "invitation" | "reset";

/** Most characters of a name or a school name put in an e-mail. */
export const MAIL_TEXT_MAX = 100;

/**
 * A name as it may stand in an e-mail: one line, no control nor direction
 * character (they could fake lines or reorder text), at most `MAIL_TEXT_MAX`
 * characters. Checked at entry too; cleaned again here, whatever the data says.
 */
export function mailText(value: string): string {
  return value
    .replace(/[\p{Cc}\u2028\u2029\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAIL_TEXT_MAX);
}

/**
 * Most invitation and password e-mails a school sends in 24 hours, all people
 * together (#105): far above a school's needs (a whole team in a day), low
 * enough that a looping director cannot use the e-mail service as a relay.
 */
export const LINK_EMAILS_SCHOOL_DAILY_MAX = 30;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Why a new link must not be e-mailed now, from the times the school created
 * links for the same person and for anyone (#105), or null when it may go: per
 * person, as the proof e-mails (`addressWait`: two minutes apart, five a day);
 * per school, `LINK_EMAILS_SCHOOL_DAILY_MAX` a day. `wait`: seconds.
 */
export function linkEmailHold(
  earlier: { person: readonly Date[]; school: readonly Date[] },
  now: Date,
): { scope: "person" | "school"; wait: number } | null {
  const person = addressWait({ school: earlier.person, all: earlier.person }, now);
  if (person > 0) return { scope: "person", wait: person };
  const recent = earlier.school
    .filter((d) => d.getTime() > now.getTime() - DAY_MS)
    .sort((a, b) => a.getTime() - b.getTime());
  if (recent.length < LINK_EMAILS_SCHOOL_DAILY_MAX) return null;
  const oldest = recent[recent.length - LINK_EMAILS_SCHOOL_DAILY_MAX];
  return { scope: "school", wait: Math.ceil((oldest.getTime() + DAY_MS - now.getTime()) / 1000) };
}

/** How long a link works, as the e-mail and the team screen say it. */
export const LINK_VALIDITY_TEXT: Record<LinkKind, string> = { invitation: "7 jours", reset: "24 heures" };

export function linkMessage(p: { kind: LinkKind; school: string; name: string | null; url: string }): {
  subject: string;
  text: string;
} {
  const name = p.name ? mailText(p.name) : "";
  const hello = name ? `Bonjour ${name},` : "Bonjour,";
  const school = mailText(p.school);
  if (p.kind === "invitation")
    return {
      subject: `Invitation à rejoindre ${school}`,
      text: [
        hello,
        "",
        `${school} vous invite à rejoindre son équipe sur son logiciel de gestion. Pour accepter et choisir votre mot de passe, ouvrez ce lien (valable ${LINK_VALIDITY_TEXT.invitation}) :`,
        "",
        p.url,
        "",
        "Si vous n’attendiez pas cette invitation, ignorez ce message : sans ce lien, rien ne change.",
      ].join("\n"),
    };
  return {
    subject: `Nouveau mot de passe pour ${school}`,
    text: [
      hello,
      "",
      `La direction de ${school} vous envoie un lien pour choisir un nouveau mot de passe. Ouvrez-le (valable ${LINK_VALIDITY_TEXT.reset}) :`,
      "",
      p.url,
      "",
      "Si vous n’avez rien demandé, ignorez ce message et prévenez la direction de l’école : votre mot de passe actuel reste valable tant que ce lien n’est pas utilisé.",
    ].join("\n"),
  };
}
