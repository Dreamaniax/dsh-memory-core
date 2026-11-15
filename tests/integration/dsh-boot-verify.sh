#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="${DSH_APP:-/Applications/DeepSeek Harness.app}"
ELECTRON="$APP/Contents/MacOS/DeepSeek Harness"
DSH_ASAR="$APP/Contents/Resources/app.asar"
DSH_BIN="$DSH_ASAR/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"

if [[ ! -x "$ELECTRON" || ! -e "$DSH_ASAR" ]]; then
  echo "DSH boot verify: DSH app not found at $APP" >&2
  echo "Set DSH_APP to the DeepSeek Harness.app directory." >&2
  exit 77
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/dsh-memory-core-boot.XXXXXX")"
DSH_HOME="$TMP/dsh-home"
EVIDENCE="$TMP/evidence"
SERVER_PID=""
mkdir -p "$EVIDENCE"

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ "${KEEP_DSH_BOOT_ARTIFACTS:-0}" != "1" ]]; then
    rm -rf "$TMP"
  else
    echo "DSH boot verify artifacts kept at $TMP"
  fi
}
trap cleanup EXIT

run_dsh() {
  DSH_HOME="$DSH_HOME" ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$DSH_BIN" "$@"
}

wait_for_file() {
  local file="$1" log="$2" i
  for i in $(seq 1 120); do
    if [[ -f "$file" ]]; then return 0; fi
    if [[ -n "$SERVER_PID" ]] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "DSH exited before writing $file" >&2
      cat "$log" >&2 || true
      return 1
    fi
    sleep 0.5
  done
  echo "timed out waiting for $file" >&2
  cat "$log" >&2 || true
  return 1
}

start_server() {
  local phase="$1" log="$2"
  DSH_HOME="$DSH_HOME" MEMORY_CORE_PROBE_PHASE="$phase" MEMORY_CORE_PROBE_DIR="$EVIDENCE" ELECTRON_RUN_AS_NODE=1     "$ELECTRON" "$DSH_BIN" web --no-open --port 0 >"$log" 2>&1 &
  SERVER_PID=$!
}

stop_server() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}

run_dsh web --help >"$TMP/scaffold.log" 2>&1
node "$ROOT/tests/integration/dsh-boot-prepare.mjs" "$ROOT" "$DSH_HOME"

start_server write "$TMP/write.log"
wait_for_file "$EVIDENCE/write.json" "$TMP/write.log"
stop_server
if grep -q "skipping profile bundle" "$TMP/write.log"; then
  echo "profile bundle was skipped" >&2
  cat "$TMP/write.log" >&2
  exit 1
fi
if grep -q "did not activate" "$TMP/write.log"; then
  echo "a profile entry did not activate" >&2
  cat "$TMP/write.log" >&2
  exit 1
fi

start_server read "$TMP/read.log"
wait_for_file "$EVIDENCE/read.json" "$TMP/read.log"
stop_server
if grep -q "skipping profile bundle" "$TMP/read.log"; then
  echo "profile bundle was skipped on restart" >&2
  cat "$TMP/read.log" >&2
  exit 1
fi
if grep -q "did not activate" "$TMP/read.log"; then
  echo "a profile entry did not activate on restart" >&2
  cat "$TMP/read.log" >&2
  exit 1
fi

node "$ROOT/tests/integration/check-dsh-evidence.mjs" "$EVIDENCE" "$DSH_HOME"
echo "DSH mount verification passed"
