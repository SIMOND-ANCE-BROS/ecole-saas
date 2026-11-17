#!/bin/sh
# Runs one scheduled task with a time limit, logs one line with its exit code, and calls the alert
# hook when it fails (#337). Host-independent: any scheduler able to run a command can use it.
#
#   run-task.sh <task-name> <time-limit-seconds> <command> [arguments...]
#
# Environment:
#   ALERT_URL      called (HTTP POST, body « task=<name> exit=<code> ») when the command exits
#                  non-zero or overruns its limit, e.g. the « fail » endpoint of a
#                  Healthchecks-style check. Unset: the failure is only logged.
#   HEARTBEAT_URL  optional, called after a success: a check expecting it alerts when the
#                  scheduler itself stops running.
#
# Exit code: the command's own; when the time limit stopped it, 124 with GNU coreutils (143 with
# BusyBox), 137 if it had to be killed.
# The line written here carries the task name, exit code and duration only: no command line, no
# URL, no output of the command (the scripts print counts and ids only, docs/guides/deployment.md).
set -u

if [ "$#" -lt 3 ]; then
  echo "usage: run-task.sh <task-name> <time-limit-seconds> <command> [arguments...]" >&2
  exit 64
fi

name=$1
limit=$2
shift 2

# The name ends up in the log and the alert body: keep it to a plain token.
case "$name" in
  *[!A-Za-z0-9:._-]*)
    echo "run-task.sh: invalid task name" >&2
    exit 64
    ;;
esac
case "$limit" in
  '' | *[!0-9]*)
    echo "run-task.sh: invalid time limit" >&2
    exit 64
    ;;
esac

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Bounded, no retry beyond two, never prints the URL (it may hold a token).
ping() {
  curl --fail --silent --show-error --max-time 10 --retry 2 --output /dev/null \
    --data-raw "task=$name exit=$1" "$2" 2>/dev/null
}

start=$(date +%s)
# SIGTERM at the limit, SIGKILL 30 s later if the command ignores it.
timeout -k 30 "$limit" "$@"
code=$?
duration=$(($(date +%s) - start))

echo "$(now) task=$name exit=$code duration=${duration}s"

if [ "$code" -ne 0 ]; then
  if [ -n "${ALERT_URL:-}" ]; then
    ping "$code" "$ALERT_URL" || echo "$(now) task=$name alert-not-delivered" >&2
  else
    echo "$(now) task=$name no-alert-url" >&2
  fi
elif [ -n "${HEARTBEAT_URL:-}" ]; then
  ping 0 "$HEARTBEAT_URL" || echo "$(now) task=$name heartbeat-not-delivered" >&2
fi

exit "$code"
