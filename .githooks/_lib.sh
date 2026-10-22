# Shared preamble of the versioned git hooks (#113). Sourced, not executed.
#
# core.hooksPath = .githooks (relative, set by `npm install` through the
# `prepare` script, scripts/install-git-hooks.sh): every worktree runs its own
# versioned hooks. A worktree without node_modules makes the hooks FAIL LOUDLY
# instead of being silently skipped. Never bypass them with --no-verify.

hooks_root=$(git rev-parse --show-toplevel) || exit 1
cd "$hooks_root" || exit 1
export PATH="$hooks_root/node_modules/.bin:$PATH"

# require_deps <path>...: every path must exist, else the commit/push is refused with the fix.
require_deps() {
  hooks_missing=""
  for hooks_dep in "$@"; do
    [ -e "$hooks_dep" ] || hooks_missing="$hooks_missing $hooks_dep"
  done
  [ -z "$hooks_missing" ] && return 0
  {
    echo ""
    echo "Git hooks: missing dependencies — run \`npm ci\`"
    echo "  hook     : $(basename "$0")"
    echo "  worktree : $hooks_root"
    echo "  missing  :$hooks_missing"
    echo "  Never bypass with --no-verify."
    echo ""
  } >&2
  exit 1
}
