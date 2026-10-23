@AGENTS.md

# CLAUDE.md – Dance school management (SaaS)

Reference for every agent working on this project. Read it in full before coding. When a business rule is unclear, **ask** rather than invent.

## 1. The project

- SaaS for dance schools: students and related people (guardians, payers), enrollments, schedule, invoicing, payments, instructor pay.
- First customer ("founding customer"): École de danse Ribas, Villeurbanne (France). Target go-live: **summer 2027**, for the autumn enrollments.
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

The database (`0027_english_names`), TypeScript identifiers and file names are in English (#114). Still being translated (#114): code comments and database enum values. Some keys stay French on purpose because they are data, not code: list column ids, URL parameters and their values (`?enregistre=cree`), route folders. Never translate one of them on one side only. New code is written in English, using the lexicon below.

## 3. Domain lexicon (French → English)

Use these names in code and database. User-facing text keeps the French word.

| French (UI)                                                                                     | English (code)                                                                        | Meaning                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| école                                                                                           | `school`                                                                              | The tenant. All data belongs to it.                                                                                                                         |
| membre (direction, accueil, professeur)                                                         | `member` (`director`, `front_desk`, `teacher`)                                        | A user account inside a school, with a role.                                                                                                                |
| personne                                                                                        | `person`                                                                              | Anyone: student, guardian, payer, organisation.                                                                                                             |
| élève / danseur                                                                                 | `student` (`person.is_student`)                                                       | Takes classes. Often a minor.                                                                                                                               |
| payeur                                                                                          | `payer`                                                                               | Receives the invoice: parent, company, works council (CSE). Distinct from the student.                                                                      |
| lien (représentant légal, conjoint, autre)                                                      | `relationship` (`legal_guardian`, `partner`, `other`)                                 | Link between two people; flags `pays_for`, `emergency_contact`.                                                                                             |
| fratrie                                                                                         | `siblings`                                                                            | Students of the same payer.                                                                                                                                 |
| site, salle                                                                                     | `site`, `room`                                                                        | Premises and rooms.                                                                                                                                         |
| saison                                                                                          | `season`                                                                              | A school year.                                                                                                                                              |
| fermeture                                                                                       | `closure`                                                                             | Holidays and days off.                                                                                                                                      |
| intervenant                                                                                     | `instructor`                                                                          | Teacher. Invoices the school (sole trader, company) or is an employee.                                                                                      |
| discipline                                                                                      | `discipline`                                                                          | Jazz, classical…                                                                                                                                            |
| cours                                                                                           | `course`                                                                              | Recurring slot (day, time, length, room, instructor, recurrence). `class` is a reserved word.                                                               |
| séance                                                                                          | `lesson`                                                                              | Dated occurrence of a course: attendance, lesson packs, instructor pay. Moved alone, it keeps its original date (`planned_date`) and may have its own time. |
| présence                                                                                        | `attendance`                                                                          |                                                                                                                                                             |
| inscription                                                                                     | `enrollment`                                                                          | A package subscribed by a payer for a season; one or two students (couple rate).                                                                            |
| statut d’inscription (inscrit, à l’essai, en attente, abandon, terminé)                         | `active`, `trial`, `waitlist`, `dropped`, `ended`                                     |                                                                                                                                                             |
| forfait                                                                                         | `package`                                                                             | Price set by the **cumulative weekly duration** of the chosen courses, not per course.                                                                      |
| tarif                                                                                           | `tariff`                                                                              | A price rule (audience, period, weekly duration).                                                                                                           |
| réduction                                                                                       | `discount`                                                                            | Siblings, two disciplines…                                                                                                                                  |
| carnet                                                                                          | `lesson_pack`                                                                         | Pack of private lessons (1, 5 or 10 lessons, 1 to 4 people).                                                                                                |
| facture, ligne de facture                                                                       | `invoice`, `invoice_line`                                                             |                                                                                                                                                             |
| avoir                                                                                           | `credit_note`                                                                         | Negative invoice cancelling all or part of an issued invoice.                                                                                               |
| échéance                                                                                        | `installment`                                                                         | Part of an invoice payable on a date.                                                                                                                       |
| paiement, encaissement                                                                          | `payment`                                                                             | Immutable.                                                                                                                                                  |
| moyen de paiement (chèque, espèces, carte, virement, prélèvement, chèques vacances, Pass’Sport) | `cheque`, `cash`, `card`, `transfer`, `direct_debit`, `holiday_voucher`, `pass_sport` |                                                                                                                                                             |
| remise en banque, bordereau                                                                     | `bank_deposit`, `deposit_slip`                                                        |                                                                                                                                                             |
| affectation d’un paiement                                                                       | `payment_allocation`                                                                  |                                                                                                                                                             |
| relevé (de l’intervenant)                                                                       | `instructor_statement`                                                                | Monthly amount owed to an instructor from the lessons taught.                                                                                               |
| journal                                                                                         | `audit_log`                                                                           | Immutable.                                                                                                                                                  |
| outil de facturation                                                                            | `invoicing_tool` (`pennylane`, `abby`, `shine`)                                       | Issues and numbers invoices, does e-reporting.                                                                                                              |
| connecteur de facturation                                                                       | `invoicing_connector`                                                                 |                                                                                                                                                             |
| régime de TVA (franchise 293 B, assujetti, non applicable)                                      | `vat_regime` (`franchise_293b`, `vat_registered`, `not_applicable`)                   |                                                                                                                                                             |
| montant en centimes, taux en points de base                                                     | `*_cents`, `*_bps`                                                                    |                                                                                                                                                             |
| indisponibilité, connexion agenda                                                               | `unavailability`, `calendar_connection`                                               |                                                                                                                                                             |
| préférence de liste                                                                             | `list_preference`                                                                     |                                                                                                                                                             |

Names before the rename (#114), for reading old issues and PRs: `avecEcole()` → `withSchool()`, `ecolesDe()` → `schoolsOf()`, `contexteEcole()` → `schoolContext()`, `exigerRole()` → `requireRole()`, `memeEcole()` → `sameSchool()`, RLS policy `isolation_ecole` → `school_isolation`, `src/lib/montant.ts` → `src/lib/money.ts`, `src/domaine/` → `src/domain/`, `src/connecteurs/` → `src/connectors/`.

A missing term is added here in the same PR that introduces it.

## 4. Known business rules (Ribas, to be configured)

- Quarterly or yearly packages by cumulative weekly duration (45 min, 1 h, 1 h 30 and combinations up to 3 courses); child, adult, couple and student grids; drop-in lessons.
- **Siblings discount −10 %** from two children of the same payer, **not cumulative** with the two-disciplines package.
- 2 sites, 3 rooms: Docteur Rollet (2 rooms, group classes, enrollment desk), Bons Amis (1 room, competition and private lessons).
- 8 instructors, including the two owners (sole traders exempt from VAT, mention « TVA non applicable, art. 293 B du CGI »).
- Calendar: school holidays zone A, gala in June.
- Payment methods: cheque, cash, card, transfer, direct debit, ANCV holiday vouchers, Pass’Sport.

These values live in data (`tariff`, `discount`, `site`, `room`, `instructor`, `closure` tables). **Never hard-coded.**

## 5. E-invoicing (legal context, France)

- Receiving e-invoices is mandatory since 1 September 2026; issuing and e-reporting become mandatory for SMEs on **1 September 2027**.
- Sales to families (B2C) go through **e-reporting**; instructors' invoices to the school are electronic **B2B**.
- This software is not an approved platform: it **delegates** to the invoicing tool chosen by the school (ADR 0002).
- In code:
  - The software **never generates an invoice number**: it stores the one returned by the tool.
  - An issued invoice is never modified: issue a **credit note**.
  - VAT mentions come from the school configuration (`school.vat_regime`, `school.vat_mention`).
- The school's VAT regime and its tool are **pending the accountant's opinion**: keep them configurable.

## 6. Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · PostgreSQL 16 · Drizzle ORM · Zod · Mantine 8 · Tailwind 4 (layout only) · Vitest · Better Auth. Coming: pg-boss (background jobs), Playwright.

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
  connectors/                one folder per external service (calendar; invoicing to come): common interface + one implementation per tool
  jobs/                      background jobs (invoicing sync, lesson generation)
  lib/                       cross-cutting utilities (money.ts…)
migrations/                  drizzle-kit migrations + custom SQL migrations (RLS)
docs/adr/                    architecture decision records
DESIGN.md                    interface rules
```

- Business logic lives in the domain folder as **pure functions** (input → output, no database, no network), unit-tested. Routes and server actions only validate, call the domain and persist.
- The invoicing connector exposes one interface (`createCustomer`, `createInvoice`, `finalize`, `createCreditNote`, `readStatus`); the rest of the code never knows the concrete tool.
- Naming: `camelCase` for variables and functions, `PascalCase` for types and React components, `SCREAMING_SNAKE_CASE` for module constants, `snake_case` in the database, `kebab-case` file names.

## 8. Mandatory rules

**Multi-school and security** (ADR 0001)

- Every business query goes through `withSchool(schoolId, tx => …)`. Never use `db` directly for business data.
- Every new business table carries `school_id` **and** gets, in a SQL migration, `ENABLE` + `FORCE ROW LEVEL SECURITY` and the `school_isolation` policy (model in `migrations/0001_rls.sql`, which only covers tables existing when it was written).
- `app_user` privileges on new tables and sequences are granted automatically (default privileges, `migrations/0006_droits_par_defaut.sql`, guard `src/db/privileges.integration.test.ts`); RLS still has to be added every time.
- Every reference between two business tables is a composite foreign key `(school_id, x_id)`: `sameSchool(t, column, target)` in `src/db/schema.ts`, the target declaring `sameSchoolTarget(t)`. Never a plain `.references()` between business tables: foreign-key checks ignore RLS. Guard: `src/db/foreign-keys.integration.test.ts`.
- The `app_admin` role (BYPASSRLS) is for administration scripts only, never application code.
- `ecoleId` always comes from the server-side session, never from a browser parameter.
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
- Issues and PRs are public to the organisation: fictitious data only, no secret names.

**External services** (invoicing tools, calendars)

- Every call has a timeout, a bounded number of retries and a structured error; webhooks are idempotent.

**TypeScript**

- `strict` mode plus `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`; no `any` (ESLint error), no non-null assertion without a comment saying why it holds.

**CI** (`.github/workflows/`)

- Read-only token by default, actions pinned by commit SHA, `persist-credentials: false`, a timeout on every job, stale runs cancelled.
- `ci-success` aggregates the required jobs (format, lint, typecheck, tests, integration, `npm audit` on runtime dependencies, gitleaks secret scan); `PR conventions` checks the branch prefix and the conventional-commit PR title.
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
- Mantine components everywhere (ADR 0003); Tailwind only for layout. Custom control classes (`.champ`, `.bouton-principal`…) are being removed (#115).
- Lists work like Excel autofilters: each column header sorts and filters; one search bar at the top (Ctrl K).
- Forms and course records: a real page, also opened as a **side panel** over the current page (intercepted route in `src/app/(espace)/@modal/(.)…`, component `Panel` in `_panel/panel.tsx`). The cancel button is `<Cancel href=…>` (back navigation inside a panel).
- Accessible: labels on every field, sufficient contrast, dark mode.

## 12. What not to do

- Don't query business data with `db` outside `withSchool()`; don't use `app_admin` in application code.
- Don't take `ecoleId` (or any tenant id) from the browser.
- Don't put access control in a layout or in `proxy.ts`.
- Don't hard-code a price, discount, VAT mention or anything school-specific.
- Don't generate an invoice number; don't update an issued invoice, a payment or the audit log.
- Don't use floating-point numbers for money.
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
