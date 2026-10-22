#!/bin/sh
# Points git at the versioned hooks (#113). Run by `npm install` (prepare).
# Relative path: each worktree uses its own .githooks. Skipped outside a git
# work tree (CI checkouts without .git, npm pack).
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
git config core.hooksPath .githooks
git config blame.ignoreRevsFile .git-blame-ignore-revs
