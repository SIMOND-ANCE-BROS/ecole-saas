## Issue

<!-- Mandatory: moves the Project card.
     Closes #N : the PR completes the issue (closed on merge).
     Refs #N   : the PR moves the issue forward without completing it.
     No issue? Create it first (docs/guides/issues.md).
     Title: conventional commit, e.g. `feat(enrollment): compute the siblings discount`. -->

Closes #

## Summary

<!-- 1 to 3 bullets: what the PR does and why. -->

-

## Pour l’accueil et la direction

<!--
In FRENCH, for the school (not for a developer): what changes on screen or in
amounts, where to find it. One bullet per visible change.
Write « Rien » if the PR has no visible effect (CI, refactor, tests…).
-->

## Test plan

<!-- What was checked, and how. Screenshot for any visible change (desktop, phone, dark mode). -->

- [ ] `npm run lint`, `npm run typecheck`, `npm test`
- [ ] `npm run test:integration` (if the database is involved)
- [ ] Reviewers run: `code-reviewer` (+ `security-reviewer` / `migration-reviewer` / `billing-reviewer` / `ux-reviewer` when relevant)
