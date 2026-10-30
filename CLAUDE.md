@AGENTS.md

# CLAUDE.md – Dance school management (SaaS)

Reference for every agent working on this project. Read it in full before coding. When a business rule is unclear, **ask** rather than invent.

## 1. The project

- SaaS for dance schools: students and related people (guardians, payers), enrollments, schedule, invoicing, payments, instructor pay.
- First customer ("founding customer"): École de danse Ribas, Villeurbanne (France). Target go-live: **June 2027**: enrollments for the next season restart right after the June gala.
- The product must be **replicable for other schools**: anything specific to Ribas is data, never code.
- V1 users: management (`director`) and front desk (`front_desk`), on a Windows PC, in a browser. Heavy use during enrollment desk hours: **fast data entry** beats looks.
- Single developer (Gabin Simond), AI-driven development.

## 2. Languages

| What                                                                   | Language                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------- |
| Identifiers, files, database (tables, columns, enums), comments, tests | **English**                                           |
| Commits, PR titles and descriptions, issues, ADRs, developer docs      | **English**                                           |
| Everything an end user sees: screens, messages, e-mails, PDFs, exports | **French**, typographic apostrophe (’) and « » quotes |
| PR section « Pour l’accueil et la direction »                          | **French**, written for the school                    |
| URLs (Next route folders such as `src/app/(espace)/eleves`)            | **French**: they are user-visible                     |

