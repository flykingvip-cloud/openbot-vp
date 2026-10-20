#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../apps/macos"

BUILD_PATH=".build-local"
DISPLAY_PRODUCT="${DISPLAY_PRODUCT:-OpenBot}"
PRODUCT="${PRODUCT:-$(sed -n 's/.*\.executable(name: "\([^"]*\)".*/\1/p' Package.swift | head -n 1)}"
if [[ -z "$PRODUCT" ]]; then
  echo "ERROR: Could not detect macOS executable product from Package.swift" >&2
  exit 1
fi
BIN="$BUILD_PATH/debug/$PRODUCT"

printf "\n▶️  Building %s (debug, build path: %s)\n" "$DISPLAY_PRODUCT" "$BUILD_PATH"
swift build -c debug --product "$PRODUCT" --build-path "$BUILD_PATH"

printf "\n⏹  Stopping existing %s...\n" "$DISPLAY_PRODUCT"
killall -q "$PRODUCT" 2>/dev/null || true

printf "\n🚀 Launching $BIN ...\n"
nohup "$BIN" >/tmp/openbot.log 2>&1 &
PID=$!
printf "Started %s (PID %s). Logs: /tmp/openbot.log\n" "$DISPLAY_PRODUCT" "$PID"
