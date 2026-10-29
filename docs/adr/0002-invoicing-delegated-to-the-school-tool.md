# 0002. Delegate invoicing to the school's invoicing tool

- Status: Superseded by [0006](0006-billing-entities-and-vat-per-course.md)
- Date: 2026-10-22 (records a decision taken at project start)
- Issue: #111

## Context

French e-invoicing: receiving is mandatory since 1 September 2026; issuing and
e-reporting become mandatory for SMEs on 1 September 2027. Only approved
platforms may exchange e-invoices. Sales to families are B2C (e-reporting);
instructors invoice the school in B2B. The school's VAT regime and its tool
(Pennylane, Abby or Shine) await the accountant's opinion.

## Decision

- The software is **not** an approved platform: it prepares invoices and
  credit notes and sends them to the school's invoicing tool through a
  connector with one interface (`creerClient`/`createCustomer`,
  `creerFacture`/`createInvoice`, `finaliser`/`finalize`,
  `creerAvoir`/`createCreditNote`, `lireStatut`/`readStatus`).
- It never generates an invoice number: it stores the number returned by the tool.
- An issued invoice is never modified: a credit note corrects it.
- VAT regime and mentions are school configuration (`school.vat_regime`,
  `school.vat_mention`), never code.
- Tool credentials are stored encrypted.

## Alternatives considered

- **Becoming an approved platform**: certification cost and liability far
  beyond a single-developer product; rejected.
- **Generating numbered PDF invoices ourselves**: not compliant with e-invoicing
  from 2027; rejected.

## Consequences

- The rest of the code never knows which tool is used.
- Connector calls need timeouts, bounded retries and idempotent webhooks.
- The connector is built once the tool is confirmed (roadmap item 7).
