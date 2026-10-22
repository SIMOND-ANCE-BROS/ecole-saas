# Issues, branches and pull requests

GitHub issues are **the source of truth for work**. Everything that happens
(code, discovery, decision) is attached to an issue. This guide sets the shape
of an issue, how to classify it, and the path from a branch to `main`.
Method taken from FFD-Connect, adapted: a single long-lived branch (`main`),
no staging environment yet.

> Issues and PRs contain **no personal data** (student, family, phone number)
> and no secret: describe with fictitious data.

Language: issues, PRs, commits and this guide are in **English**. Only the PR
section « Pour l’accueil et la direction » is in French, for the school.

## 1. Everything is attached to an issue

| Situation | Rule |
| --- | --- |
| A PR | References at least one issue: `Closes #N`, or `Refs #N` if the issue still needs other PRs (§8). |
| No issue yet | Create it **before** opening the PR, after searching for duplicates. |
| Discovery on the way (bug, debt, security gap, flaky test, stale doc) | Never fix silently nor leave it in the conversation: open an issue (or comment on the existing one) with evidence. Fix it in the current PR only if small and on topic, still referencing it. |
| Pending business question | In the relevant issue ("Open questions" section), with the `blocked` label while it blocks. |
| Trivial chore (typo, lockfile) | May reference the closest issue. |

## 2. Title

Format: **`AREA: sentence`**. The sentence describes the **expected outcome**
(feature, task) or the **observed symptom** (bug), no final period.

- Good: `TARIFF: compute a payer's enrollment prices with the calculation details`
- Good (bug): `CI: typecheck fails on a fresh clone without Next route types`
- Bad: `[BUG] tariff issue`, `fix`, `Improvement`

Areas (upper case):

- Business: `TARIFF`, `ENROLLMENT`, `SCHEDULE`, `PEOPLE`, `INVOICING`,
  `CONNECTOR`, `PAYMENTS`, `PAYROLL`, `AUTH`, `TEAM`, `DASHBOARD`, `IMPORT`
- Cross-cutting: `SECURITY`, `GDPR`, `LEGAL`, `DB`, `UI`, `INFRA`, `CI`, `DEPS`,
  `DOCS`, `QA`, `REFACTOR`

An **epic** has the `Epic` type; its title names the theme, **without prefix**
(e.g. `Tariff engine and discounts`).

Older issues keep their French titles; they are not renamed.

## 3. Description

Sections in this order, deleting those that do not apply:

```markdown
## Context
Why we talk about it, in one or two sentences; related epic.

## Observed          ← bug / discovery
What happens, with evidence: `file:line`, command output.
For a bug: steps, expected / actual.

## Expected          ← feature / task
The target behaviour, nominal case and limits.

## Acceptance criteria
- [ ] Verifiable, one per line (tests to write included)

## Open questions    ← business rule to confirm with the school
1. …

## Out of scope
What is deliberately not covered.

## Links
Parent epic, blocking issues, PRs, docs.
```

When an issue ages, its history is not rewritten: add a
**`## Status on YYYY-MM-DD`** section at the top.

## 4. Type

The organisation **issue type** is mandatory:

| Type | For |
| --- | --- |
| `Bug` | An existing behaviour is wrong (or certainly will be). |
| `Feature` | A new capability for the school (front desk, management, teachers). |
| `Task` | Technical work without visible effect: CI, dependencies, debt, tooling, docs. |
| `Epic` | A theme grouping several issues (sub-issues). No direct code. |

## 5. Priority, effort and labels

Priority and effort are organisation **issue fields** (`Priority`, `Effort`),
not labels. Set them in the issue side panel or through the GraphQL API
(`setIssueFieldValue`): `gh issue edit` cannot change them.

**Priority**: one on every open issue, except `icebox` and except an `Epic`
(its urgency shows on its sub-issues).

| `Priority` | Meaning |
| --- | --- |
| `Urgent` | Blocking, security, leak between schools, exposed personal data, wrong amount: now. |
| `High` | Needed for the next milestone and on the critical path. |
| `Medium` | Needed before going live. |
| `Low` | Improvement, may slip. |

**Effort**: `Low` (less than half a day), `Medium` (one to three days),
`High` (several days or several PRs, or an external dependency).

