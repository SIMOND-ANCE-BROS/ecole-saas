# syntax=docker/dockerfile:1
#
# Production image (#337): the web server and the administration scripts (migrations, scheduled
# tasks) from one build, configured only by environment variables. Nothing secret is copied or
# baked in: .env files are excluded (.dockerignore) and no variable is read at build time.
#
#   docker build -t ecole-saas .
#   docker run --init --env-file web.env -p 127.0.0.1:3000:3000 ecole-saas
#   docker run --rm --init --env-file migrate.env ecole-saas node scripts/migrate.mjs
#
# docs/guides/deployment.md lists the variables of each process and the scheduled commands.

# Node 22 (the version CI runs), Alpine, pinned by the digest of its multi-arch index. Updated by
# Dependabot (docker ecosystem, 14-day cooldown) like any dependency.
ARG NODE_IMAGE=node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

# --- Dependencies: exactly the lockfile, dev tools included (the build needs them) -------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: `prepare` installs git hooks, meaningless here; no dependency needs its own
# install script to build (esbuild and the Next SWC binaries come as platform packages).
RUN npm ci --ignore-scripts --no-audit --no-fund

# --- Build: Next standalone server + one bundled file per administration script ---------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# The scripts run with tsx in development; the image has no dev dependency, so each one is
# bundled into a single ESM file with its dependencies (postgres, drizzle-orm). esbuild is the
# one tsx itself runs on. The banner gives bundled CommonJS code a `require`.
RUN node_modules/.bin/esbuild \
      scripts/migrate.ts \
      scripts/sync-calendars.ts \
      scripts/purge-submissions.ts \
      scripts/mark-overdue-installments.ts \
      scripts/pseudonymise-audit-log.ts \
      --bundle --platform=node --target=node22 --format=esm \
      --out-extension:.js=.mjs --outdir=dist/scripts --log-level=warning \
      "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

# --- Runtime -----------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
# NODE_ENV=production also refuses the fake invoicing tool and the fake e-mail sender (#351, #404).
# HOSTNAME: Docker sets it to the container id; the standalone server listens on it.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Files belong to root and are read-only for the `node` user (uid 1000) the processes run as;
# only Next's cache directory is writable.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/dist/scripts ./scripts
COPY --from=build /app/migrations ./migrations
RUN mkdir -p .next/cache && chown node:node .next/cache

USER node
EXPOSE 3000

# The sign-in page answers without a session; any failure or non-2xx marks the container unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/connexion').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "server.js"]