The database (`0027_english_names`, enum values in `0028`–`0031`), file names, TypeScript identifiers, code comments and test titles are in English (#114). Still French until a data migration (#114): keys stored in the database, namely the discount code `fratrie` and audit-log JSON keys such as `montant_centimes` (old audit rows are immutable). Environment variables `CLE_CHIFFREMENT` and `IP_CLIENT_EN_TETE` keep their names until deployments are updated. Some keys stay French on purpose because they are data, not code: list column ids, URL parameters and their values (`?enregistre=cree`), route folders. Never translate one of them on one side only. New code is written in English, using the lexicon below.

## 3. Domain lexicon (French → English)

Use these names in code and database. User-facing text keeps the French word.

| French (UI)                                                                                     | English (code)                                                                        | Meaning                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| école                                                                                           | `school`                                                                              | The tenant. All data belongs to it.                                                                                                                                                  |
| entreprise                                                                                      | `billing_entity`                                                                      | A business of the school that invoices, cashes and deposits (own SIREN, VAT, bank account, invoicing tool). One or more per school, exactly one by default; not a tenant (ADR 0006). |
| traitement de TVA                                                                               | `vat_treatment`                                                                       | How VAT applies to a course or lesson pack (standard rate, exempt, not subject), with its mention; copied onto invoice lines (#301).                                                 |
| exonération (de TVA)                                                                            | `exempt`                                                                              | A `vat_treatment` category: no VAT on the operation (e.g. CGI art. 261, 4, 4° b), with a mention. Not a `vat_regime`.                                                                |
| membre (direction, accueil, professeur)                                                         | `member` (`director`, `front_desk`, `teacher`)                                        | A user account inside a school, with a role.                                                                                                                                         |
| personne                                                                                        | `person`                                                                              | Anyone: student, guardian, payer, organisation.                                                                                                                                      |
| élève / danseur                                                                                 | `student` (`person.is_student`)                                                       | Takes classes. Often a minor.                                                                                                                                                        |
| payeur                                                                                          | `payer`                                                                               | Receives the invoice: parent, company, works council (CSE). Distinct from the student.                                                                                               |
| lien (représentant légal, conjoint, autre)                                                      | `relationship` (`legal_guardian`, `partner`, `other`)                                 | Link between two people; flags `pays_for`, `emergency_contact`.                                                                                                                      |
| fratrie                                                                                         | `siblings`                                                                            | Students of the same payer.                                                                                                                                                          |
| site, salle                                                                                     | `site`, `room`                                                                        | Premises and rooms.                                                                                                                                                                  |
| saison                                                                                          | `season`                                                                              | A school year.                                                                                                                                                                       |
| fermeture                                                                                       | `closure`                                                                             | Holidays and days off.                                                                                                                                                               |
| fermeture : toute l’école, certains sites, certains cours                                       | `closure_scope` (`school`, `sites`, `courses`)                                        | What a closure covers (#200); sites in `closure_site`, courses in `closure_course`.                                                                                                  |
| public d’un cours (enfants et ados, adultes, à décider)                                         | `CourseAudience` (`children`, `adults`, `undecided`)                                  | Read from a group course’s age range (under 18 / from 18 / other) to tick courses for a closure (#295); never stored.                                                                |
| intervenant                                                                                     | `instructor`                                                                          | Teacher. Invoices the school (sole trader, company) or is an employee.                                                                                                               |
| discipline                                                                                      | `discipline`                                                                          | Jazz, classical…                                                                                                                                                                     |
| cours                                                                                           | `course`                                                                              | Recurring slot (day, time, length, room, instructor, recurrence). `class` is a reserved word.                                                                                        |
| séance                                                                                          | `lesson`                                                                              | Dated occurrence of a course: attendance, lesson packs, instructor pay. Moved alone, it keeps its original date (`planned_date`) and may have its own time.                          |
| séance retirée par une fermeture (gardée de côté)                                               | `suspended_lesson`                                                                    | What a lesson removed by a closure had of its own (substitute, time, new date), given back when the closure is removed (#206).                                                       |
| titulaire (d’une séance donnée)                                                                 | `regular_instructor_id` (`lesson`)                                                    | The course's main instructor when a lesson was given, stamped with its time and length when the course changes hands or slot; statements pay the lesson on them (#310).              |
| envoi (d’un formulaire de création)                                                             | `submission`                                                                          | One creating submission (payment, enrollment, course…) keyed by an id the form generates once: a retry after a lost response returns the first result instead of a duplicate (#260). |
| présence                                                                                        | `attendance`                                                                          |                                                                                                                                                                                      |
| document (certificat médical, autorisation parentale, droit à l’image)                          | `student_document` (`medical_certificate`, `parental_consent`, `image_rights`)        | A paper handed in (#287): one row per student and type; `received_on`, `dated_on` (validity runs from it), `valid_until`; no file yet (#184).                                        |
| document demandé, délai pour le fournir                                                         | `document_requirement`, `due_within_days`                                             | What the school asks for, of whom, how long it stays valid and how many days after the enrollment it is due (#287); a type without a row follows `DEFAULT_REQUIREMENTS`.             |
| certificat médical exigé des adultes (discipline)                                               | `discipline.adults_need_certificate`                                                  | Adults enrolled in the discipline bring a medical certificate (#306); minors and competitors always do. On by default.                                                               |
| inscription                                                                                     | `enrollment`                                                                          | A package subscribed by a payer for a season; one or two students (couple rate).                                                                                                     |
| statut d’inscription (inscrit, à l’essai, en attente, abandon, terminé)                         | `active`, `trial`, `waitlist`, `dropped`, `ended`                                     |                                                                                                                                                                                      |
| confirmer, date d’abandon, annuler une inscription (erreur de saisie)                           | `confirmEnrollment`, `dropped_on`, `cancelEnrollment`                                 | Lifecycle (#284): trial or waitlist → active; a drop-out keeps the enrollment with its date; a cancellation removes a mistake (never once invoiced).                                 |
| forfait                                                                                         | `package`                                                                             | Price set by the **cumulative weekly duration** of the chosen courses, not per course.                                                                                               |
| tarif                                                                                           | `tariff`                                                                              | A price rule (audience, period, weekly duration).                                                                                                                                    |
| réduction                                                                                       | `discount`                                                                            | Siblings, two disciplines…                                                                                                                                                           |
| prix saisi (à la main), motif du prix                                                           | `manual_price_cents`, `price_reason`                                                  | A price typed by the front desk on an enrollment instead of the computed one, with a required reason; the final price (#292).                                                        |
| carnet                                                                                          | `lesson_pack`                                                                         | Pack of private lessons (1, 5 or 10 lessons, 1 to 4 people).                                                                                                                         |
| élèves d’un carnet, décompte d’une séance                                                       | `lesson_pack_person`, `lesson_pack_usage`                                             | Students named on a pack (their private lessons can use it, #286); one lesson counted on a pack.                                                                                     |
| facture, ligne de facture                                                                       | `invoice`, `invoice_line`                                                             |                                                                                                                                                                                      |
| avoir                                                                                           | `credit_note`                                                                         | Negative invoice cancelling all or part of an issued invoice.                                                                                                                        |
| échéance                                                                                        | `installment`                                                                         | Part of an invoice payable on a date.                                                                                                                                                |
| paiement, encaissement                                                                          | `payment`                                                                             | Immutable.                                                                                                                                                                           |
| écriture inverse : correction, paiement rejeté                                                  | `reversal_kind` (`correction`, `rejection`)                                           | Kind of a negative payment cancelling another (`corrects_id`), stored instead of a French label (#272); it keeps the original's reference (cheque number).                           |
| paiement rejeté, chèque rejeté                                                                  | `rejection` (`reversal_kind = 'rejection'`)                                           | Reverse entry of a payment already in a bank deposit, dated the day the bank returned it; management only; the deposit slip is unchanged (#253).                                     |
| moyen de paiement (chèque, espèces, carte, virement, prélèvement, chèques vacances, Pass’Sport) | `cheque`, `cash`, `card`, `transfer`, `direct_debit`, `holiday_voucher`, `pass_sport` |                                                                                                                                                                                      |
| remise en banque, bordereau                                                                     | `bank_deposit`, `deposit_slip`                                                        |                                                                                                                                                                                      |
| affectation d’un paiement                                                                       | `payment_allocation`                                                                  |                                                                                                                                                                                      |
| relevé (de l’intervenant)                                                                       | `instructor_statement`                                                                | Monthly amount owed to an instructor from the lessons taught.                                                                                                                        |
| journal                                                                                         | `audit_log`                                                                           | Immutable.                                                                                                                                                                           |
| outil de facturation                                                                            | `invoicing_tool` (`pennylane`, `abby`, `shine`)                                       | Issues and numbers invoices, does e-reporting.                                                                                                                                       |
| connecteur de facturation                                                                       | `invoicing_connector`                                                                 |                                                                                                                                                                                      |
| régime de TVA (franchise 293 B, assujetti, non applicable)                                      | `vat_regime` (`franchise_293b`, `vat_registered`, `not_applicable`)                   |                                                                                                                                                                                      |
| montant en centimes, taux en points de base                                                     | `*_cents`, `*_bps`                                                                    |                                                                                                                                                                                      |
| indisponibilité, connexion agenda                                                               | `unavailability`, `calendar_connection`                                               |                                                                                                                                                                                      |
| préférence de liste                                                                             | `list_preference`                                                                     |                                                                                                                                                                                      |
| registre des entreprises, SIREN, SIRET, entreprise fermée                                       | `business_registry`, `siren`, `siret`, `ceased`                                       | The State's public company registry (« Recherche d’entreprises »), searched to fill organisations and instructors (#207).                                                            |

Names before the rename (#114), for reading old issues and PRs: `avecEcole()` → `withSchool()`, `ecolesDe()` → `schoolsOf()`, `contexteEcole()` → `schoolContext()`, `exigerRole()` → `requireRole()`, `memeEcole()` → `sameSchool()`, RLS policy `isolation_ecole` → `school_isolation`, `src/lib/montant.ts` → `src/lib/money.ts`, `src/domaine/` → `src/domain/`, `src/connecteurs/` → `src/connectors/`.

A missing term is added here in the same PR that introduces it.

## 4. Known business rules (Ribas, to be configured)

- Quarterly or yearly packages by cumulative weekly duration (45 min, 1 h, 1 h 30 and combinations up to 3 courses); child, adult, couple and student grids; drop-in lessons.
- **Siblings discount −10 %** from two children of the same payer, **not cumulative** with the two-disciplines package.
- 2 sites, 3 rooms: Docteur Rollet (2 rooms, group classes, enrollment desk), Bons Amis (1 room, competition and private lessons).
- 8 instructors, including the two owners.
- The school is **two sole-trader businesses** under one brand (the two owners): each has its own SIRET, enrollments, invoices, cashing and bank account; a student taking courses of both gets two invoices (#288). Lessons are exempt from VAT (CGI art. 261, 4, 4° b), except, in one business, the courses of some teachers at 20 %; grid prices are VAT-inclusive (#289). Wording and regime await the accountant: never assume « 293 B ».
- Calendar: school holidays zone A, gala in June.
- Payment methods (#293): cheque, ANCV holiday vouchers on paper and ANCV Connect, cash, transfer (full amount), card probably from the 2027 season; no direct debit, no Pass’Sport.

These values live in data (`billing_entity`, `tariff`, `discount`, `site`, `room`, `instructor`, `closure` tables). **Never hard-coded.**

## 5. E-invoicing (legal context, France)

- Receiving e-invoices is mandatory since 1 September 2026; issuing and e-reporting become mandatory for SMEs on **1 September 2027**.
- Sales to families (B2C) go through **e-reporting**; instructors' invoices to the school are electronic **B2B**.
- This software is not an approved platform: it **delegates** to the invoicing tool of each billing entity (ADR 0006, superseding ADR 0002; sending: ADR 0007).
- In code:
  - The software **never generates an invoice number**: it stores the one returned by the tool; numbers are unique per billing entity.
  - An issued invoice is never modified: issue a **credit note**.
  - VAT mentions are data: the invoice-level mention and regime come from the billing entity (`billing_entity.vat_regime`, `billing_entity.vat_mention`), the line-level category, rate and mention come from the VAT treatment of the course or lesson pack (`vat_treatment`, #301), copied onto the invoice line. Prices are VAT-inclusive: VAT is taken out once per treatment (`vatOfInclusive` in `src/lib/money.ts`, half a cent away from zero) and spread over the lines (`allocate`, `vatBreakdown` in `src/domain/billing/vat.ts`).
- Each business's VAT regime and its tool are **pending the accountant's opinion**: keep them configurable.

## 6. Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · PostgreSQL 16 · Drizzle ORM · Zod · Mantine 8 · Tailwind 4 (layout only) · Vitest · Better Auth. Coming: Playwright. Background work (invoice sending) uses an outbox on the invoice rows with `after()` and a sweep route; pg-boss is deferred until at least three job kinds exist (ADR 0007).

```bash
npm run dev               # local server
npm test                  # Vitest unit tests
npm run test:integration  # tests against the local database (incl. the RLS guard)
npm run typecheck         # next typegen + tsc --noEmit
npm run lint              # ESLint
npm run db:up             # local PostgreSQL (Docker, port 5433)
npm run db:generate       # new migration after a schema change
npm run db:migrate        # apply migrations
npm run db:seed           # local demo data
npm run format            # Prettier (format:check in CI)
npm run preflight         # exactly what CI blocks on, PASS/FAIL per step
```

Git hooks are versioned in `.githooks/` and enabled by `npm install` (`prepare` → `core.hooksPath`): pre-commit runs gitleaks on the staged changes then lint-staged (ESLint + Prettier); pre-push runs the typecheck and the unit tests related to the changes (`PRE_PUSH_FULL=1` for all). A false positive of gitleaks goes into `.gitleaksignore` by fingerprint, never as an allowlist.

## 7. Code organisation

```
src/
  app/                       Next routes (pages, server actions) – thin, no business logic; folder names are French URLs
  db/schema.ts               data model (source of truth)
  db/index.ts                connection + withSchool() / schoolsOf()
  domain/<module>/           PURE business logic + tests
  connectors/                one folder per external service (calendar, business registry; invoicing to come): common interface + one implementation per tool
  jobs/                      background work, to come (invoicing outbox and sweep, ADR 0007; pg-boss deferred)
  lib/                       cross-cutting utilities (money.ts…)
migrations/                  drizzle-kit migrations + custom SQL migrations (RLS)
docs/adr/                    architecture decision records
DESIGN.md                    interface rules
```

- Business logic lives in the domain folder as **pure functions** (input → output, no database, no network), unit-tested. Routes and server actions only validate, call the domain and persist.
- The invoicing connector (to come, #303) exposes one interface (`checkCredentials`, `createCustomer`, `createInvoice`, `finalize`, `createCreditNote`, `readStatus`), with **one connector per billing entity** (`invoicing_connector` keyed by `billing_entity_id`, ADR 0007); the rest of the code never knows the concrete tool.
- Naming: `camelCase` for variables and functions, `PascalCase` for types and React components, `SCREAMING_SNAKE_CASE` for module constants, `snake_case` in the database, `kebab-case` file names.

## 8. Mandatory rules

**Multi-school and security** (ADR 0001)

- Every business query goes through `withSchool(schoolId, tx => …)`. Never use `db` directly for business data.
- Every new business table carries `school_id` **and** gets, in a SQL migration, `ENABLE` + `FORCE ROW LEVEL SECURITY` and the `school_isolation` policy (model in `migrations/0001_rls.sql`, which only covers tables existing when it was written).
- `app_user` privileges on new tables and sequences are granted automatically (default privileges, `migrations/0006_droits_par_defaut.sql`, guard `src/db/privileges.integration.test.ts`); RLS still has to be added every time.
- Every reference between two business tables is a composite foreign key `(school_id, x_id)`: `sameSchool(t, column, target)` in `src/db/schema.ts`, the target declaring `sameSchoolTarget(t)`. Never a plain `.references()` between business tables: foreign-key checks ignore RLS. Guard: `src/db/foreign-keys.integration.test.ts`.
- Between two billing tables of the same entity (invoice, installment, payment, payment allocation, bank deposit and its lines; enrollment course to its enrollment and its course, #299; invoice line to its invoice, enrollment and lesson pack, #318), the key also carries the entity: `(school_id, x_id, billing_entity_id)` through `sameEntity(t, column, target)`, the target declaring `sameEntityTarget(t)` (ADR 0006). The database then refuses whatever mixes two billing entities.
- The `app_admin` role (BYPASSRLS) is for administration scripts only, never application code.
- `schoolId` always comes from the server-side session, never from a browser parameter.
- Every protected page and server action calls `schoolContext()` or `requireRole()` (`src/lib/session.ts`), then `withSchool(schoolId, …)`. Never access control in a layout (not re-run on navigation) nor in `proxy.ts` (optimistic redirect only).

**Money and dates**

- Amounts in **integer cents** (`*_cents` columns, `*Cents` in TypeScript), rates in **basis points** (1000 = 10 %). Use `src/lib/money.ts`. No floating-point number for money, no `parseFloat` on an amount.
- Dates without time (`date`) are `YYYY-MM-DD` strings; `Europe/Paris` time zone for any day computation.

**Data**

- Payments and the audit log are **immutable** (database triggers): an error is fixed by a reverse entry.
- Never edit an applied migration: create a new one. Renaming a table or column is a new migration too.
- Validate every external input (forms, API, webhooks) with Zod.
- Server actions return `{ ok: true, … } | { ok: false, message }`, `message` being French text for the user; never throw an error message at the user.

**Personal data (minors)**

- Never write personal data to logs (names, phone numbers, health); log technical ids only.
- Invoicing tool credentials are stored encrypted (`invoicing_connector.encrypted_credentials`), never in clear, never in the repository.
- No secret in code: environment variables, and `.env.example` kept up to date.
- The repository is public (issues, PRs, commits and their history): fictitious data only, no secret names.

**External services** (invoicing tools, calendars)

- Every call has a timeout, a bounded number of retries and a structured error; webhooks are idempotent.

**TypeScript**

- `strict` mode plus `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`; no `any` (ESLint error), no non-null assertion without a comment saying why it holds.
- Every string key is checked by the compiler (#138): list cells and SQL expressions keyed by the column ids (`ColumnDef<Id>`, `TableRow<Id>`, `ColumnId<…>`); form errors through `errorsOf<T>()` / `FieldErrors<T>` and custom Zod paths through `issuePath(schema, …)` (`src/lib/form-errors.ts`); FormData names through one `formFields()` shared by the form and its action (`src/lib/form-fields.ts`); `has(value, "key")` instead of `"key" in value` (`src/lib/has.ts`, lint rule); framework config objects with `satisfies` (`ProxyConfig`).
- Drizzle payloads of `insert().values()`, `update().set()` and `onConflictDoUpdate({ set })` are a literal without spread, or go through `columnsOf(table, …)` / `rowsOf(table, […])` (`src/db/columns-of.ts`, lint rule), since Drizzle silently drops an unknown key of a spread or built object (#134).

**CI** (`.github/workflows/`)

- Read-only token by default, actions pinned by commit SHA, `persist-credentials: false`, a timeout on every job, stale runs cancelled.
- `ci-success` aggregates the required jobs (format, lint, typecheck, tests, integration, `next build`, `npm audit` on runtime dependencies, gitleaks secret scan); `PR conventions` checks the branch prefix and the conventional-commit PR title.
- Dependabot proposes updates after a 14-day cooldown; `CODEOWNERS` covers sensitive paths only.

## 9. Tests

- Every domain function has Vitest tests, written **before or with** the code. Top priority: tariff engine, discounts, installment plans, instructor statements.
- Cover real edge cases: three siblings, couple + discount, dropping out mid-term, instructor replacement, cents left over from a split.
- Security behaviour (RLS, immutability) is tested against a real PostgreSQL database, never mocks.
- Guard in place: `src/db/rls.integration.test.ts` fails if a table carrying `school_id` lacks forced RLS with the `school_isolation` policy. Files `*.integration.test.ts` run with `npm run test:integration` and in CI.
- A test must be able to fail: assert the behaviour, not the implementation; no snapshot of a whole page.

## 10. Way of working

- Every piece of work starts from an issue and goes through a branch and a PR, never a direct commit on `main`; no merge without explicit approval. Conventions: `docs/guides/issues.md`, summarised in `AGENTS.md`.
- **Conventional commits** in English, imperative: `feat(enrollment): compute the siblings discount`, `fix(lists): keep the sort when searching`. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `security`. The squash-merged PR title follows the same format.
- **Ask before** adding a dependency. Exact pinned versions, published at least 14 days ago. No dependency for what fits in a few lines.
  - **Security exception**: a release fixing a high or critical advisory that affects us may be installed before 14 days, after reading the advisory and the changelog, with the owner's approval, in a dedicated `fix/` PR that cites the advisory (first case: Next.js 16.4.2, #126).
- Do not modify `migrations/0001_rls.sql`, the immutability triggers or `withSchool()` without saying so explicitly.
- When an architecture decision changes, update this file and add an ADR (`docs/adr/`) in the same PR.

**Definition of done** (before asking for a merge)

1. `npm run lint`, `npm run typecheck`, `npm test` pass, and `npm run test:integration` when the database is involved.
2. A user-visible change is checked in the browser on desktop, phone width and dark mode, with a screenshot in the PR.
3. `test-verifier`, then `code-reviewer` (and `security-reviewer`, `migration-reviewer`, `billing-reviewer`, `ux-reviewer` when their area is touched) report no blocking finding.
4. The PR fills « Pour l’accueil et la direction » in French, or writes « Rien ».

## 11. Interface

Rules in `DESIGN.md`. In short:

- Built for the front-desk PC first: keyboard-friendly forms, instant person search, few clicks for an enrollment.
- Mantine components everywhere (ADR 0003); Tailwind only for layout. No custom control class: `.champ`, `.bouton-principal`… were removed in #115.
- Lists work like Excel autofilters: each column header sorts and filters; one search bar at the top (Ctrl K).
- Forms and course records: a real page, also opened as a **side panel** over the current page (intercepted route in `src/app/(espace)/@modal/(.)…`, component `Panel` in `_panel/panel.tsx`). The cancel button is `<Cancel href=…>` (back navigation inside a panel).
- Accessible: labels on every field, sufficient contrast, dark mode.

## 12. What not to do

- Don't query business data with `db` outside `withSchool()`; don't use `app_admin` in application code.
- Don't take `schoolId` (or any tenant id) from the browser.
- Don't put access control in a layout or in `proxy.ts`.
- Don't hard-code a price, discount, VAT mention or anything school-specific.
- Don't generate an invoice number; don't update an issued invoice, a payment or the audit log.
- Don't use floating-point numbers for money.
- Don't key cells, form errors, FormData fields or `in` checks with a bare string the compiler cannot check (#138).
- Don't spread or pass a built object into a Drizzle `values()` / `set()` without `columnsOf()` / `rowsOf()` (#134).
- Don't log personal data; don't put real personal data in issues, PRs, tests or seeds.
- Don't edit an applied migration.
- Don't skip git hooks (`--no-verify`) or CI checks.
- Don't add a dependency without asking.
- Don't decide an open business rule by default: open a `blocked` issue with the question.
- Don't merge without explicit approval.

## 13. Agents (`.claude/agents/`)

Delegate with the Agent tool: each agent carries its area's rules and keeps noise out of the main context. Reviewers and the architect are read-only.

| Request looks like…                                                      | Delegate to          |
| ------------------------------------------------------------------------ | -------------------- |
| Run the tests / verify this change                                       | `test-verifier`      |
| Review my diff before push                                               | `code-reviewer`      |
| Diff touches auth, session, RLS, personal data, secrets, workflows       | `security-reviewer`  |
| Diff touches `src/db/schema.ts` or `migrations/`                         | `migration-reviewer` |
| Diff touches amounts, tariffs, discounts, invoices, payments, statements | `billing-reviewer`   |
| Diff changes a screen                                                    | `ux-reviewer`        |
| A business rule is unclear, or a feature depends on one                  | `business-rules`     |
| Structural choice, "should we…"                                          | `architect`          |
| What to build, scoping, user stories                                     | `product-owner`      |
| Backlog, status report, GitHub issues and Project                        | `project-manager`    |

Default pipeline for a substantial change: implement → `test-verifier` → `code-reviewer` + the matching specialised reviewers in parallel → push → PR.

## 14. V1 roadmap

1. [ ] Tariff engine and discounts
2. [ ] Authentication, members and roles (director, front desk, teacher)
3. [ ] People, students, documents
4. [ ] Sites, rooms, seasons, closures, courses; lesson generation
5. [ ] Enrollments (with the tariff engine), lesson packs
6. [ ] Invoices, installment plans, credit notes, payments, certificates
7. [ ] Invoicing connector (tool to be confirmed) + sync jobs
8. [ ] Instructor statements
9. [ ] Dashboard and accounting export
10. [ ] Data import from the previous software

Out of V1: family online space, online enrollment and payment, instructor mobile access.
