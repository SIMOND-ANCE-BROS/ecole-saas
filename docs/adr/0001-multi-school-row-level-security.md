# 0001. Isolate schools with PostgreSQL Row Level Security

- Status: Accepted
- Date: 2026-10-22 (records a decision applied since the first migrations)
- Issue: #111

## Context

The product is a SaaS shared by several dance schools. Their data (minors,
health notes, payments) must never leak from one school to another, and the
code is written by a single developer helped by AI agents: a forgotten
`WHERE school_id = …` must not be enough to cause a leak.

## Decision

- Every business table carries `school_id` and has `ENABLE` + `FORCE ROW LEVEL
SECURITY` with the policy `school_isolation`, comparing `school_id` with the
  transaction setting `app.school_id` (`migrations/0001_rls.sql`, then one SQL
  migration per new table).
- The application connects as `app_user` (no BYPASSRLS). Every business query
  runs inside `withSchool(schoolId, tx => …)` (`src/db/index.ts`), which sets
  `app.school_id` for the transaction. `ecoleId` comes from the server-side
  session only.
- References between business tables are composite foreign keys
  `(school_id, x_id)` (`sameSchool` / `sameSchoolTarget`), because foreign-key
  checks bypass RLS.
- `app_admin` (BYPASSRLS) is reserved for administration scripts.
- Guards run in CI: `src/db/rls.integration.test.ts` (every table with
  `school_id` has forced RLS and the policy), `src/db/foreign-keys.integration.test.ts`,
  `src/db/privileges.integration.test.ts`.

## Alternatives considered

- **Application-level filtering only**: one forgotten condition leaks data; rejected.
- **One database or schema per school**: strongest isolation, but migrations,
  connections and backups multiply for a single developer; rejected for V1.

## Consequences

- Tests about isolation run against a real PostgreSQL, never mocks.
- Every new table needs its RLS migration; the guard test fails otherwise.
- Changing `0001_rls.sql`, `withSchool()` or the policy is flagged explicitly in
  the PR. Names are English since migration `0027_english_names` (#114):
  column `school_id`, policy `school_isolation`, setting `app.school_id`
  (originally `ecole_id`, `isolation_ecole`, `app.ecole_id`).

## Note (2026-10-29): migration role

`FORCE ROW LEVEL SECURITY` filters the table owner too. Data backfills inside
migrations (`0019`, `0036`…) run without `app.school_id`, so they only work
when the migration role is a superuser or has `BYPASSRLS`; otherwise they
match no row, silently unless a constraint catches it. `DATABASE_ADMIN_URL`
must therefore connect as a role that owns the tables (or is a superuser) and
bypasses RLS (superuser or `BYPASSRLS`), and `npm run db:migrate`
(`scripts/migrate.ts`) refuses to run otherwise (#279). Never run
`drizzle-kit migrate` directly: always `npm run db:migrate`. The decision above is
unchanged: no policy or `FORCE` flag is relaxed for migrations.
