#!/usr/bin/env bash
# Provision minimal tenant directory skeletons for staging MULTITENANT smoke prep.
# Does NOT enable OPENBOT_MULTITENANT or migrate global stores — layout only.
set -euo pipefail

TENANTS_ROOT="${OPENBOT_TENANTS_ROOT:-/root/.openbot/tenants}"
# Must match platform-auth membership enterpriseId (not slug). Staging defaults: upbeyond + workspace-2.
TENANT_A="${OPENBOT_SMOKE_TENANT_A:-001}"
TENANT_B="${OPENBOT_SMOKE_TENANT_B:-workspace-2-87217301}"

provision_one() {
  local tid="$1"
  local root="${TENANTS_ROOT}/${tid}"
  mkdir -p "${root}/control-plane" "${root}/shared" "${root}/users"
  if [ ! -f "${root}/control-plane/seat-assets.json" ]; then
    printf '{"version":4,"seats":{}}\n' >"${root}/control-plane/seat-assets.json"
  fi
  echo "provisioned ${tid} -> ${root}"
}

echo "== staging-tenant-provision-minimal =="
echo "tenants_root=${TENANTS_ROOT}"
mkdir -p "${TENANTS_ROOT}"
provision_one "${TENANT_A}"
provision_one "${TENANT_B}"
echo "Done. Next: tenant-import or platform.tenant.import.* for real slices, then MULTITENANT smoke."
