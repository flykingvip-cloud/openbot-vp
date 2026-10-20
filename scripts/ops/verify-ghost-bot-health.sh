#!/usr/bin/env bash
# Verify daniel CEO seat stays at 5 active owned agents and ghost bot "bot" stays revoked.
# Usage: verify-ghost-bot-health.sh [--user-id UUID] [--tenant 001]
set -euo pipefail

USER_ID="${1:-90fed19a-1c8b-4420-87e0-bcc6165e32fa}"
TENANT_ID="${2:-001}"
STATE_DIR="${OPENBOT_STATE_DIR:-${OPENCLAW_STATE_DIR:-$HOME/.openbot}}"

if [[ "${1:-}" == "--user-id" ]]; then
  USER_ID="${2:?missing user id}"
  TENANT_ID="${4:-001}"
fi

OWN_FILE="$STATE_DIR/organization/ownerships.json"
AGENT_DIR="$STATE_DIR/tenants/$TENANT_ID/users/$USER_ID/state/agents/bot"
EXPECTED=(main panda bot-2 bot--agent bot-skill)

if [[ ! -f "$OWN_FILE" ]]; then
  echo "FAIL ownership store missing: $OWN_FILE" >&2
  exit 2
fi

readarray -t ACTIVE < <(
  python3 - "$OWN_FILE" "$TENANT_ID" "$USER_ID" <<'PY'
import json, sys
path, tenant, user = sys.argv[1:4]
store = json.load(open(path))
active = sorted(
    r["subjectId"]
    for r in store.get("records", {}).values()
    if r.get("tenantId") == tenant
    and r.get("subjectKind") == "agent"
    and r.get("bindingStatus") == "active"
    and r.get("currentManagerUserId") == user
)
print("\n".join(active))
PY
)

BOT_STATUS="$(
  python3 - "$OWN_FILE" "$TENANT_ID" <<'PY'
import json, sys
store = json.load(open(sys.argv[1]))
rec = store.get("records", {}).get(f"{sys.argv[2]}:agent:bot")
print(rec.get("bindingStatus") if rec else "missing")
PY
)"

FAIL=0
if [[ "${#ACTIVE[@]}" -ne 5 ]]; then
  echo "FAIL active owned count=${#ACTIVE[@]} expected=5 got: ${ACTIVE[*]-}" >&2
  FAIL=1
fi

for id in "${EXPECTED[@]}"; do
  found=0
  for active_id in "${ACTIVE[@]}"; do
    if [[ "$active_id" == "$id" ]]; then
      found=1
      break
    fi
  done
  if [[ "$found" -eq 0 ]]; then
    echo "FAIL missing expected active agent: $id" >&2
    FAIL=1
  fi
done

if [[ "$BOT_STATUS" != "revoked" ]]; then
  echo "FAIL ghost bot ownership status=$BOT_STATUS expected=revoked" >&2
  FAIL=1
fi

if [[ -d "$AGENT_DIR" ]]; then
  echo "FAIL ghost agent dir recreated: $AGENT_DIR" >&2
  FAIL=1
fi

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi

echo "OK ghost-bot health: active=${ACTIVE[*]} bot=$BOT_STATUS agent_dir_absent"
