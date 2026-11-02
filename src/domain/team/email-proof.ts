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

/** The e-mail carrying the proof link (plain text: read by any mail client). */
export function emailProofMessage(p: { school: string; url: string }): { subject: string; text: string } {
  return {
    subject: `Confirmez votre adresse e-mail pour rejoindre ${p.school}`,
    text: [
      "Bonjour,",
      "",
      `${p.school} vous invite à rejoindre son équipe. Pour confirmer que cette adresse e-mail est bien la vôtre et choisir votre mot de passe, ouvrez ce lien dans l’heure :`,
      "",
      p.url,
      "",
      "Si vous n’attendiez pas cette invitation, ignorez ce message : rien ne change sans ce lien.",
    ].join("\n"),
  };
}
