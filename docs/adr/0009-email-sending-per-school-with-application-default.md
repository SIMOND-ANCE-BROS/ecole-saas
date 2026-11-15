# 0009. Send e-mail through a per-school connector, with an application default

- Status: Proposed
- Date: 2026-11-15
- Issue: #105 (amends ADR 0008 without superseding it; follows #104 and #179)

## Context

Invitations and password links are shown to the director, who passes them on
by hand (#104). The e-mail proof of ADR 0008 (#179) needs a real provider in
production. The owner decided on 2026-11-15: one sending connector per school,
like the invoicing connector (ADR 0007); **Brevo** as the application's
default sender, **Resend** selectable by a school; both through their HTTP
APIs with `fetch`, no new dependency. Resend is a US provider: a school
choosing it accepts a transfer outside the EU (DPA, standard contractual
clauses). Messages to families (#105 Q2) stay open.

Both providers show the messages they sent, links included, in their
dashboards: whoever holds a school's provider account can read every e-mail
sent through it.

## Decision

- **One table, one row per school**: `email_connector` (primary key
  `school_id`), provider `email_provider` (`brevo`, `resend`), the API key
  encrypted on the application side (`encrypted_api_key`,
  `src/lib/encryption.ts`, a check refuses anything but the `v1.` format),
  sender address and name in plain columns (not secret, shown on screen), an
  `active` flag. Forced RLS with `school_isolation`. Every save or removal is
  audited with « key changed: yes/no », never the key. The fake sender is
  never a setting: it stays behind `EMAIL_FAKE_ALLOWED`.
- **A school's sender** (`schoolEmailSender`, `src/lib/email.ts`), read inside
  `withSchool()`: its own active connector; otherwise the application sender
  on its behalf (« École X via … »); otherwise the fake sender where allowed;
  otherwise none. An active connector this server cannot use (key that will
  not decrypt) is reported (`broken`, Paramètres › E-mails) and sends nothing:
  **no silent fall back** to another sender and domain than the school chose.
- **Invitations and password links** go through the school's sender, to the
  invited address or the account's address, and the link is no longer shown
  when the e-mail went. Without a sender, or when sending fails, the link is
  shown to pass on by hand, with a French notice saying why (#104 fallback).
- **Proof-of-address e-mails (#179) always go through the application
  sender** (`platformEmailSender`), never a school's: a director reading their
  own Resend or Brevo logs would read the code and take the account, undoing
  ADR 0008. `joinProof` reads the same sender, so a school's setting never
  decides which proof is required.
- **Calls**: each attempt times out after 8 s; one retry, after 1 s, on a
  network error, a timeout, a 5xx, or a 429 asking to wait 2 s or less; a 4xx
  fails at once. About 17 s at most, the time a director waits on a button.
  Resend gets one idempotency key per message, the same on the retry; Brevo has
  none, so a timed-out first attempt that did go out may arrive twice (the same
  link twice: harmless). Failures are `{ ok: false, reason, status, code }`
  (`unavailable`, `refused`, `timeout`); logs carry school and link ids, the
  route and the status, never an address, subject, body or key.
- A « Tester l’envoi » action sends a test e-mail with the saved setting to
  the director's own address only, limited per school.

## Alternatives considered

- **A global sender only**: the owner wants a school to use its own account
  and domain.
- **Proof e-mails through the school's sender**: rejected for the reason above.
- **Falling back silently to the application sender** when a school's key is
  unusable: hides a broken setup and sends from a domain the school did not
  choose.
- **The providers' SDKs**: two dependencies for one POST each.
- **No retry after a timeout** (the message may already be gone): a duplicate
  invitation is harmless and Resend deduplicates; a lost one costs a director a
  second try.

## Consequences

- The application's Brevo account needs a verified sending domain (SPF, DKIM,
  DMARC) before production; `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS` and
  `EMAIL_FROM_NAME` go into `.env.example`.
- A school configuring its own account verifies its domain at its provider
  first; the screen says so and « Tester l’envoi » shows what to check.
- Follow-up: mark the address verified when an account is created through an
  invitation that was **e-mailed by the application sender and never shown**
  (needs a `link_shown` flag set in the transaction that returns the link).
  Not done here: an invitation e-mailed through a school's own account can be
  read in its logs.
- `CLAUDE.md` §3 gains `email_connector`, `email_provider`,
  `platformEmailSender`, `schoolEmailSender`; §7 the e-mail connectors.
