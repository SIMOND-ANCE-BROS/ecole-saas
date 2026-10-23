#!/bin/sh
# Run a pinned, checksum-verified gitleaks (#113, taken from FFD-Connect). Used by the pre-commit
# hook and by the CI `secret-scan` job, so both run the exact same binary and
# rules. All arguments are passed through to gitleaks, e.g.:
#
#   sh scripts/gitleaks.sh git --pre-commit --staged --redact --verbose
#
# Resolution order:
#   1. cached binary  <git-common-dir>/gitleaks/<version>/gitleaks
#      (outside the work tree: shared by every worktree, survives a
#      node_modules wipe, never staged);
#   2. download of the official release archive, verified against the
#      SHA-256 pinned below (fail-closed on mismatch), then cached;
#   3. a `gitleaks` already on PATH (unsupported platform or offline), with a
#      warning since its version may differ from the pin.
# If none works, exit 1 with instructions: a secret scan that silently does
# not run is worse than a blocked commit.
#
# Bumping: change GITLEAKS_VERSION and the four checksums below, taken from
# gitleaks_<version>_checksums.txt of the GitHub release (choose a release at
# least two weeks old).
set -eu

GITLEAKS_VERSION=8.30.1

os=$(uname -s)
arch=$(uname -m)
case "$os/$arch" in
  Darwin/arm64) platform=darwin_arm64 sha256=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
  Darwin/x86_64) platform=darwin_x64 sha256=dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709 ;;
  Linux/x86_64) platform=linux_x64 sha256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  Linux/aarch64 | Linux/arm64) platform=linux_arm64 sha256=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
  *) platform="" sha256="" ;;
esac

fail() {
  printf '\n[gitleaks] %s\n' "$1" >&2
  printf '[gitleaks] Install gitleaks %s manually (https://github.com/gitleaks/gitleaks/releases)\n' "$GITLEAKS_VERSION" >&2
  printf '[gitleaks] and make sure it is on your PATH, then retry. Never bypass the hook.\n' >&2
  exit 1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

common_dir=$(git rev-parse --git-common-dir)
common_dir=$(cd "$common_dir" && pwd)
cache_dir="$common_dir/gitleaks/$GITLEAKS_VERSION"
bin="$cache_dir/gitleaks"

install_pinned() {
  [ -n "$platform" ] || return 1
  command -v curl >/dev/null 2>&1 || return 1
  mkdir -p "$cache_dir"
  tmp=$(mktemp -d "$cache_dir/dl.XXXXXX")
  archive="$tmp/gitleaks.tar.gz"
  url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${platform}.tar.gz"
  printf '[gitleaks] Downloading gitleaks %s (%s), one-time...\n' "$GITLEAKS_VERSION" "$platform" >&2
  if ! curl --fail --silent --show-error --location --retry 2 --max-time 60 "$url" -o "$archive"; then
    rm -rf "$tmp"
    return 1
  fi
  actual=$(sha256_of "$archive")
  if [ "$actual" != "$sha256" ]; then
    rm -rf "$tmp"
    fail "Checksum mismatch for $url (expected $sha256, got $actual). Refusing to run it."
  fi
  tar -xzf "$archive" -C "$tmp" gitleaks
  chmod +x "$tmp/gitleaks"
  mv -f "$tmp/gitleaks" "$bin" # atomic within the same directory
  rm -rf "$tmp"
}

if [ ! -x "$bin" ] && ! install_pinned; then
  if command -v gitleaks >/dev/null 2>&1; then
    printf '[gitleaks] Pinned %s unavailable (offline or unsupported %s/%s): using %s from PATH.\n' \
      "$GITLEAKS_VERSION" "$os" "$arch" "$(command -v gitleaks)" >&2
    bin=$(command -v gitleaks)
  else
    fail "Could not obtain gitleaks $GITLEAKS_VERSION for $os/$arch (offline, curl missing or unsupported platform)."
  fi
fi

repo_root=$(git rev-parse --show-toplevel)
exec "$bin" "$@" --config "$repo_root/.gitleaks.toml" \
  --gitleaks-ignore-path "$repo_root/.gitleaksignore"
