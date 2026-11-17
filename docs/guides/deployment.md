# Deployment

How production runs (#337): one Docker image, a managed PostgreSQL, scheduled tasks, alerts,
backups.

> **Owner decision (2026-11-15).** The application starts on a **VPS** with a **managed
> PostgreSQL** (Scaleway or Clever Cloud, with backups). The image is configured by environment
> variables only, so that moving to Clever Cloud later changes the host, not the image. Scheduled
> tasks run from the VPS's cron through `deploy/run-task.sh`, which alerts on a non-zero exit;
> everything else stays host-independent. Administration scripts connect directly (session mode),
> never through a transaction pooler.

## The image

`Dockerfile` builds one image for every process: the Next.js standalone server
(`output: "standalone"`) and the administration scripts, each bundled into one `scripts/*.mjs`
file (no dev dependency and no `tsx` in the image). It runs as the unprivileged `node` user with
`NODE_ENV=production`, and holds no secret: `.env` files never enter the build (`.dockerignore`)
and nothing is read from the environment at build time. CI builds it on every pull request
without pushing it (job `image`).

| Process              | Command in the image                          | Started by               |
| -------------------- | --------------------------------------------- | ------------------------ |
| Web server           | `node server.js` (default command, port 3000) | `docker run -d --init …` |
| Migrations           | `node scripts/migrate.mjs`                    | each deployment, by hand |
| Calendar sync        | `node scripts/sync-calendars.mjs`             | scheduler                |
| Submission purge     | `node scripts/purge-submissions.mjs`          | scheduler                |
| Overdue installments | `node scripts/mark-overdue-installments.mjs`  | scheduler                |
| Pseudonymisation     | `node scripts/pseudonymise-audit-log.mjs`     | scheduler                |
| Invoice sweep        | HTTP call to the web server                   | scheduler, with curl     |

Always start containers with `--init`: it forwards `SIGTERM` to Node, so that `docker stop` lets
the server finish its requests and pending `after()` work (invoice sending), and the time limit of
`run-task.sh` can stop a script.

```sh
docker build -t ecole-saas:<git-sha> .
docker run --rm --init --env-file /etc/ecole-saas/migrate.env ecole-saas:<git-sha> node scripts/migrate.mjs
docker run -d --init --name ecole-saas-web --restart unless-stopped \
  --env-file /etc/ecole-saas/web.env -p 127.0.0.1:3000:3000 ecole-saas:<git-sha>
```

The web container is published on the loopback only: a reverse proxy on the VPS (Caddy, nginx)
terminates HTTPS, limits request sizes and writes the client's IP into the header named by
`IP_CLIENT_EN_TETE` (for example `x-real-ip`, overwriting whatever the client sent).

## Environment per process

Each process gets only what it uses: one env file per process on the VPS
(`/etc/ecole-saas/web.env`, `migrate.env`, `jobs.env`), owned by the deploying user, `chmod 600`,
`KEY=value` lines without quotes (as `docker --env-file` reads them). `.env.example` describes
every variable.

| Variable                                                 | Web | Migrations | Scripts       | Scheduler (cron)  |
| -------------------------------------------------------- | --- | ---------- | ------------- | ----------------- |
| `DATABASE_URL` (`app_user`, subject to RLS)              | yes | –          | yes           | –                 |
| `DATABASE_ADMIN_URL` (owner, BYPASSRLS)                  | –   | yes        | yes           | –                 |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`                  | yes | –          | –             | –                 |
| `BETTER_AUTH_TRUSTED_ORIGINS` (if several origins)       | yes | –          | –             | –                 |
| `IP_CLIENT_EN_TETE`                                      | yes | –          | –             | –                 |
| `CLE_CHIFFREMENT`                                        | yes | –          | calendar sync | –                 |
| `GOOGLE_*`, `MICROSOFT_*` (providers offered)            | yes | –          | calendar sync | –                 |
| `JOBS_SECRET`                                            | yes | –          | –             | yes (header file) |
| `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | yes | –          | –             | –                 |
| `NODE_EXTRA_CA_CERTS` (provider CA, see below)           | yes | yes        | yes           | –                 |
| `ALERT_URL`, `HEARTBEAT_URL`                             | –   | –          | –             | yes               |

Never in production: `DATABASE_ADMIN_URL` in the web server (the owner connection never reaches
application code), `INVOICING_FAKE_ALLOWED`, `EMAIL_FAKE_ALLOWED`, `ORIGINES_DEV`,
`SEED_MOT_DE_PASSE`, and any change to `NODE_ENV` (the image sets `production`, which also refuses
the fake tools, #351, #404). `PORT` and `HOSTNAME` have working defaults in the image.

`CLE_CHIFFREMENT` encrypts the invoicing tools' and calendars' credentials in the database: keep a
copy outside the VPS (a password manager); a restored database is of little use without it.

### Database connections

- **Two roles.** `app_user` (login, no BYPASSRLS, not owner of the tables) for `DATABASE_URL`; an
  owner role that is superuser or BYPASSRLS for `DATABASE_ADMIN_URL` (`node scripts/migrate.mjs`
  refuses any other, #279). Create `app_user` before the first migration: migrations grant it its
  rights. **Check with the provider before choosing it** that it lets you create a second login
  role and give the owner `BYPASSRLS` (only a superuser can grant that attribute in
  PostgreSQL 16); with a provider that does not, these migrations cannot run.
- **Direct or session mode.** Both URLs point at the server itself or at a pooler in session mode,
  never a transaction pooler: the scheduled tasks hold an advisory lock for the whole run.
- **TLS, verified.** Add `?sslmode=verify-full` to both URLs. When the provider's certificate is
  signed by its own authority, mount its CA certificate read-only in the containers and set
  `NODE_EXTRA_CA_CERTS` to its path. `sslmode=require` encrypts without checking the server.
- **Size.** The web server's pool keeps up to 10 connections, each script up to 12 (2 owner + 10
  application) while it runs: check the plan's connection limit.

## Deploying a version

1. Build the image from the merged commit and tag it with its SHA.
2. **Outside desk hours** (evening or early morning, never while the enrollment desk is open),
   apply the migrations with that image:
   `docker run --rm --init --env-file /etc/ecole-saas/migrate.env ecole-saas:<sha> node scripts/migrate.mjs`.
   A failure stops here: the running version is untouched; the fix is a new migration in a new PR.
3. Replace the web container (`docker stop ecole-saas-web` gives requests in flight 10 s, then
   `docker rm` and `docker run` as above), then tag the image `ecole-saas:current` so that the
   scheduled tasks run the same version (`docker tag ecole-saas:<sha> ecole-saas:current`).
4. Check that the sign-in page answers and that `docker logs ecole-saas-web` shows no error.

Rolling back means running the previous image; migrations are not undone, so a migration stays
compatible with the version before it (add first, remove in a later release).

## Backups and restore test

- **Backups** come from the managed PostgreSQL: daily automatic backups kept at least 30 days, and
  point-in-time recovery when the plan offers it. The VPS holds no business data: its env files and
  the image tag are enough to rebuild it.
- **Off-provider copy**, once a week: `pg_dump --format=custom` with `DATABASE_ADMIN_URL`, encrypted
  before it leaves the VPS, kept with another provider. The dump holds personal data of minors:
  never on a personal computer, never unencrypted.
- **Restore test**, every quarter and before the go-live: restore the latest backup into a new,
  throw-away database of the provider; run `node scripts/migrate.mjs` against it (nothing left to
  apply); point a local container at it (`DATABASE_URL` of its `app_user`), sign in, open a student
  and an invoice; then delete that database. Note the date and how long it took in an issue. A
  backup never restored is not a backup.

## Moving to Clever Cloud

The image runs anywhere Docker runs; the move changes the host, not the code:

1. Create a Docker application from this repository's `Dockerfile` and give it the web variables
   of the table above (port 3000; `HOSTNAME` is set by the image).
2. Database: keep the current managed PostgreSQL (same URLs), or move to a Clever Cloud
   PostgreSQL add-on after checking the role requirements above (second login role, BYPASSRLS),
   by dump and restore outside desk hours.
3. Migrations: run `node scripts/migrate.mjs` in a one-off container of the new image before
   switching traffic, as in step 2 of a deployment.
4. Scheduled tasks: the commands of `deploy/crontab.example`, from the platform's scheduler (or a
   small machine left with the cron), through `deploy/run-task.sh` or with the platform's own alert
   on a non-zero exit. The sweep becomes an HTTPS call to the public address.
5. `IP_CLIENT_EN_TETE`: the header the platform's proxy writes (from its documentation; never a
   header the client can set).
