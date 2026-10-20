#!/usr/bin/env bash
# Smoke the loopback device digital-human stub: grant, camera turn, fixture pull, cancel, revoke.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"
CONFIG="${OPENBOT_DEVICE_DH_STUB_CONFIG:-$DIR/stub-clients.sample.json}"
PORT="${OPENBOT_DEVICE_DH_STUB_PORT:-8787}"
LOG="$(mktemp)"
ERR="$(mktemp)"

cleanup() {
  if [[ -n "${PID:-}" ]]; then
    kill "$PID" >/dev/null 2>&1 || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -f "$LOG" "$ERR"
}
trap cleanup EXIT

cd "$ROOT"
export OPENBOT_DEVICE_DH_STUB=1
export OPENBOT_DEVICE_DH_STUB_CONFIG="$CONFIG"
export OPENBOT_DEVICE_DH_STUB_PORT="$PORT"

if command -v pnpm >/dev/null 2>&1 && [[ -x "$ROOT/node_modules/.bin/tsx" || -d "$ROOT/node_modules/tsx" ]]; then
  pnpm exec tsx src/integrations/device-digital-human/stub-server.ts >"$LOG" 2>"$ERR" &
else
  node --import tsx src/integrations/device-digital-human/stub-server.ts >"$LOG" 2>"$ERR" &
fi
PID=$!

URL=""
for _ in $(seq 1 100); do
  if grep -q "listening on http://127.0.0.1:" "$LOG"; then
    URL="$(grep -o 'http://127.0.0.1:[0-9]*' "$LOG" | head -n 1)"
    break
  fi
  if ! kill -0 "$PID" >/dev/null 2>&1; then
    echo "stub exited early" >&2
    cat "$ERR" >&2 || true
    exit 1
  fi
  sleep 0.1
done

if [[ -z "$URL" ]]; then
  echo "stub did not print a listen address" >&2
  cat "$ERR" >&2 || true
  exit 1
fi

if command -v pnpm >/dev/null 2>&1 && [[ -d "$ROOT/node_modules/tsx" ]]; then
  pnpm exec tsx src/integrations/device-digital-human/examples/rehearse-cli.ts "$URL"
else
  node --import tsx src/integrations/device-digital-human/examples/rehearse-cli.ts "$URL"
fi
