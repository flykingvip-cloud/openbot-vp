#!/usr/bin/env bash
# Build minimal tenant-import packages locally and import them on the staging gateway host.
# Uses real platform-auth enterpriseId values (membership authority), not slug aliases.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
STAGING_HOST="${STAGING_HOST:-root@8.217.93.71}"
CONTAINER="${OPENBOT_GATEWAY_CONTAINER:-openbot-gateway-rc}"
TENANTS_ROOT="${OPENBOT_TENANTS_ROOT:-/root/.openbot/tenants}"
PKG_DIR_ON_HOST="${OPENBOT_TENANT_IMPORT_PKG_DIR:-/root/.openbot/tenant-import-pkgs}"
TENANT_A="${OPENBOT_SMOKE_TENANT_A:-001}"
TENANT_B="${OPENBOT_SMOKE_TENANT_B:-workspace-2-87217301}"
JOB_PREFIX="${OPENBOT_SMOKE_IMPORT_JOB_PREFIX:-staging-smoke-20260713}"

RUNTIME=podman
command -v podman >/dev/null 2>&1 || RUNTIME=docker

LOCAL_PKG_DIR="$(mktemp -d)"
cleanup() { rm -rf "$LOCAL_PKG_DIR"; }
trap cleanup EXIT

echo "== staging-tenant-import-smoke-prep =="
echo "staging=$STAGING_HOST tenant_a=$TENANT_A tenant_b=$TENANT_B"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun required locally to build packages" >&2
  exit 1
fi

bun "$ROOT/scripts/staging-tenant-import-smoke-prep.ts" \
  --out-dir "$LOCAL_PKG_DIR" \
  --tenant-a "$TENANT_A" \
  --tenant-b "$TENANT_B"

ssh -o BatchMode=yes "$STAGING_HOST" "mkdir -p '$PKG_DIR_ON_HOST'"
scp -q "$LOCAL_PKG_DIR/${TENANT_A}.zip" "$LOCAL_PKG_DIR/${TENANT_B}.zip" \
  "$STAGING_HOST:$PKG_DIR_ON_HOST/"

import_one() {
  local tid="$1"
  local job_id="${JOB_PREFIX}-${tid}"
  local archive="${PKG_DIR_ON_HOST}/${tid}.zip"
  echo "-- import $tid (job=$job_id) --"
  ssh -o BatchMode=yes "$STAGING_HOST" "$RUNTIME exec -u 0 '$CONTAINER' node /app/openbot.mjs platform tenant-provision --tenant '$tid' --tenants-root '$TENANTS_ROOT'"
  ssh -o BatchMode=yes "$STAGING_HOST" "$RUNTIME exec -u 0 '$CONTAINER' node /app/openbot.mjs platform tenant-import run --archive '$archive' --target '$tid' --tenants-root '$TENANTS_ROOT' --job-id '$job_id'"
}

import_one "$TENANT_A"
import_one "$TENANT_B"

echo ""
echo "Verify on host:"
echo "  ls -la $TENANTS_ROOT/$TENANT_A/control-plane/"
echo "  ls -la $TENANTS_ROOT/$TENANT_B/control-plane/"
echo "Next: staging-multitenant-smoke.sh, then short OPENBOT_MULTITENANT=1 window per smoke-checklist.md"
