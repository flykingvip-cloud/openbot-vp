#!/usr/bin/env bash
# Staging multi-tenant smoke (operator-run on gateway host).
# Prerequisites: B4 RC image, managed data.mode, platform-auth with >=2 enterprises.
# Does NOT flip OPENBOT_MULTITENANT permanently — uses a subshell probe when requested.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONTAINER="${OPENBOT_GATEWAY_CONTAINER:-openbot-gateway-rc}"
ENV_FILE="${OPENBOT_ENV_FILE:-/root/.openbot/.env.docker}"
TENANTS_ROOT="${OPENBOT_TENANTS_ROOT:-/root/.openbot/tenants}"

pass=0
fail=0

ok() { echo "PASS  $*"; pass=$((pass + 1)); }
bad() { echo "FAIL  $*"; fail=$((fail + 1)); }

echo "== staging-multitenant-smoke =="
echo "container=$CONTAINER tenants_root=$TENANTS_ROOT"

if ! command -v podman >/dev/null 2>&1 && ! command -v docker >/dev/null 2>&1; then
  echo "Need podman or docker on host" >&2
  exit 1
fi
RUNTIME=podman
command -v podman >/dev/null 2>&1 || RUNTIME=docker

if ! "$RUNTIME" ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  bad "container $CONTAINER not running"
  echo "Summary: PASS=$pass FAIL=$fail"
  exit 1
fi
ok "gateway container running"

code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:18789/healthz || true)"
if [ "$code" = "200" ]; then ok "healthz HTTP 200"; else bad "healthz HTTP $code"; fi

mt="$("$RUNTIME" exec "$CONTAINER" printenv OPENBOT_MULTITENANT 2>/dev/null || true)"
if [ -z "$mt" ]; then
  ok "OPENBOT_MULTITENANT unset (default single-tenant managed)"
else
  echo "NOTE  OPENBOT_MULTITENANT=$mt"
fi

if [ -d "$TENANTS_ROOT" ]; then
  count="$(find "$TENANTS_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
  ok "tenants root exists ($count tenant dirs)"
else
  bad "tenants root missing ($TENANTS_ROOT) — import/provision before MULTITENANT=1 cutover"
fi

if [ -f "$ROOT/scripts/check-tenant-addressing.mjs" ]; then
  if node "$ROOT/scripts/check-tenant-addressing.mjs" >/dev/null 2>&1; then
    ok "check-tenant-addressing.mjs"
  else
    bad "check-tenant-addressing.mjs"
  fi
fi

echo ""
echo "Manual gates (not automated here):"
echo "  - Tenant A admin login → L1 write under tenants/<tid-A>/"
echo "  - Tenant B admin login → L1 write under tenants/<tid-B>/"
echo "  - Cross-tenant negative on sessions.json + seat-assets"
echo "  - Only then set OPENBOT_MULTITENANT=1 in $ENV_FILE and restart $CONTAINER"
echo ""
echo "Summary: PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
