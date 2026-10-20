#!/usr/bin/env bash
# Scheduled enterprise knowledge projection multi-tenant soak gate (residual risk A).
#
# Modes (OPENBOT_SOAK_MODE):
#   simulate          — offline harness; no live gateway required (default)
#   inspect-selftest  — seed + tick + inspect (CI-safe inspect path)
#   all               — simulate + inspect-selftest
#   inspect           — live OPENBOT_TENANTS_ROOT + schedule cursor after maintenance ticks
#
# Usage:
#   bash deploy/production/scripts/staging-scheduled-projection-soak.sh
#   OPENBOT_SOAK_MODE=all bash deploy/production/scripts/staging-scheduled-projection-soak.sh
#   OPENBOT_SOAK_MODE=inspect OPENBOT_TENANTS_ROOT=/root/.openbot/tenants \
#     bash deploy/production/scripts/staging-scheduled-projection-soak.sh
#
# Optional env:
#   OPENBOT_SOAK_MODE=simulate|inspect|inspect-selftest|all
#   OPENBOT_SOAK_TENANT_COUNT=3
#   OPENBOT_TENANTS_ROOT=/path/to/tenants
#   OPENBOT_SCHEDULE_CURSOR_PATH=/path/to/enterprise-knowledge-schedule-cursor.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

MODE="${OPENBOT_SOAK_MODE:-simulate}"
export OPENBOT_SOAK_MODE="$MODE"
echo "== staging-scheduled-projection-soak.sh mode=${MODE} =="

if command -v node >/dev/null 2>&1; then
  node --import tsx scripts/staging-scheduled-projection-soak.ts
  exit $?
fi

if command -v bun >/dev/null 2>&1; then
  bun scripts/staging-scheduled-projection-soak.ts
  exit $?
fi

echo "FAIL  need node (with tsx) or bun to run soak harness"
exit 1
