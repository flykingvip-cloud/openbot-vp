#!/usr/bin/env bash
# OpenBot ↔ device-control joint helper.
# Default mode runs the in-repo harness (injectable fake) and prints JOINT_PENDING.
# It does not claim a live or hardware pass.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"

DEVICE_CONTROL_BASE_URL="${DEVICE_CONTROL_BASE_URL:-http://127.0.0.1:8791}"
OPENBOT_BASE_URL="${OPENBOT_BASE_URL:-http://127.0.0.1:18789}"
MODE="${OPENBOT_DEVICE_PLATFORM_JOINT:-harness}"

if [[ "${1:-}" == "--print" ]]; then
  MODE="print"
fi

origin_host() {
  printf '%s\n' "$1" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+).*#\1#'
}

assert_separate_origins() {
  local control_host openbot_host
  control_host="$(origin_host "$DEVICE_CONTROL_BASE_URL")"
  openbot_host="$(origin_host "$OPENBOT_BASE_URL")"
  if [[ "$control_host" == "$openbot_host" ]]; then
    echo "JOINT_PENDING prefix collision: connector baseURL must not be the OpenBot host" >&2
    echo "device-control default http://127.0.0.1:8791" >&2
    exit 2
  fi
}

print_sequence() {
  cat <<EOF
# Device-control origin. Do not use the OpenBot gateway here.
DEVICE_CONTROL_BASE_URL=${DEVICE_CONTROL_BASE_URL}
OPENBOT_BASE_URL=${OPENBOT_BASE_URL}

# Admin register + health. Connector baseURL is device-control, not the OpenBot host.
# Gateway admin routes stay on OPENBOT_BASE_URL. Grant exchange stays on the stub.
STUB_BASE_URL=\${OPENBOT_DEVICE_DH_STUB_URL:-http://127.0.0.1:8787}

curl -sS --max-time 5 \\
  -H "cookie: \${OPENBOT_SESSION_COOKIE}" \\
  -X POST \\
  "\${OPENBOT_BASE_URL}/api/device-platform/v1/admin/connections/plat-local/test"

curl -sS --max-time 3 \\
  -u "\${OPENBOT_STUB_SERVICE_USER}:\${OPENBOT_STUB_SERVICE_PASSWORD}" \\
  "\${DEVICE_CONTROL_BASE_URL}/api/device-platform/v1/health"

curl -sS --max-time 3 \\
  -u "\${OPENBOT_STUB_SERVICE_USER}:\${OPENBOT_STUB_SERVICE_PASSWORD}" \\
  "\${DEVICE_CONTROL_BASE_URL}/api/device-platform/v1/capabilities"

curl -sS --max-time 3 \\
  -u "\${OPENBOT_STUB_SERVICE_USER}:\${OPENBOT_STUB_SERVICE_PASSWORD}" \\
  -H 'content-type: application/json' \\
  -d '{"deviceId":"cam-1"}' \\
  "\${DEVICE_CONTROL_BASE_URL}/api/device-platform/v1/pair-challenges"

curl -sS --max-time 5 \\
  -H "cookie: \${OPENBOT_SESSION_COOKIE}" \\
  "\${OPENBOT_BASE_URL}/api/device-platform/v1/me/devices"

curl -sS --max-time 5 \\
  -H "cookie: \${OPENBOT_SESSION_COOKIE}" \\
  "\${OPENBOT_BASE_URL}/api/device-platform/v1/me/digital-humans/dh-a/devices"

curl -sS --max-time 10 \\
  -H "cookie: \${OPENBOT_SESSION_COOKIE}" \\
  -H 'content-type: application/json' \\
  -d '{"operationId":"op-add-1","kind":"add","platformId":"plat-local","externalDeviceId":"cam-1","digitalHumanId":"dh-a","scopes":["chat"],"pairing":{"challenge":"pch_from_platform","proof":"000000"}}' \\
  "\${OPENBOT_BASE_URL}/api/device-platform/v1/me/operations"

curl -sS --max-time 10 \\
  -H "cookie: \${OPENBOT_SESSION_COOKIE}" \\
  -H 'content-type: application/json' \\
  -d '{"operationId":"op-rebind-1","kind":"rebind","deviceId":"DEVICE_ID","digitalHumanId":"dh-b","scopes":["chat"]}' \\
  "\${OPENBOT_BASE_URL}/api/device-platform/v1/me/operations"

curl -sS --max-time 10 \\
  -H "cookie: \${OPENBOT_SESSION_COOKIE}" \\
  -H 'content-type: application/json' \\
  -d '{"operationId":"op-revoke-1","kind":"revoke","deviceId":"DEVICE_ID"}' \\
  "\${OPENBOT_BASE_URL}/api/device-platform/v1/me/operations"

# After exchange, device-control GET \${STUB_BASE_URL}/api/integrations/v1/grants/{authorizationRef}
# with service Basic and X-OpenBot-Grant-Credential.
# Rebind keeps that authorizationRef. Revoke makes the next GET status revoked.
# A later capability call with the old credential fails. Old auth cannot execute.
# Voice and photo are stub-only in this printout. 真机 stays PENDING.
# Password source: docs/integrations/device-digital-human/staging.md
# Do not commit values. grayRelease=false. JOINT_PENDING cross-host hardware.
EOF
}

probe_live() {
  assert_separate_origins
  if [[ -z "${OPENBOT_STUB_SERVICE_USER:-}" || -z "${OPENBOT_STUB_SERVICE_PASSWORD:-}" ]]; then
    echo "JOINT_PENDING set OPENBOT_STUB_SERVICE_USER and OPENBOT_STUB_SERVICE_PASSWORD in the operator environment"
    echo "password source: docs/integrations/device-digital-human/staging.md"
    exit 2
  fi
  local health
  if ! health="$(curl -sS --max-time 3 -u "${OPENBOT_STUB_SERVICE_USER}:${OPENBOT_STUB_SERVICE_PASSWORD}" \
    "${DEVICE_CONTROL_BASE_URL}/api/device-platform/v1/health")"; then
    echo "JOINT_PENDING device-control health failed at ${DEVICE_CONTROL_BASE_URL}"
    exit 2
  fi
  if [[ "$health" != *'"grayRelease":false'* && "$health" != *'"grayRelease": false'* ]]; then
    echo "JOINT_PENDING device-control health is not the v1 freeze"
    exit 2
  fi
  echo "device-control loopback health ok"
  echo "JOINT_PENDING me add rebind revoke and hardware are not recorded"
  exit 2
}

case "$MODE" in
  print)
    assert_separate_origins
    print_sequence
    ;;
  harness)
    assert_separate_origins
    cd "$ROOT"
    # Prefer hermetic node --import tsx (Vitest HOME isolation breaks Corepack pnpm).
    node --import tsx src/integrations/device-platform/examples/joint-cli.ts
    ;;
  live)
    probe_live
    ;;
  *)
    echo "JOINT_PENDING unknown OPENBOT_DEVICE_PLATFORM_JOINT=$MODE" >&2
    exit 2
    ;;
esac
