# 0004. Write code and process in English, the interface in French

- Status: Accepted
- Date: 2026-10-22
- Issues: #111, #114

## Context

The project started with a rule asking for French business code, comments,
commits and issues. The project owner asked to follow standard practice:
English everywhere except what end users see. Nothing is in production before
summer 2027, so renaming is cheapest now.

## Decision

- English: identifiers, file names, database tables, columns and enums,
  comments, tests, commits (conventional commits), PRs, issues, ADRs, developer docs.
- French: every text an end user sees (screens, messages, e-mails, exports),
  the PR section « Pour l’accueil et la direction », and URLs (Next route
  folders), because they are visible to users.
- A French → English domain lexicon lives in `CLAUDE.md` §3 and is the only
  source for names.
- Existing code is renamed module by module (#114), database included, through
  new migrations; no new French identifier is added meanwhile.

## Alternatives considered

- **English code, French database (Drizzle mapping)**: two vocabularies forever; rejected.
- **Only new code in English**: a mixed codebase for years; rejected.
- **English URLs**: users would see English addresses; rejected.

## Consequences

- The rename touches every module and the RLS policy names: one PR per module,
  behaviour unchanged, all tests green.
- Commit messages follow `type(scope): sentence`; the PR title is the squash
  commit subject.
