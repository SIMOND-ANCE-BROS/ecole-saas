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
