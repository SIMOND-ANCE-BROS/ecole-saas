# 0001. Isolate schools with PostgreSQL Row Level Security

- Status: Accepted
- Date: 2026-10-22 (records a decision applied since the first migrations)
- Issue: #111

## Context
The product is a SaaS shared by several dance schools. Their data (minors,
health notes, payments) must never leak from one school to another, and the
code is written by a single developer helped by AI agents: a forgotten
`WHERE ecole_id = …` must not be enough to cause a leak.

## Decision
- Every business table carries `ecole_id` and has `ENABLE` + `FORCE ROW LEVEL
  SECURITY` with the policy `isolation_ecole`, comparing `ecole_id` with the
  transaction setting `app.ecole_id` (`migrations/0001_rls.sql`, then one SQL
  migration per new table).
- The application connects as `app_user` (no BYPASSRLS). Every business query
  runs inside `avecEcole(ecoleId, tx => …)` (`src/db/index.ts`), which sets
  `app.ecole_id` for the transaction. `ecoleId` comes from the server-side
  session only.
- References between business tables are composite foreign keys
  `(ecole_id, x_id)` (`memeEcole` / `cibleMemeEcole`), because foreign-key
  checks bypass RLS.
- `app_admin` (BYPASSRLS) is reserved for administration scripts.
- Guards run in CI: `src/db/rls.integration.test.ts` (every table with
  `ecole_id` has forced RLS and the policy), `src/db/cles-etrangeres.integration.test.ts`,
  `src/db/droits.integration.test.ts`.

## Alternatives considered
- **Application-level filtering only**: one forgotten condition leaks data; rejected.
- **One database or schema per school**: strongest isolation, but migrations,
  connections and backups multiply for a single developer; rejected for V1.

## Consequences
- Tests about isolation run against a real PostgreSQL, never mocks.
- Every new table needs its RLS migration; the guard test fails otherwise.
- Changing `0001_rls.sql`, `avecEcole()` or the policy is flagged explicitly in
  the PR. The English rename (#114) renames them through new migrations
  (`withSchool()`, `school_isolation`).