6. Switch DNS, watch one full day of scheduled runs, then stop the VPS.

Several web instances would also need one `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` shared at build
time (Next.js self-hosting guide); one instance is enough for one school, so it is not set.

## Scheduled tasks

What production must run on a schedule, and how to tell that a run failed. On the VPS, the cron of
`deploy/crontab.example` runs every task through `deploy/run-task.sh` (copied to
`/opt/ecole-saas/`): a time limit, one log line per run (task name, exit code, duration), and a
POST to `ALERT_URL` on any failure. Any other scheduler that can run a command (systemd timer, a
platform's « scheduled job ») or call an HTTPS URL fits the same way. Rotate the log
(`/var/log/ecole-saas/tasks.log`, logrotate weekly): the sweep adds one line a minute.

### Tasks

| Task                   | How it runs                    | Frequency                  | Time limit        | Environment                                                                                                  |
| ---------------------- | ------------------------------ | -------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Invoice outbox sweep   | `POST /api/taches/factures`    | every minute               | 5 min (HTTP call) | on the web server: `JOBS_SECRET`, `DATABASE_URL`, `CLE_CHIFFREMENT`; scheduler: the same `JOBS_SECRET`       |
| Calendar sync          | `npm run calendars:sync`       | every hour                 | 15 min (built in) | `DATABASE_URL`, `DATABASE_ADMIN_URL`, `CLE_CHIFFREMENT`, `GOOGLE_*` / `MICROSOFT_*` of the providers offered |
| Submission purge       | `npm run submissions:purge`    | once a day, at night       | 10 min (built in) | `DATABASE_URL`, `DATABASE_ADMIN_URL`                                                                         |
| Overdue installments   | `npm run installments:overdue` | once a day, after midnight | 10 min (built in) | `DATABASE_URL`, `DATABASE_ADMIN_URL`                                                                         |
| Audit pseudonymisation | `npm run audit:pseudonymise`   | once a month, at night     | 30 min (built in) | `DATABASE_URL`, `DATABASE_ADMIN_URL`                                                                         |

Times are `Europe/Paris`; the nightly purge can run at any quiet hour (03:00 for example).

- **Invoice outbox sweep** (ADR 0007, #304): sends drafted invoices to each business's invoicing
  tool and retries failures with backoff. Invoices are also sent right after they are drafted
  (`after()`); the sweep catches up on retries and on anything a restart interrupted.
- **Calendar sync** (#73): reads the busy ranges of each instructor's connected calendar into
  their unavailabilities. Each call to a provider times out after 10 s
  (`CALENDAR_TIMEOUT_MS`).
- **Submission purge** (#262): deletes form submission keys older than a week; without it the
  `submission` table grows without limit. The same run deletes the e-mail proofs of invitations
  past their 24 hours (#404, ADR 0008): rows `email-proof:…` of Better Auth's global
  `verification` table, keyed by a hash of an address, which is personal data. They are global
  (no school), deleted in one statement with `DATABASE_URL`; a failure there is logged on its own
  line (« Preuves d’adresse e-mail : purge en échec ») and fails the run, after the schools.
- **Overdue installments** (#358): marks « en retard » the unpaid installments of issued invoices
  the day after their due date (`Europe/Paris`). A payment or a release refreshes the statuses it
  touches at once; this task catches the installments nobody paid. Run it after midnight (00:15
  for example) so that the day's statuses are right from the morning.
- **Audit pseudonymisation** (#184, ADR 0010): replaces the personal values kept in the audit log
  (e-mail of an invitation, reason typed for a price) with « [pseudonymisé] » 3 years after the end
  of the relationship (`src/db/audit-pseudonymisation.ts`, rule awaiting the owner’s answer). The
  rows, their amounts, dates and ids stay; payments and invoices are never touched. Keys no list
  classifies are printed by name on their own line (« Clés du journal à classer »): classify them
  in `src/domain/audit/pseudonymise.ts`, and a new personal key in a migration.

The scripts use `DATABASE_ADMIN_URL` only to list which schools have work; each school is then
handled with `DATABASE_URL` under its own row-level security (`withSchool`). In production they
run from the image (`node scripts/<name>.mjs`, variables from the environment only). In
development the npm scripts load `.env` (`tsx --env-file=.env`) and fail at once, outside the exit
codes below, when that file is missing.

### Guarantees

- **Safe to run twice, or concurrently.** Every task is idempotent. The scripts take a
  PostgreSQL advisory lock per task (`exclusively` in `src/jobs/scheduled-task.ts`, runner in
  `scripts/lib/scheduled-task.ts`): a run started
  while another is still going prints « une autre exécution est en cours » and exits 0. The lock
  needs a direct or session-pooled connection for `DATABASE_ADMIN_URL`, never a transaction
  pooler. The sweep needs no lock: invoices are claimed with `FOR UPDATE SKIP LOCKED`.
- **Bounded.** Past its time limit a script stops with exit code 2; the next run takes over.
  The sweep handles at most 25 invoices per business per call; give the scheduler's HTTP call a
  timeout (5 min) so that a stuck call is reported.
- **No personal data in the output.** Counts, school and business ids, and error kinds
  (`PostgresError 23505`, `TypeError`) only, never an error message, a name or an address.

### Telling that a run failed

| Task          | Success              | Failure                                                                                                                                                                              |
| ------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scripts       | exit code 0          | 1: a school failed or a calendar failure could not be recorded, the database is unreachable or a variable is missing; 2: time limit reached                                          |
| Outbox sweep  | HTTP 200 with counts | 401: wrong or missing `JOBS_SECRET`; 500: a business's run failed (its invoices wait)                                                                                                |
| `run-task.sh` | the command's code   | the command's code; 124 (143 with BusyBox): its own time limit stopped a hung command, 137 if it had to be killed; curl 22: the sweep answered 4xx or 5xx, 7: web server unreachable |

The scheduler must alert the developer on a non-zero exit code or a non-2xx answer. A single
calendar failing (revoked access, provider down) does not fail the run: it is recorded on the
connection, shown to the school, and retried next hour. A calendar whose failure could not even be
recorded (database error while saving it) is shown to no one: it fails the run (exit 1), is logged
with the school and instructor ids, and the other calendars are still synced (#373). A refresh
token the provider renewed during that run is still saved on its own (#381); only when that write
fails too is the token lost, logged on a line of its own (see the runbook). An invoice
the tool rejects does not fail the sweep either: management sees it with the rejected invoices.

The run does not fail either when **every** calendar fails, for example `GOOGLE_*` missing on the
host or the OAuth client secret revoked: the summary line then shows `agendas synchronisés : 0`
with a non-zero `en échec`. Watch for that line after any change to the provider variables.

Configure the scheduler **without retries**: the next scheduled run is the retry, and an HTTP cron
retrying a 500 at once only adds load on a tool that is already failing.

For a scheduler that runs commands, the sweep is called with curl (as in `deploy/crontab.example`),
the secret read from a file so that it never appears in the process list:

```sh
# /etc/ecole-saas/jobs-header contains one line: Authorization: Bearer <JOBS_SECRET>
# Owned by the scheduler's user, readable by it only: chmod 600 /etc/ecole-saas/jobs-header
curl --fail --silent --show-error --max-time 300 -X POST \
  -H @/etc/ecole-saas/jobs-header http://127.0.0.1:3000/api/taches/factures
```

`ALERT_URL` receives one POST per failure, body `task=<name> exit=<code>`: for example the
« fail » endpoint of a Healthchecks-style check, or a notification topic the developer follows.
`HEARTBEAT_URL`, optional, receives the same after each success: a check expecting a ping every
few minutes then also reports a cron, a VPS or a Docker daemon that stopped running anything.

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
- **`déjà en cours : N` in the calendar summary**: N calendars were being synced by another run
  (« Synchroniser », a reconnection, an overlapping hourly run) and were skipped (#370); they are
  synced next hour. A sync that died holds its calendar at most 5 minutes
  (`calendar_connection.sync_claimed_until`), then the next one takes over.
- **Line `École <id>, intervenant <id> : jeton d’agenda renouvelé perdu, agenda à reconnecter`**:
  the provider renewed the calendar's refresh token during a failed run and neither the error nor
  the token could be saved (#381). Once the database is back, ask the school to have that
  instructor reconnect the calendar: providers that revoke the old token on rotation will refuse
  it on the next run.
