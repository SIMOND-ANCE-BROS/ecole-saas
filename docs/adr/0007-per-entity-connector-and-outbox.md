# 0007. Send invoices through a per-entity connector and an outbox

- Status: Accepted (design approved by the owner on 2026-10-29)
- Date: 2026-10-29
- Issue: #298 (connector and sync: #303 and the following steps; epic #6)

## Context

Issuing e-invoices and e-reporting become mandatory for SMEs on
1 September 2027. The invoicing tool is not chosen yet and may differ per
billing entity (ADR 0006). One developer, no job queue in production yet,
and the front desk must never wait for a third-party service.

## Decision

- **One connector contract**: `checkCredentials`, `createCustomer`,
  `createInvoice`, `finalize`, `createCreditNote`, `readStatus`, plus
  `recordPayment` behind a capability flag if payment e-reporting is
  confirmed. **One instance per entity**, built from that entity's decrypted
  credentials; the rest of the code never knows the concrete tool.
- Calls are **idempotent** (external reference = our invoice id), time out
  after 10 s, retry once quickly on a network or 5xx error, and fail with a
  typed `InvoicingError`.
- **The invoice row is the outbox**: states `to_send`, `tool_draft`, then
  `issued`, `rejected` or `cancelled`; claimed with `FOR UPDATE SKIP LOCKED` (`claimed_until`,
  `attempts`), invoice id as idempotency key.
- Work is triggered by `after()` once an action commits, and by a **sweep
  route** (bearer `JOBS_SECRET`, timing-safe comparison) calling a
  `SECURITY DEFINER` function `invoicing_due_work()` (pinned `search_path`,
  owned by a BYPASSRLS role, `EXECUTE` granted to `app_user`) that returns
  `(school_id, billing_entity_id)` pairs only; each pair is then handled inside
  `withSchool()`.
- Backoff: 1 min, 5 min, 30 min, 2 h, 6 h, then every 12 h, at most 10
  attempts; a rejected invoice is visible to management.
- The VAT-inclusive total returned by the tool must equal ours, or the invoice
  is rejected.
  Each line goes with its VAT-inclusive, excl. and VAT amounts exactly as
  stored on `invoice_line` (a tool computing VAT line by line may differ by a
  cent per line).
- **Tool selection criterion**: the tool must accept VAT-inclusive line prices
  (#303).
- Payment e-reporting (`recordPayment`) stays off (`PAYMENT_E_REPORTING`) until
  the accountant confirms it applies to the school's B2C sales (#303).

## Alternatives considered

- **pg-boss now**: one more moving part for a single job kind. Deferred until
  at least three job kinds exist or the host offers no scheduler; it can
  replace the sweep later without changing the outbox.
- **Synchronous sending in the server action**: a tool outage would block the
  enrollment desk. Rejected.

## Consequences

- A fake tool and contract tests come before the real tool; the fake numbers
  its invoices « TEST-… », is refused unless `INVOICING_FAKE_ALLOWED=1`, and the
  interface shows « Mode simulation ».
- `JOBS_SECRET` and `INVOICING_FAKE_ALLOWED` go into `.env.example` with the
  step that uses them.
- `CLAUDE.md` §6 and §7: pg-boss is deferred, one connector per entity.

## Implementation notes (#304)

- The sweep route is `POST /api/taches/factures`; `invoicing_due_work()` (migration 0056)
  only returns pairs whose business has an active connector. A business whose connector cannot be
  built (fake tool refused, unreadable credentials, tool not available yet) is skipped without
  counting an attempt.
- A run claims one invoice at a time in a short transaction and calls the tool outside any
  transaction; every later write names the claim (`claimed_until`), so a run whose claim ran out
  records nothing.
- Retried: timeout, network, 5xx, refused credentials, and this software's own errors; anything
  else rejects at once. A `tool_draft` tried again first reads its status in the tool (an answer
  lost after the issue is recorded, not issued twice); one the tool no longer knows is created
  again (the fake tool's memory after a restart).
- A total mismatch on an issued document (after `finalize`, or read with `readStatus` after a lost
  answer) records the invoice as issued with the tool's number and total
  (`tool_total_incl_tax_cents`), flagged for a credit note; it is listed for management with the
  rejected ones. A rejection keeps the tool's reference whenever the tool returned a document.
- `invoicing_due_work()` lets any `app_user` session list the (school, business) id pairs with
  due invoices across schools: ids only, a deliberate and narrow exception to tenant isolation.
- The outbox writes nothing on an issued invoice: the issuing statement writes everything at once,
  so the immutability trigger of #302 is unchanged.
- A draft attempted once is never drafted again (the tool may hold it). A `cancelled` invoice, or
  one `rejected` before the tool held any document of it, gives its lines back to the next
  drafting; one rejected while the tool holds a draft keeps them (`billsItsLines`).
- Nothing is sent while #176 Q1 (when yearly packages and lesson packs are due) is open: a draft
  goes only once its installments add up to its total (`isSendable`).