**Labels**:

1. `icebox`: unplanned idea (no priority, no milestone).
2. **Areas**, one or more: `domain` (pure logic), `db`, `ui`, `connector`,
   `infra`, `ci`, `testing`, `documentation`, `dependencies`, `security`.
3. **Business areas** when useful: `tariff`, `enrollment`, `schedule`,
   `people`, `invoicing`, `payroll`, `auth`.
4. **Status**: `blocked` (another issue, a business answer or a third party blocks).

Reuse existing labels; create a new one only after documenting it here.

## 6. Milestones

1. **V1 — Rentrée 2027**: the V1 roadmap (CLAUDE.md §14).

A milestone description always follows this format:

```markdown
🎯 Goal: what is true for the school when the milestone is closed.

✅ Exit criteria:
- verifiable condition;
- no Urgent or High issue open in this milestone.

📦 Scope: the epics covered.

🚫 Out of scope: what is postponed, and where to.

📅 Due: a date, or the condition that will set it.
```

Update it when the scope changes.

## 7. Relations

| Relation | GitHub tool | Rule |
| --- | --- | --- |
| Belongs to a theme | **Sub-issue** of the epic | A single parent. |
| Depends on another issue | **Blocked by** | + `blocked` label while the blocker is open. |
| Duplicate | Close as `duplicate` | Comment "Merged into #X". |
| Mentions without depending | `#N` in the text | — |

An epic is closed when all its sub-issues are closed.

## 8. Branches, PRs and the « École de danse — Roadmap » Project

**Branches.** Never push directly to `main`. A branch starts from `main` with
an allowed prefix, checked in CI (`.github/workflows/pr-conventions.yml`, which also checks that the PR title is a conventional commit):

| Prefix | For |
| --- | --- |
| `feature/` | Feature (`feature/11-tariff-engine`) |
| `fix/` | Bug fix |
| `refactor/` | Restructuring without behaviour change |
| `test/` | Tests only |
| `docs/` | Documentation |
| `chore/` | CI, dependencies, tooling (not `ci/`) |
| `hotfix/` | Urgent fix |
| `claude/`, `dependabot/` | Branches created by tools |

Suggested name: `<prefix>/<issue number>-<a-few-words>`.

**Commits and PR titles.** Conventional commits in English, imperative mood:
`<type>(<scope>): <sentence>`, types `feat`, `fix`, `refactor`, `test`,
`docs`, `chore`, `perf`, `security`; the scope is a module (`enrollment`,
`lists`, `team`, `ci`…). The PR is squash-merged with its title as the commit
subject.

**PR.** The template (`.github/pull_request_template.md`) asks for: the issue,
a summary, what changes for the front desk and management (in French), the
test plan with a screenshot for any visible change. Nothing is merged without
the project owner's explicit approval.

- `Closes #N`: the PR completes the issue. Merge ⇒ issue closed ⇒ `Done`.
- `Refs #N`: the PR moves the issue forward without completing it. Merge ⇒ the
  card goes back to `In Progress`.

A squash merge copies the commit messages: no `Closes` in a commit of a `Refs` PR.

**Project.** Every open issue is in the organisation Project. Its `Status`
column moves by itself (`.github/workflows/project-status.yml`):

| `Status` | When | Trigger |
| --- | --- | --- |
| `Todo` | Triaged, not started | issue opened or reopened, PR closed without merge |
| `In Progress` | Branch or draft PR | **draft** PR referencing the issue, `Refs` PR merged |
| `In Review` | PR ready for review | PR "Ready for review" |
| `Done` | Merged, issue closed | issue closed |

The workflow needs the `PROJECT_TOKEN` secret (token with write access to the
organisation Projects); without it, it warns and does nothing.
By hand: `.github/scripts/project-status.sh "In Progress" 11`.

**Create = triage.** An issue is never left half-created: right after
`gh issue create` (labels and milestone in the command), set its type,
`Priority` / `Effort`, its parent and add it to the Project.

## 9. Closing

Always with a reason and a one-line comment:

- `completed`: cite the PR ("Delivered by #N");
- `not_planned`: say why (outdated, out of scope, replaced by #N);
- `duplicate`: "Merged into #N".
