#!/usr/bin/env bash
# Fail closed when seat-granted legacy agents lack Registry assets (Managed Enterprise).
# Run after gateway cutover on production hosts.
#
# Usage:
#   OPENBOT_STATE_DIR=/root/.openbot \
#   OPENBOT_TENANTS_ROOT=/root/openbot-tenants \
#   TENANT_ID=001 \
#   ./deploy/production/scripts/gate-seat-registry.sh
set -euo pipefail

STATE_DIR="${OPENBOT_STATE_DIR:-/root/.openbot}"
TENANTS_ROOT="${OPENBOT_TENANTS_ROOT:-/root/openbot-tenants}"
TENANT_ID="${TENANT_ID:-001}"

REGISTRY="${STATE_DIR}/openbot-agent-registry.json"
SEAT_ASSETS="${TENANTS_ROOT}/${TENANT_ID}/control-plane/seat-assets.json"

if [ ! -f "$REGISTRY" ]; then
  echo "FAIL registry missing: $REGISTRY" >&2
  exit 1
fi
if [ ! -f "$SEAT_ASSETS" ]; then
  echo "FAIL seat-assets missing: $SEAT_ASSETS" >&2
  exit 1
fi

python3 <<PY
import json, os, sys

tenant_id = os.environ["TENANT_ID"]
registry_path = os.environ["REGISTRY"]
seat_path = os.environ["SEAT_ASSETS"]

reg = json.load(open(registry_path))
known = {v.get("legacyAgentId") for v in reg.get("assets", {}).values()}
store = json.load(open(seat_path))
missing = set()
for seat in store.get("seats", {}).values():
    if seat.get("tenantId") != tenant_id:
        continue
    for aid in seat.get("defaultAgentAssetIds") or []:
        aid = (aid or "").strip()
        if aid and aid not in known and not aid.startswith("steward"):
            missing.add(aid)
if missing:
    print("FAIL missing registry for seat agents:", sorted(missing))
    sys.exit(1)
print("OK all seat agents in registry for tenant", tenant_id)
PY
