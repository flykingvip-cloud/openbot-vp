#!/usr/bin/env bash
set -euo pipefail

cd /repo

export OPENBOT_STATE_DIR="/tmp/openbot-test"
export OPENBOT_CONFIG_PATH="${OPENBOT_STATE_DIR}/openbot.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${OPENBOT_STATE_DIR}/credentials"
mkdir -p "${OPENBOT_STATE_DIR}/agents/main/sessions"
echo '{}' >"${OPENBOT_CONFIG_PATH}"
echo 'creds' >"${OPENBOT_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${OPENBOT_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm openbot reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${OPENBOT_CONFIG_PATH}"
test ! -d "${OPENBOT_STATE_DIR}/credentials"
test ! -d "${OPENBOT_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${OPENBOT_STATE_DIR}/credentials"
echo '{}' >"${OPENBOT_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm openbot uninstall --state --yes --non-interactive

test ! -d "${OPENBOT_STATE_DIR}"

echo "OK"
