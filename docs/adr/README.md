# Architecture decision records

One file per structural decision, numbered, never rewritten: a decision that
changes is **superseded** by a new record that links to the old one (and the
old one gets `Status: Superseded by NNNN`).

| #                                                      | Decision                                                  | Status   |
| ------------------------------------------------------ | --------------------------------------------------------- | -------- |
| [0001](0001-multi-school-row-level-security.md)        | Multi-school isolation with PostgreSQL Row Level Security | Accepted |
| [0002](0002-invoicing-delegated-to-the-school-tool.md) | Invoicing delegated to the school's invoicing tool        | Accepted |
| [0003](0003-mantine-for-the-interface.md)              | Mantine for every interface control, Tailwind for layout  | Accepted |
| [0004](0004-english-code-french-interface.md)          | English code and process, French interface                | Accepted |

## Template

```markdown
# NNNN. Title in the imperative or as a statement

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Issue: #N

## Context

The forces at play, facts and constraints.

## Decision

What we do, stated firmly.

## Alternatives considered

Each serious alternative and why it was rejected.

## Consequences

What becomes easier, what becomes harder, follow-up work.
```
