#!/usr/bin/env bash
# Pull staging platform-auth + run live membership→path probe locally (no passwords).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
STAGING_HOST="${STAGING_HOST:-root@8.217.93.71}"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

TENANT_A="${OPENBOT_SMOKE_TENANT_A:-001}"
TENANT_B="${OPENBOT_SMOKE_TENANT_B:-workspace-2-87217301}"
TENANTS_ROOT="${OPENBOT_TENANTS_ROOT:-/root/.openbot/tenants}"

echo "== staging-live-tenant-addressing-probe =="
scp -q "$STAGING_HOST:/root/.openbot/openbot-platform-auth.json" "$SCRATCH/platform-auth.json"
scp -q "$STAGING_HOST:/root/.openbot/openbot.json" "$SCRATCH/openbot.json" 2>/dev/null || true

export OPENBOT_MULTITENANT=1
export OPENBOT_TENANTS_ROOT="$TENANTS_ROOT"
export OPENBOT_CONFIG_PATH="$SCRATCH/openbot.json"
export OPENBOT_STATE_DIR="$SCRATCH"
cp "$SCRATCH/platform-auth.json" "$SCRATCH/openbot-platform-auth.json"

python3 - "$SCRATCH/openbot.json" "$SCRATCH/openbot-platform-auth.json" <<'PY'
import json, sys
cfg_path, store_path = sys.argv[1:3]
with open(cfg_path) as f:
    cfg = json.load(f)
tp = cfg.setdefault("gateway", {}).setdefault("auth", {}).setdefault("trustedProxy", {})
pa = tp.setdefault("platformAuth", {})
pa["enabled"] = True
pa["store"] = store_path
cfg.setdefault("data", {})["mode"] = "managed"
with open(cfg_path, "w") as f:
    json.dump(cfg, f)
PY

bun "$ROOT/scripts/staging-live-tenant-addressing-probe.ts" \
  --platform-auth "$SCRATCH/platform-auth.json" \
  --tenant-a "$TENANT_A" \
  --tenant-b "$TENANT_B"
