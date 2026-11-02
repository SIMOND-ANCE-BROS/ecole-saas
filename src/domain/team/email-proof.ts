/**
 * Proof of e-mail ownership for an invitation (#179, ADR 0008). An account
 * created through an invitation link is not verified: whoever held the link
 * chose its password. Before such an account joins another school, its owner
 * proves the address by opening a link e-mailed to it, and chooses a new
 * password on the way (taking the account back if someone else created it).
 */

/** How the person opening an invitation proves they may use the invited e-mail. */
export type JoinProof =
  /** No account for this e-mail yet: the link creates it (unverified). */
  | "create"
  /** An account exists: its current password. */
  | "password"
  /** An unverified account exists: a link e-mailed to the address, then a new password. */
  | "email";

/**
 * The proof asked when an invitation is opened. Without an e-mail service
 * (#105) an unverified account keeps confirming its password, as before #179:
 * nothing else can prove the address yet.
 */
export function joinProof(account: { emailVerified: boolean } | null, canSendEmail: boolean): JoinProof {
  if (!account) return "create";
  return !account.emailVerified && canSendEmail ? "email" : "password";
}

/** How long the e-mailed link works. */
export const EMAIL_PROOF_DURATION_MS = 60 * 60_000;
/** Shortest time between two e-mails for one invitation: whoever holds the link cannot flood the address. */
export const EMAIL_PROOF_RESEND_MS = 2 * 60_000;

/** Seconds left before another e-mail may be sent for an invitation (0: now). */
export function resendWait(lastSentAt: Date | null, now: Date): number {
  if (!lastSentAt) return 0;
  const left = lastSentAt.getTime() + EMAIL_PROOF_RESEND_MS - now.getTime();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/**
 * Most e-mails an address receives in 24 hours from one school, all its
 * invitations together: re-inviting the same address must not let a school
 * flood it. Counted per school, so one school cannot use up another's.
 */
export const EMAIL_PROOF_DAILY_MAX = 5;
/** Ceiling for an address, all schools together: far above one school's share, against floods only. */
export const EMAIL_PROOF_ADDRESS_DAILY_MAX = 20;
const DAY_MS = 24 * 60 * 60_000;

/** Seconds until fewer than `max` of `sentAts` fall in the last 24 hours (0: already). */
function capWait(sentAts: readonly Date[], max: number, now: Date): number {
  const recent = sentAts.filter((d) => d.getTime() > now.getTime() - DAY_MS).sort((a, b) => a.getTime() - b.getTime());
  if (recent.length < max) return 0;
  // Once the oldest counted e-mail is a day old, one more may go.
  const oldest = recent[recent.length - max];
  return Math.ceil((oldest.getTime() + DAY_MS - now.getTime()) / 1000);
}

/**
 * Seconds left before an address may receive another e-mail from a school (0:
 * now), from the times it received one: from this school, two minutes after
 * the last and no more than `EMAIL_PROOF_DAILY_MAX` in 24 hours; from all
 * schools, no more than `EMAIL_PROOF_ADDRESS_DAILY_MAX`.
 */
export function addressWait(sent: { school: readonly Date[]; all: readonly Date[] }, now: Date): number {
  const own = sent.school.filter((d) => d.getTime() > now.getTime() - DAY_MS);
  const last = [...own].sort((a, b) => a.getTime() - b.getTime()).at(-1) ?? null;
  return Math.max(
    resendWait(last, now),
    capWait(own, EMAIL_PROOF_DAILY_MAX, now),
    // A school's first e-mail of the day always goes: other schools filling the ceiling never block it.
    own.length === 0 ? 0 : capWait(sent.all, EMAIL_PROOF_ADDRESS_DAILY_MAX, now),
  );
}

/** « dans 2 minutes », « dans 3 heures »: a wait said in words, rounded up. */
export function retryIn(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes === 1) return "dans une minute";
  if (minutes < 60) return `dans ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "dans une heure" : `dans ${hours} heures`;
}

/** « dans l’heure »: how long the e-mailed link works, as the e-mail and the page say it. */
export const EMAIL_PROOF_DURATION_TEXT = "dans l’heure";

/** The e-mail carrying the proof link (plain text: read by any mail client). */
export function emailProofMessage(p: { school: string; url: string }): { subject: string; text: string } {
  return {
    subject: `Confirmez votre adresse e-mail pour rejoindre ${p.school}`,
    text: [
      "Bonjour,",
      "",
      `${p.school} vous invite à rejoindre son équipe. Pour confirmer que cette adresse e-mail est bien la vôtre et choisir votre mot de passe, ouvrez ce lien ${EMAIL_PROOF_DURATION_TEXT} :`,
      "",
      p.url,
      "",
      "Si vous n’attendiez pas cette invitation, ignorez ce message : rien ne change sans ce lien.",
    ].join("\n"),
  };
}
