# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Front desk (`front_desk`)**: enrolls students, takes payments, answers families during enrollment desk hours, on a Windows PC in a browser, often while a parent waits at the desk. Fast typing, keyboard first.
- **Management (`director`)**: everything the front desk does, plus the schedule (sites, rooms, seasons, closures, courses), tariffs, instructors, the team and the school settings.
- **Instructors (`teacher`)**: limited access in V1 (their calendar link). Mobile attendance is out of V1.

No family-facing space in V1 (online enrollment and payment are out of scope).

## Product Purpose

Run a dance school day to day: people (students, guardians, payers), enrollments and packages, the schedule and its lessons, invoices, installments, payments and bank deposits, and the monthly statements owed to instructors.

The first customer is École de danse Ribas (Villeurbanne, France, 2 sites, 3 rooms, 8 instructors). Go-live target: summer 2027, for the autumn enrollments.

Success, as confirmed by the owner:

- a complete enrollment (student, courses, package, payment) takes under 3 minutes at the desk;
- no double entry: no spreadsheet kept on the side for the schedule, payments or instructor statements;
- a new front-desk person uses it on day one without training;
- a second school can start without any specific development.

## Positioning

- **Fast entry at the front desk**: keyboard, few clicks, dense lists that work like Excel autofilters.
- **Packages priced by cumulative weekly duration** of the chosen courses, with discounts (siblings, two disciplines) computed by the tariff engine.
- **E-invoicing compliant for 2027 by delegation**: invoices are issued and numbered by the school's own invoicing tool (Pennylane, Abby, Shine); this software never numbers an invoice.
- **People and relationships, not "families"**: students, legal guardians, partners and payers (parents, companies, works councils) are linked freely; « Facturé à » can be anyone.

## Operating Context

- Enrollment desk hours at the start of the season are the peak: queues of parents, many enrollments in a row.
- Payments by cheque, cash, card, transfer, direct debit, ANCV holiday vouchers and Pass’Sport; cheques are grouped into bank deposits with a deposit slip.
- School calendar: school holidays (zone A for Ribas), closures by school, site or course, a gala in June.
- Instructors are sole traders (often VAT-exempt, art. 293 B du CGI) or employees; they are paid from the lessons actually taught.
- Data will be imported from the school's previous software.

## Capabilities and Constraints

- Multi-school SaaS: each school's data is isolated (row-level security). Anything school-specific (tariffs, discounts, sites, VAT mentions) is data, never code.
- Payments and the audit log are immutable; errors are fixed by reverse entries. Issued invoices are corrected by credit notes.
- Personal data of minors: never in logs; GDPR erasure path still open (#184).
- Interface in French; code and documentation in English.
- Undecided: the product name (working title « Gestion d’école de danse »); the school's VAT regime and invoicing tool (pending the accountant); several business rules tracked as `blocked` issues.

## Brand Commitments

- No product name yet. The tab title is « Gestion d’école de danse ».
- Voice: plain words of the school (« élève », « contact », « Facturé à », « à prévenir »), direct and active, typographic apostrophe (’) and « » quotes. Details in DESIGN.md.
- Same theme for every school in V1 (decided 2026-10-28): no per-school colours.

## Evidence on Hand

- Demo data is fictitious (`npm run db:seed`). The repository is public: no real personal data, customer quotes or screenshots of real people may be used.
- No testimonials, pricing or customer list exist yet; do not invent them.

## Product Principles

1. The front desk never waits on the software: speed and keyboard flow beat looks.
2. Obvious without training: the school's words, one clear primary action, an empty screen says what to do next.
3. Never lose or silently change money or personal data: immutable records, explicit confirmations, French error messages that say how to fix.
4. Replicable by configuration: a rule specific to one school is data, and an unclear rule is asked, never invented.

## Accessibility & Inclusion

WCAG 2.2 AA: visible labels, keyboard for every action, visible focus, contrast AA in light and dark mode, information never carried by colour alone, 44 px touch targets on phones.
