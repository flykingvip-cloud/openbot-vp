#!/usr/bin/env bash
# Data-level dual-tenant isolation probe (no browser login required).
# Run on the staging gateway host while OPENBOT_MULTITENANT=1.
set -euo pipefail

CONTAINER="${OPENBOT_GATEWAY_CONTAINER:-openbot-gateway-rc}"
TENANTS_ROOT="${OPENBOT_TENANTS_ROOT:-/root/.openbot/tenants}"
TENANT_A="${OPENBOT_SMOKE_TENANT_A:-001}"
TENANT_B="${OPENBOT_SMOKE_TENANT_B:-workspace-2-87217301}"

RUNTIME=podman
command -v podman >/dev/null 2>&1 || RUNTIME=docker

pass=0
fail=0
ok() { echo "PASS  $*"; pass=$((pass + 1)); }
bad() { echo "FAIL  $*"; fail=$((fail + 1)); }

echo "== staging-multitenant-addressing-probe =="
echo "tenant_a=$TENANT_A tenant_b=$TENANT_B"

mt="$("$RUNTIME" exec "$CONTAINER" printenv OPENBOT_MULTITENANT 2>/dev/null || true)"
if [ "$mt" = "1" ]; then ok "OPENBOT_MULTITENANT=1"; else bad "OPENBOT_MULTITENANT not 1 (got: ${mt:-unset})"; fi

seat_a="${TENANTS_ROOT}/${TENANT_A}/control-plane/seat-assets.json"
seat_b="${TENANTS_ROOT}/${TENANT_B}/control-plane/seat-assets.json"
if [ -f "$seat_a" ] && [ -f "$seat_b" ]; then ok "per-tenant seat-assets exist"; else bad "missing per-tenant seat-assets"; fi

if python3 - "$seat_a" "$seat_b" <<'PY'
import json, sys
a_path, b_path = sys.argv[1:3]
with open(a_path) as f: a = json.load(f)
with open(b_path) as f: b = json.load(f)
a_seats = a.get("seats") or []
b_seats = b.get("seats") or []
if not a_seats or not b_seats:
    raise SystemExit("empty seats")
a_ids = {s.get("seatId") for s in (a_seats if isinstance(a_seats, list) else a_seats.values())}
b_ids = {s.get("seatId") for s in (b_seats if isinstance(b_seats, list) else b_seats.values())}
if a_ids & b_ids:
    raise SystemExit(f"seatId overlap: {a_ids & b_ids}")
print("disjoint seatIds", len(a_ids), len(b_ids))
PY
then ok "seat-assets seatIds disjoint across tenants"; else bad "seat-assets overlap or parse error"; fi

user_root_a="${TENANTS_ROOT}/${TENANT_A}/users"
user_root_b="${TENANTS_ROOT}/${TENANT_B}/users"
if [ -d "$user_root_a" ] && [ -d "$user_root_b" ]; then
  uid_a="$(find "$user_root_a" -mindepth 1 -maxdepth 1 -type d | head -1 | xargs basename)"
  uid_b="$(find "$user_root_b" -mindepth 1 -maxdepth 1 -type d | head -1 | xargs basename)"
  if [ "$uid_a" != "$uid_b" ]; then ok "remapped user dirs differ ($uid_a vs $uid_b)"; else bad "user dirs identical"; fi
  smoke_a="$(find "$user_root_a" -name smoke.md | head -1)"
  smoke_b="$(find "$user_root_b" -name smoke.md | head -1)"
  if [ -n "$smoke_a" ] && [ -n "$smoke_b" ]; then
    if grep -q "$TENANT_A" "$smoke_a" && grep -q "$TENANT_B" "$smoke_b"; then
      ok "imported workspace markers tenant-specific"
    else
      bad "workspace smoke.md content mismatch"
    fi
  else
    bad "missing imported smoke.md"
  fi
else
  bad "users/ missing under one or both tenants"
fi

global_seat="/root/.openbot/openbot-enterprise-seat-assets.json"
if [ -f "$global_seat" ]; then
  if ! cmp -s "$global_seat" "$seat_a" && ! cmp -s "$global_seat" "$seat_b"; then
    ok "per-tenant seat-assets differ from global legacy store"
  else
    bad "per-tenant seat-assets equals global (would leak in MT mode)"
  fi
fi

echo ""
echo "Summary: PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
