# Deployment: scheduled tasks

What production must run on a schedule, and how to tell that a run failed (#337).

> **Host and scheduler not chosen yet.** Everything below is host-independent: any scheduler that
> can run a command (cron, systemd timer, a platform's « scheduled job ») or call an HTTPS URL
> (a platform's HTTP cron) fits. The choice, and where alerts go, are open questions in #337.

## Tasks

| Task                 | How it runs                 | Frequency            | Time limit        | Environment                                                                                                  |
| -------------------- | --------------------------- | -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Invoice outbox sweep | `POST /api/taches/factures` | every minute         | 5 min (HTTP call) | on the web server: `JOBS_SECRET`, `DATABASE_URL`, `CLE_CHIFFREMENT`; scheduler: the same `JOBS_SECRET`       |
| Calendar sync        | `npm run calendars:sync`    | every hour           | 15 min (built in) | `DATABASE_URL`, `DATABASE_ADMIN_URL`, `CLE_CHIFFREMENT`, `GOOGLE_*` / `MICROSOFT_*` of the providers offered |
| Submission purge     | `npm run submissions:purge` | once a day, at night | 10 min (built in) | `DATABASE_URL`, `DATABASE_ADMIN_URL`                                                                         |

Times are `Europe/Paris`; the nightly purge can run at any quiet hour (03:00 for example).

- **Invoice outbox sweep** (ADR 0007, #304): sends drafted invoices to each business's invoicing
  tool and retries failures with backoff. Invoices are also sent right after they are drafted
  (`after()`); the sweep catches up on retries and on anything a restart interrupted.
- **Calendar sync** (#73): reads the busy ranges of each instructor's connected calendar into
  their unavailabilities. Each call to a provider times out after 10 s
  (`CALENDAR_TIMEOUT_MS`).
- **Submission purge** (#262): deletes form submission keys older than a week; without it the
  `submission` table grows without limit.

The two scripts use `DATABASE_ADMIN_URL` only to list which schools have work; each school is then
handled with `DATABASE_URL` under its own row-level security (`withSchool`). The npm scripts load
`.env` (`tsx --env-file=.env`): on the host, provide the variables in a `.env` file next to the
code or run `npx tsx scripts/<script>.ts` with them in the environment.

## Guarantees

- **Safe to run twice, or concurrently.** Every task is idempotent. The two scripts take a
  PostgreSQL advisory lock per task (`exclusively` in `src/jobs/scheduled-task.ts`): a run started
  while another is still going prints « une autre exécution est en cours » and exits 0. The lock
  needs a direct or session-pooled connection for `DATABASE_ADMIN_URL`, never a transaction
  pooler. The sweep needs no lock: invoices are claimed with `FOR UPDATE SKIP LOCKED`.
- **Bounded.** Past its time limit a script stops with exit code 2; the next run takes over.
  The sweep handles at most 25 invoices per business per call; give the scheduler's HTTP call a
  timeout (5 min) so that a stuck call is reported.
- **No personal data in the output.** Counts, school and business ids, and error kinds
  (`PostgresError 23505`, `TypeError`) only, never an error message, a name or an address.

## Telling that a run failed

| Task         | Success              | Failure                                                                                         |
| ------------ | -------------------- | ----------------------------------------------------------------------------------------------- |
| Scripts      | exit code 0          | 1: a school failed, the database is unreachable or a variable is missing; 2: time limit reached |
| Outbox sweep | HTTP 200 with counts | 401: wrong or missing `JOBS_SECRET`; 500: a business's run failed (its invoices wait)           |

The scheduler must alert the developer on a non-zero exit code or a non-2xx answer. A single
calendar failing (revoked access, provider down) does not fail the run: it is recorded on the
connection, shown to the school, and retried next hour. An invoice the tool rejects does not fail
the sweep either: management sees it with the rejected invoices.

For a scheduler that runs commands, the sweep can be called with curl, the secret read from a file
so that it never appears in the process list:

```sh
# /etc/ecole-saas/jobs-header contains one line: Authorization: Bearer <JOBS_SECRET>
curl --fail --silent --show-error --max-time 300 -X POST \
  -H @/etc/ecole-saas/jobs-header https://<host>/api/taches/factures
```

## Runbook

- **Run a task by hand**: same command as the scheduler. A script running already makes the second
  one a no-op.
- **A script exits 1**: read the line `École <id> : … en échec (<kind>)`. `ECONNREFUSED` or
  `ENOTFOUND`: database unreachable; `DATABASE_ADMIN_URL manquante`: environment not loaded.
  Other schools were processed; the failed one is retried next run.
- **A script exits 2**: a run took longer than its limit; look for a slow provider (calendars) or
  a locked table (purge). The next run resumes.
- **Sweep answers 401**: `JOBS_SECRET` differs between the scheduler and the web server, or is
  shorter than 32 characters on the server.
- **Sweep answers 500**: the web server's log names the business and school ids
  (« sending run failed »); the invoices of that business wait for the next sweep.
- **A calendar stays in error**: the school sees the message on the instructor's page; access
  removed means the instructor reconnects the calendar.
