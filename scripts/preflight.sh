#!/bin/sh
# Runs exactly what CI blocks on (#113), with a PASS/FAIL line per step.
# Integration tests need the local database: `npm run db:up` first.
# SKIP is never reported as a pass.
set -u
failed=0
step() {
  name=$1
  shift
  if "$@" >/tmp/preflight-$$.log 2>&1; then
    echo "PASS  $name"
  else
    echo "FAIL  $name"
    tail -n 20 /tmp/preflight-$$.log
    failed=1
  fi
}
step "format" npm run --silent format:check
step "typecheck" npm run --silent typecheck
step "lint" npm run --silent lint
step "unit tests" npm test --silent
if pg_isready -h localhost -p 5433 >/dev/null 2>&1; then
  step "integration tests" npm run --silent test:integration
else
  echo "SKIP  integration tests (database not reachable on 5433: npm run db:up)"
  failed=1
fi
step "build" npm run --silent build
step "secret scan" sh scripts/gitleaks.sh git --redact --no-banner --log-level warn --log-opts="origin/main..HEAD"
step "audit (runtime deps)" npm audit --omit=dev --audit-level=high
rm -f /tmp/preflight-$$.log
exit $failed
