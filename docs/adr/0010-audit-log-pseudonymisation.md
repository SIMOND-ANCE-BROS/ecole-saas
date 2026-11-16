# 0010. Pseudonymise personal values in the audit log after the retention period

- Status: Proposed
- Date: 2026-11-16
- Issue: #184 (amends the immutability of the audit log of ADR 0001 without superseding it)

## Context

`audit_log` is append-only: the trigger `audit_log_append_only` refused every
UPDATE and DELETE. Since #178 it holds the e-mail of invited people, and since
#292, #316 and #297 the free text typed as the reason of a price apart from the
grid (`reason`, `priceReason`). Neither could be erased without disabling the
trigger by hand.

The owner decided on 2026-11-15 (to be confirmed by the accountant): money
entries (payments, invoices and their audit rows) are kept 10 years, never
deleted; the personal data inside the audit log is pseudonymised 3 years after
the end of the relationship: the value is replaced by a placeholder, the row
and its technical values (amounts, dates, ids, methods) are kept.

## Decision

- **app_user can no longer UPDATE, DELETE or TRUNCATE `audit_log`**
  (migration 0069). The privileges guard holds this as its one exception.
- **One way to change a row**: `pseudonymise_audit_entries(ids bigint[])`,
  SECURITY DEFINER, `search_path` empty, owned by the migration role. It reads
  the school from `app.school_id` (set by `withSchool`; it refuses to run
  without one) and filters on it explicitly, since its owner bypasses RLS. It
  takes ids only (at most 500 per call), does the redaction itself
  (`audit_redacted`), skips what is already redacted and writes one audit entry
  of its own, with the ids and a count.
- **The trigger checks the content of every UPDATE**, whoever runs it, the
  owner included: same id, school, time, actor, table, row and action; same
  JSON keys; every changed value is the string value of a personal key of the
  row's table, replaced by the placeholder `[pseudonymisé]`. DELETE stays
  refused; a new statement trigger refuses TRUNCATE.
- **The personal keys are code**: `audit_personal_keys()`, an IMMUTABLE
  function of the migration (invitation `email`, `name`; enrollment and lesson
  pack `reason`; workshop sign-up `reason`, `priceReason`). A new personal key
  takes a migration. `PERSONAL_KEYS` (`src/domain/audit/pseudonymise.ts`)
  mirrors it, an integration test keeps them equal; `TECHNICAL_KEYS` and
  `SCHOOL_DATA_TABLES` classify the rest, and the run reports a key no list
  knows.
- **Which entries** is chosen in TypeScript, in one place
  (`src/db/audit-pseudonymisation.ts`): the « end of the relationship » rule,
  proposed and awaiting the owner, with the cutoff `pseudonymisationCutoff`
  (today − 3 years, Europe/Paris). The run is a scheduled script per school,
  like the submission purge (`npm run audit:pseudonymise`, monthly), under each
  school's RLS. No cron in the application, no queue.

## Alternatives considered

- **Deleting the rows**: breaks the 10-year trail of money entries.
- **A setting (GUC) allowing the update**: app_user can set any custom setting.
- **Checking `current_user` in the trigger**: role names differ per
  environment, and a privileged session could still change amounts.
- **Redaction computed by the application, checked by the trigger**: the rule
  in three places, and app_user writing arbitrary JSON within the check.
- **A table of personal keys**: the default privileges of migration 0006 would
  make it writable by app_user, which could then declare `amount_cents`
  personal.
- **Encryption with a key per person (crypto-shredding)**: too heavy for one
  developer and for values this small.

## Consequences

- The audit log is no longer strictly immutable: it is append-only except for
  this redaction, which can never touch an amount, a date or an id.
- Each new personal value logged needs a migration extending
  `audit_personal_keys()` and its mirror; the run prints keys nobody
  classified (« Clés du journal à classer »).
- Which entries are due is enforced in TypeScript only: the function would
  redact early any personal value of the current school it is given. It must
  never be reachable from a request (route, server action); only the
  scheduled script calls it.
- Only top-level keys are redacted: a writer nesting a personal value inside
  a sub-object (`courses`, `fields`) would escape it, and must log it at the
  top level instead.
- The run's own entry has `target_table = 'audit_log'` and `row_id` = the
  school id; the redacted entries are listed in `after.ids`.
- Tests that clean up as the owner keep disabling the trigger by name, as
  before.
- Open questions for the owner (#184): the definition of the end of the
  relationship; whether the school's own sender (`email_connector`), the
  answers to « Comment nous avez-vous connus ? » (`referral_source.label`, free
  text that could name someone) and the `person` entries (photos refusal,
  referral answer) count as personal values. Known edges of the proposed rule:
  people imported from the previous software count as « in a relationship »
  for 3 years after the import (their record is new); an invitee who later
  changes their account e-mail no longer matches their membership.
