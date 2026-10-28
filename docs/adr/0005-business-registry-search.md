# 0005. Search the business registry server-side, as an optional helper

- Status: Accepted
- Date: 2026-10-28
- Issue: #207

## Context

The front desk and the management type the legal name, SIREN and address
of organisations (works councils, companies paying for a student) and the
SIREN of instructors' businesses. The French State publishes a free API,
« Recherche d’entreprises » (annuaire-entreprises.data.gouv.fr), without a
key, limited to about seven calls per second **per calling server**, all
schools of this software together. Sole traders who refused publication are
missing or partly masked (`[ND]`).

## Decision

- **Helper, never a requirement.** Picking a result fills the form's own
  fields, which stay editable. If the registry is missing a company, is
  slow or refuses, the form says « Recherche indisponible, saisissez à la
  main. » and saving works as before. Nothing is checked against the
  registry on save.
- **Server-side only.** The browser calls our route
  `GET /registre-entreprises?q=` (signed-in director or front desk), which
  calls the API through `src/connectors/business-registry/` (timeout, one
  retry on a server or network error, Zod-checked rows). The browser never
  calls the State API directly.
- **A route handler, not a server action.** Next runs a page's server
  actions one after the other: searches typed quickly would queue up and
  delay « Enregistrer ». The route lets the browser cancel the searches it
  no longer needs.
- **A shared call budget.** In the process: a cache (10 minutes, keyed by
  school and query), a budget for the whole server (about 5 calls per
  second), one per member (about 1 per second, small burst), and a pause of
  every search after a 429 (Retry-After, else 30 seconds). Over budget, the
  registry is not called and the member types by hand.
- **Privacy.** A search for a sole trader may send a person's name to the
  State API. It is the public registry of that same data, the query is not
  stored with the school's data, and it is never logged (only the failure
  reason).

## Alternatives considered

- **Calling the API from the browser:** no shared budget, the school's
  network address exposed to the API, harder to cache. Rejected.
- **A paid provider (Pappers, Societe.com API):** richer data, but a key to
  store, a cost per school and a contract, for a helper. Rejected for V1.
- **Checking the SIREN on save:** a registry outage would block a save.
  Rejected; a closed company is only flagged in the form.

## Consequences

- One more external service, with the rules of `CLAUDE.md` (timeout,
  bounded retry, structured error).
- The limits are per server instance: several instances would each get
  the budget. To revisit with a shared store if the software is scaled out.
