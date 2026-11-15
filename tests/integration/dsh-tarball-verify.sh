#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CACHE="${MEMORY_CORE_NPM_CACHE:-$ROOT/.tmp/npm-cache}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dsh-memory-core-tarball.XXXXXX")"
CLEAN="$TMP/src"
mkdir -p "$CLEAN" "$CACHE"

# Keep every npm invocation, including npm pack and npm run, away from the
# user's global cache. A polluted global cache must not decide this gate.
export npm_config_cache="$CACHE"

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "tarball gate: clean source = git archive HEAD"
git -C "$ROOT" archive --format=tar HEAD | tar -x -C "$CLEAN"

echo "tarball gate: npm ci"
npm ci --prefix "$CLEAN" --ignore-scripts --no-audit --no-fund --prefer-offline --fetch-retries=2 --fetch-timeout=60000 --cache "$CACHE" >"$TMP/npm-ci.log" 2>&1
echo "tarball gate: npm run build"
npm run build --prefix "$CLEAN" >"$TMP/build.log" 2>&1

echo "tarball gate: npm pack"
(cd "$CLEAN" && npm pack --pack-destination "$TMP" >"$TMP/pack.log" 2>&1)
TARBALL="$(find "$TMP" -maxdepth 1 -name '*.tgz' -print -quit)"
if [[ -z "$TARBALL" ]]; then
  echo "npm pack did not produce a tarball" >&2
  cat "$TMP/pack.log" >&2 || true
  exit 1
fi

node "$CLEAN/tests/integration/check-tarball.mjs" "$TARBALL" "$TMP/unpacked"

echo "tarball gate: isolated DSH mount from tarball"
MEMORY_CORE_TARBALL="$TARBALL" MEMORY_CORE_NPM_CACHE="$CACHE" bash "$CLEAN/tests/integration/dsh-boot-verify.sh"
echo "tarball release gate passed"
