<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project conventions

- Multi-school SaaS: every business table carries `school_id`; isolation relies on Row Level Security (`migrations/0001_rls.sql`, ADR 0001). Every business query goes through `withSchool()` (`src/db/index.ts`).
- No "family" entity: people (`personne`, → `person`) and relationships between them (`lien`, → `relationship`: legal guardian, partner, other; flags "pays for" and "emergency contact"). An adult on their own is their own payer. The siblings discount applies to students of the same payer (#67). The interface talks about students (`personne.eleve`), contacts, guardians, « à prévenir » and « Facturé à »: never an abstract "link" (#77).
- Amounts in integer cents (`*_cents` columns), rates in basis points. Use `src/lib/money.ts`; never floating-point numbers for money.
- The invoice number comes from the school's invoicing tool (Pennylane, Abby, Shine): never generate it here.
- Payments and the audit log are immutable: fix with a reverse entry.
- Nothing school-specific is hard-coded: tariffs, discounts, VAT mentions are data.
- **Language**: code, database, comments, tests, commits, issues and PRs in **English** (domain lexicon in `CLAUDE.md` §3); everything the end user sees, the PR section « Pour l’accueil et la direction » and the URLs in **French**. French comments and enum values still present are translated under #114; list column ids, URL parameters and their values stay French (data); never add new French identifiers.
- TypeScript strict, no `any`. Mantine for every UI control, Tailwind for layout only (`DESIGN.md`).

# Issues, branches and PRs (mandatory)

GitHub issues of `SIMOND-ANCE-BROS/ecole-saas` are the source of truth for work. Full conventions: **`docs/guides/issues.md`**, to follow when creating, editing or closing an issue.

- **Code → issue.** Every PR references at least one issue (`Closes #N`, or `Refs #N` if the issue needs more PRs). No issue? Create it first, after searching for duplicates.
- **Branches.** Never push directly to `main`. Allowed prefixes (checked in CI): `feature/ fix/ refactor/ test/ docs/ chore/ hotfix/ claude/ dependabot/` — not `feat/` nor `ci/`. Suggested name: `feature/11-tariff-engine`.
- **Commits and PR titles.** Conventional commits in English: `feat(scope): imperative sentence`.
- **PR.** Follow `.github/pull_request_template.md`: issue, summary, « Pour l’accueil et la direction » (French), test plan. **No merge without explicit approval**, PR by PR.
- **Discoveries → issue.** A bug, debt, security gap or stale doc found on the way is neither fixed silently nor left in the conversation: open an issue with evidence (`file:line`, output), cited in the final report.
- **Create = triage.** Every open issue has a type (Bug / Feature / Task / Epic), the org fields `Priority` and `Effort` (GraphQL `setIssueFieldValue`; `icebox` instead of a priority, no priority on an Epic), area labels, the milestone (unless `icebox`), its parent epic, and its card in the « École de danse — Roadmap » Project.
- **Open business questions**: in the issue (section "Open questions") with the `blocked` label, never decided by default.
