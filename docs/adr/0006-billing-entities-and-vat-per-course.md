# 0006. Invoice through billing entities inside a school, VAT per course

- Status: Accepted (design approved by the owner on 2026-10-29)
- Date: 2026-10-29
- Issue: #298 (answers #288 and #289; epic #6)
- Supersedes: [0002](0002-invoicing-delegated-to-the-school-tool.md)

## Context

The founding school is two sole-trader businesses under one brand. Each has
its own SIRET, its own enrollments, invoices, cashing and bank account; a
student taking courses of both gets two invoices. Lessons are exempt from VAT
(CGI art. 261, 4, 4° b), except, in one business, the courses of some teachers
at 20 %; grid prices are VAT-inclusive. Go-live is June 2027, e-invoicing is
mandatory on 1 September 2027, and the invoicing tool is not chosen yet
(possibly one per business).

Until now `school` carried a single SIREN, VAT regime and VAT mention, the
invoicing connector was keyed by school, and invoices, payments and deposits
had no issuer.

## Decision

- **Delegation unchanged** (from 0002): the software is not an approved
  platform; it never generates an invoice number (it stores the one the tool
  returns), never modifies an issued invoice (a credit note corrects it), and
  stores tool credentials encrypted.
- A school has **one or more billing entities** (`billing_entity`, UI
  « Entreprise »), **exactly one by default** (partial unique index). A school
  with a single entity sees no entity control anywhere but « Paramètres ›
  Entreprises ».
- The entity is **not a tenant**: Row Level Security stays per school (the
  front desk is shared). Consistency comes from **composite foreign keys**
  `(school_id, x_id, billing_entity_id)` on invoice, installment, payment
  (including `corrects_id`), payment allocation, bank deposit and deposit line,
  then enrollment course (#299) and invoice line (#318): the database refuses
  an allocation, a deposit line, a reverse entry, a credit note, a package or
  an invoice line that mixes two entities.
- Legal name, SIREN, SIRET, VAT number, address, VAT regime, invoice-level VAT
  mention and the bank account label (never an IBAN) live on the entity; the
  school keeps its name, slug and time zone.
- One invoicing connector per entity (`invoicing_connector` keyed by
  `billing_entity_id`); see ADR 0007.
- Invoice numbers are **unique per entity**, not per school.
- The entity is set **on the course** (next step, #299), not on the
  discipline, tariff or site; an enrollment never spans two entities.
- A **VAT treatment per course** (`vat_treatment`, #301) is copied onto
  invoice lines when drafted; prices are VAT-inclusive, VAT is computed per
  treatment group (`vatOfInclusive`, rounding half away from zero) and spread
  over lines (`allocate`); a package mixing treatments is split by the
  standalone grid price of its courses.

## Alternatives considered

- **One school per business**: two sign-ins for the same desk, people entered
  twice, no siblings discount across businesses. Rejected.
- **Entity on the discipline or the site**: fails as soon as a discipline or a
  room is shared by both businesses. Rejected.
- **Entity as an RLS tenant**: the front desk serves both businesses at the
  same counter. Rejected.
- **A `vat_exempt` value in `vat_regime`**: exemption applies to operations,
  not to a business, and the enum is shared with instructors. Rejected.
- **Packages spanning two entities, split by a key**: possible later if the
  school asks for it; not needed now.

## Consequences

- Payments, deposits, the payment log, the CSV export and balances become per
  entity (#300); until then every payment and deposit is recorded for the
  school's default entity, and a deposit slip refuses payments of two
  entities.
- The migration backfilling `payment.billing_entity_id` touches immutable
  rows: it disables the `payment_immutable` trigger for that single statement
  inside the migration transaction and enables it again (precedent 0037); it
  must run as a role that bypasses RLS (#279).
- New schools get their default entity explicitly (seed, setup script, test
  fixtures): there is no trigger on `school`.
- Connector and invoice sending: ADR 0007. `CLAUDE.md` §3, §4, §5, §7 and §8
  follow this record.
