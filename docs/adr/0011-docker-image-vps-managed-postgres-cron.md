# 0011. Run production as one Docker image on a VPS, with a managed PostgreSQL and cron

- Status: Proposed
- Date: 2026-11-17
- Issue: #337

## Context

Go-live is June 2027 for one school, run by one developer. Production needs a web server,
migrations at each deployment, and scheduled tasks: the invoice outbox sweep (ADR 0007), calendar
sync, overdue installments, the submission purge and the audit-log pseudonymisation (ADR 0010). A
failed run must alert. The data are personal data of minors and must be backed up and restorable.

Owner decision (2026-11-15): a VPS for the application and a managed PostgreSQL (Scaleway or
Clever Cloud, with backups), keeping a later move to Clever Cloud cheap; scheduled tasks from the
VPS's cron, documented host-independently; alerts on a non-zero exit; administration scripts
connect directly or in session mode, never through a transaction pooler (their advisory lock needs
the session).

## Decision

- **One image for every process** (`Dockerfile`): the Next.js standalone server (`node server.js`)
  and each administration script bundled with esbuild into one `scripts/*.mjs` file. Non-root
  user, `NODE_ENV=production`, base image pinned by digest, no secret and no variable read at build
  time: the image is configured by environment variables only, one env file per process (web,
  migrations, jobs), each with only what it uses. `DATABASE_ADMIN_URL` never reaches the web server.
- **Deployment**: image tagged by git SHA; migrations from that image in a one-off container,
  outside desk hours, before the web container is replaced; then the tag `ecole-saas:current` moves
  so that scheduled tasks run the same version. A rollback runs and re-tags the previous image;
  migrations are never undone, so each stays compatible with the previous release (add first,
  remove later).
- **Scheduled tasks**: the host's cron runs each task through `deploy/run-task.sh` (time limit, one
  log line without personal data, POST to an alert URL on a non-zero exit, optional heartbeat on
  success). Scripts run in one-off containers of `ecole-saas:current`; the sweep is a curl to the
  web container on the loopback. These periodic tasks are not "job kinds" in the sense of ADR 0007:
  pg-boss stays deferred until queued background work of three kinds exists.
- **Database**: managed PostgreSQL 16 with daily backups (at least 30 days), TLS `verify-full`, two
  login roles: `app_user` (subject to RLS) and an owner that is superuser or `BYPASSRLS` (ADR 0001,
  #279). A provider that cannot offer both is not eligible. Weekly encrypted off-provider dump;
  restore tested before go-live and every quarter.
- **Moving host** (Clever Cloud) changes the host, not the image: same variables, `PORT` set for
  the platform, the same commands from the platform's scheduler or a small machine keeping the cron.

The guide is `docs/guides/deployment.md`.

## Alternatives considered

- **PaaS from day one (Clever Cloud Docker application)**: the owner chose a VPS first; the image
  keeps the move open at the cost of a DNS switch.
- **Scripts run with tsx and the dev dependencies in the image**: hundreds of MB more and the dev
  toolchain in production. Rejected.
- **Scripts behind HTTP routes for an HTTP-only scheduler**: request time limits and more attack
  surface for tasks that need the owner connection. Rejected while a command scheduler exists.
- **A scheduler inside the image or a scheduler container (supercronic, ofelia), or pg-boss cron**:
  a new dependency or process for what the host's cron does. Rejected (ADR 0007 trigger not met).
- **`docker exec` into the web container for the scripts**: version sync for free, but the owner
  connection would sit next to the web process and the tasks would fail whenever the web server is
  down. Rejected.
- **Self-managed PostgreSQL on the VPS**: backups, upgrades and point-in-time recovery on one
  developer. Rejected.

## Consequences

- One artifact, built and run in CI (`image` job: migrations, every scheduled script and the web
  server against a throw-away database), is what runs in production.
- The VPS holds no business data: env files and the image tag rebuild it; `CLE_CHIFFREMENT` is kept
  outside the VPS.
- The developer owns the VPS: OS updates, reverse proxy (HTTPS, client-IP header overwritten),
  Docker log limits, image pruning, uptime and alert checks.
- esbuild is used through the copy tsx brings (0.28.2), like tsx itself today; declaring it as a
  pinned dev dependency awaits the owner's approval (CLAUDE.md §10).
- Follow-ups: where the image is built (on the VPS or by CI into a private registry); Node 24 before
  Node 22's end of life (April 2027); `deploymentId` for tabs left open across a deployment; one
  deployment script for deploy and rollback; the provider chosen after a trial confirming the two
  roles and `BYPASSRLS`.
