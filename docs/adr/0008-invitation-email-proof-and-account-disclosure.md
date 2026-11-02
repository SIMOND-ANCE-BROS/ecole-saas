# 0008. Prove the e-mail of an unverified account before it joins another school; accept that an invitation reveals whether an account exists

- Status: Proposed
- Date: 2026-11-02
- Issue: #179 (follow-up of #104 and #177; e-mail service: #105)

## Context

Accounts are global (Better Auth), memberships are per school. Until an
e-mail service exists (#105), an invitation link is shown to the director who
creates it, who passes it on by hand (SMS, personal e-mail). Whoever opens it
first chooses the password of the new account, which is therefore stored with
`email_verified = false`.

A malicious director can then create the account of an address they do not
own. If another school later invites the real owner, the owner is asked for a
current password they never chose, and nobody can reset a shared account
(#104 refuses it on purpose).

Opening an invitation also tells whether an account already exists for the
address (« Vous avez déjà un compte »): a director can learn that an address
is used somewhere in the SaaS, though not in which school.

## Decision

- **An unverified account proves its e-mail before joining another school.**
  When an invitation is opened for an existing account whose e-mail is not
  verified, and this server can send e-mail, its password is no longer
  accepted (`joinProof` in `src/domain/team/email-proof.ts` returns
  `email`). The person asks for a link, e-mailed **to the invited address
  only**; opening it lets them choose the account's password and join the
  school. The account is then marked verified and every open session is
  closed: whoever created the account with someone else's address loses it.
- The e-mailed code is 256 random bits, stored as a SHA-256 hash on the
  invitation (`email_code_hash`, `email_code_sent_at`), valid one hour,
  replaced by the next one, used once with the invitation, in the same
  transaction. Another e-mail for the same invitation waits two minutes.
  Opening the e-mailed link changes nothing (mail scanners open links): only
  submitting the password does.
- **One interface for sending e-mail**, `EmailSender` in
  `src/connectors/email/`. No provider is chosen (#105, blocked): until one is,
  `emailSender()` returns null and an unverified account keeps confirming its
  password, as before. A fake sender keeps messages in memory for tests and
  demonstration (`EMAIL_FAKE_ALLOWED=1`), never in production. Neither the
  address, the subject, the body nor the code is ever logged.
- **The disclosure is accepted.** An invitation keeps telling whether an
  account exists for the invited address, and now whether it is verified.
  Only a director (or whoever they gave the link to) sees it, for an address
  they chose to invite, one invitation at a time and recorded in the audit
  log; the school of the account is never shown.

## Alternatives considered

- **Hide whether an account exists** (same screen for everyone, e-mail sent in
  every case): the only proof would then be an e-mail, which does not exist
  yet; and an existing user would no longer join with their password. Worth
  revisiting once invitations are e-mailed directly (#105).
- **Keep the password as an alternative to the e-mail**: whoever chose the
  password (the malicious director) could still use it to join another school
  with an address they do not own.
- **Better Auth's own e-mail verification** (`sendVerificationEmail`,
  `/verify-email`): it verifies an account, not an invitation, and needs the
  public sign-up routes and a provider; our proof is bound to the invitation
  (RLS, single use, author still a director).
- **Refuse unverified accounts in another school until #105**: nobody could
  join a second school before the e-mail service exists.

## Consequences

- With a provider configured, an account created by invitation can no longer
  spread to another school without its owner's mailbox, and the owner can
  take it back.
- Still open in #179: whether to verify the address at the first sign-in too,
  or only when joining another school. This record does the latter, which
  holds either way.
- #105 brings the provider (timeout, bounded retries, structured error, no
  personal data in logs), then can e-mail invitations directly to the invited
  address, without showing the link to the director, and mark the address
  verified when the account is created through that e-mail.
