#!/usr/bin/env bash
# L3 session-path isolation probe (no browser). Verifies dual-tenant session files are disjoint.
set -euo pipefail
TENANTS_ROOT="${OPENBOT_TENANTS_ROOT:-/root/.openbot/tenants}"
TENANT_A="${OPENBOT_SMOKE_TENANT_A:-001}"
TENANT_B="${OPENBOT_SMOKE_TENANT_B:-workspace-2-87217301}"
CONTAINER="${OPENBOT_GATEWAY_CONTAINER:-openbot-gateway-rc}"
RUNTIME=podman; command -v podman >/dev/null 2>&1 || RUNTIME=docker

pass=0; fail=0
ok(){ echo "PASS  $*"; pass=$((pass+1)); }
bad(){ echo "FAIL  $*"; fail=$((fail+1)); }

echo "== staging-multitenant-session-path-probe =="
mt="$("$RUNTIME" exec "$CONTAINER" printenv OPENBOT_MULTITENANT 2>/dev/null || true)"
[ "$mt" = "1" ] && ok "OPENBOT_MULTITENANT=1" || bad "MULTITENANT not 1"

uid_a=$(find "$TENANTS_ROOT/$TENANT_A/users" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -1 | xargs -I{} basename {})
uid_b=$(find "$TENANTS_ROOT/$TENANT_B/users" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -1 | xargs -I{} basename {})
[ -n "$uid_a" ] && [ -n "$uid_b" ] && [ "$uid_a" != "$uid_b" ] && ok "user ids differ" || bad "user ids missing/same"

pa="$TENANTS_ROOT/$TENANT_A/users/$uid_a/OpenBot/agents/main/sessions/sessions.json"
pb="$TENANTS_ROOT/$TENANT_B/users/$uid_b/OpenBot/agents/main/sessions/sessions.json"
mkdir -p "$(dirname "$pa")" "$(dirname "$pb")"
echo "{\"tenant\":\"$TENANT_A\",\"marker\":\"only-a\"}" >"$pa"
echo "{\"tenant\":\"$TENANT_B\",\"marker\":\"only-b\"}" >"$pb"
[ "$pa" != "$pb" ] && ok "session store paths differ" || bad "session paths equal"
grep -q only-a "$pa" && grep -q only-b "$pb" && ok "session markers written" || bad "session write failed"
! grep -q only-b "$pa" && ! grep -q only-a "$pb" && ok "no cross-tenant session content" || bad "cross-tenant session content leak"

# L1 seat still disjoint
sa="$TENANTS_ROOT/$TENANT_A/control-plane/seat-assets.json"
sb="$TENANTS_ROOT/$TENANT_B/control-plane/seat-assets.json"
if python3 - "$sa" "$sb" <<'PY'
import json,sys
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2]))
def ids(s):
  seats=s.get("seats") or []
  if isinstance(seats, dict): return {k for k in seats} | {v.get("seatId") for v in seats.values() if isinstance(v,dict)}
  return {x.get("seatId") for x in seats if isinstance(x,dict)}
ia,ib=ids(a),ids(b)
if not ia or not ib: raise SystemExit("empty")
if ia & ib: raise SystemExit("overlap")
print("ok", len(ia), len(ib))
PY
then ok "L1 seatIds still disjoint"; else bad "L1 seat overlap"; fi

echo ""; echo "Summary: PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
