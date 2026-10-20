#!/usr/bin/env bash
# Simulate post-login L2 writes under membership-resolved user dirs (no browser).
set -euo pipefail

STAGING_HOST="${STAGING_HOST:-root@8.217.93.71}"
TENANTS_ROOT="${OPENBOT_TENANTS_ROOT:-/root/.openbot/tenants}"
TENANT_A="${OPENBOT_SMOKE_TENANT_A:-001}"
TENANT_B="${OPENBOT_SMOKE_TENANT_B:-workspace-2-87217301}"
USER_A="${OPENBOT_SMOKE_USER_A:-90fed19a-1c8b-4420-87e0-bcc6165e32fa}"
USER_B="${OPENBOT_SMOKE_USER_B:-eee8cbfc-cc35-429a-8e72-f6a879f0be06}"
MARKER="mt-smoke-$(date +%Y%m%d%H%M%S).txt"

ssh -o BatchMode=yes "$STAGING_HOST" bash -s <<REMOTE
set -euo pipefail
TENANTS_ROOT='$TENANTS_ROOT'
TENANT_A='$TENANT_A'
TENANT_B='$TENANT_B'
USER_A='$USER_A'
USER_B='$USER_B'
MARKER='$MARKER'

write_marker() {
  local tid="\$1" uid="\$2" label="\$3"
  local ws="\${TENANTS_ROOT}/\${tid}/users/\${uid}/OpenBot/agents/main/workspace"
  mkdir -p "\$ws"
  echo "tenant=\${tid} user=\${uid} label=\${label} ts=\$(date -Iseconds)" >"\${ws}/\${MARKER}"
  echo "wrote \${ws}/\${MARKER}"
}

write_marker "\$TENANT_A" "\$USER_A" "tenant-a"
write_marker "\$TENANT_B" "\$USER_B" "tenant-b"

# Cross-tenant negative: B user tree must not contain A marker name
if find "\${TENANTS_ROOT}/\${TENANT_B}/users" -name "\${MARKER}" | grep -q .; then
  if grep -q 'label=tenant-a' "\${TENANTS_ROOT}/\${TENANT_B}/users"/*/*/OpenBot/agents/main/workspace/"\${MARKER}" 2>/dev/null; then
    echo "FAIL cross-tenant marker visible under tenant B"
    exit 1
  fi
fi
test ! -f "\${TENANTS_ROOT}/\${TENANT_B}/users/\${USER_A}/OpenBot/agents/main/workspace/\${MARKER}"
test ! -f "\${TENANTS_ROOT}/\${TENANT_A}/users/\${USER_B}/OpenBot/agents/main/workspace/\${MARKER}"
echo "PASS cross-tenant negative (markers scoped to membership user dirs)"
REMOTE
