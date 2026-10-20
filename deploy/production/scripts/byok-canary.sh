#!/usr/bin/env bash
# BYOK live canary — operator-run on the gateway host.
#
# Proves (when a real provider key is available via SecretRef env-file):
#   create → credential save → probe → discover → register → grantBatch
#   → agent call → platform Credits A/B (no debit) → budget block
#   → gateway restart → persistence (connection/credential/grants/probe)
#
# Key discipline (mandatory):
#   - Prefer BYOK_ENV_FILE (root-only) materialized from enterprise-model SecretRef
#   - NEVER pass BYOK_API_KEY on SSH/cmdline; NEVER log or write the key into evidence
#   - Inject into the container only via `podman/docker exec --env-file`
#
# Usage (on host root@gateway):
#   bash deploy/production/scripts/materialize-byok-canary-env.sh
#   # optional overrides via env (non-secret):
#   # export BYOK_TENANT_ID=001
#   # export OPENBOT_GATEWAY_CONTAINER=openbot-gateway-staging
#   # export OPENBOT_STATE_DIR=/var/lib/openbot-staging/state
#   # export OPENBOT_ENV_FILE=/var/lib/openbot-staging/staging.env
#   # export BYOK_GATEWAY_URL=ws://127.0.0.1:18790
#   # export BYOK_HEALTH_PORT=18790
#   bash deploy/production/scripts/byok-canary.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST="${STAGING_HOST:-root@8.217.93.71}"
CONTAINER="${OPENBOT_GATEWAY_CONTAINER:-openbot-gateway-rc}"
ENV_FILE="${OPENBOT_ENV_FILE:-/root/.openbot/.env.docker}"
STATE_DIR="${OPENBOT_STATE_DIR:-/root/.openbot}"
EVIDENCE_DIR="${BYOK_EVIDENCE_DIR:-$STATE_DIR/evidence}"
BYOK_ENV_FILE="${BYOK_ENV_FILE:-/root/.openbot-canary-secrets/byok.env}"
HEALTH_PORT="${BYOK_HEALTH_PORT:-18789}"
TS="$(date +%Y%m%dT%H%M%S)"
LOG="${BYOK_LOG:-/root/openbot-byok-canary-${TS}.log}"

TENANT_ID="${BYOK_TENANT_ID:-001}"
ADMIN_EMAIL="${BYOK_ADMIN_EMAIL:-daniel.hhd@gmail.com}"
PROVIDER_TYPE="${BYOK_PROVIDER_TYPE:-openai}"
BASE_URL="${BYOK_BASE_URL:-}"
DISPLAY_NAME="${BYOK_DISPLAY_NAME:-byok-canary-${TS}}"
UPSTREAM_MODEL="${BYOK_UPSTREAM_MODEL:-}"
SEAT_ID="${BYOK_SEAT_ID:-}"
SKIP_AGENT="${BYOK_SKIP_AGENT:-0}"
SKIP_BUDGET="${BYOK_SKIP_BUDGET:-0}"
SKIP_RESTART="${BYOK_SKIP_RESTART:-0}"
CLEANUP="${BYOK_CLEANUP:-0}"

pass=0
fail=0
ok()  { echo "PASS  $*"; pass=$((pass + 1)); }
bad() { echo "FAIL  $*"; fail=$((fail + 1)); }
note(){ echo "NOTE  $*"; }

need_key() {
  if [[ -n "${BYOK_API_KEY:-}" ]]; then
    note "BYOK_API_KEY already in process env (prefer BYOK_ENV_FILE for SecretRef discipline)"
    return 0
  fi
  if [[ -f "$BYOK_ENV_FILE" ]] && grep -q '^BYOK_API_KEY=.\+' "$BYOK_ENV_FILE"; then
    # Load into this shell for optional local checks; do not echo.
    set -a
    # shellcheck disable=SC1090
    source "$BYOK_ENV_FILE"
    set +a
  fi
  if [[ -z "${BYOK_API_KEY:-}" ]]; then
    echo "BYOK key missing. Run materialize-byok-canary-env.sh (SecretRef → $BYOK_ENV_FILE)." >&2
    exit 2
  fi
  # Drop from this shell after validation length check — injection uses --env-file.
  local _len=${#BYOK_API_KEY}
  unset BYOK_API_KEY
  if [[ "$_len" -lt 8 ]]; then
    echo "BYOK key too short in $BYOK_ENV_FILE" >&2
    exit 2
  fi
}

detect_runtime() {
  if command -v podman >/dev/null 2>&1; then
    echo podman
  elif command -v docker >/dev/null 2>&1; then
    echo docker
  else
    echo ""
  fi
}

on_gateway_host() {
  [[ -f "$ENV_FILE" ]] && [[ -d "$STATE_DIR" ]]
}

snapshot_credit_buckets() {
  local tenant="$1"
  local out="$2"
  python3 - "$STATE_DIR/openbot-credit-buckets.json" "$tenant" "$out" <<'PY'
import json, sys
path, tenant, out = sys.argv[1:4]
try:
    data = json.load(open(path))
except FileNotFoundError:
    open(out, "w").write(json.dumps({"ok": False, "error": "missing buckets file"}))
    raise SystemExit(0)
buckets = data.get("buckets") or {}
rows = []
total_granted = 0
total_consumed = 0
items = buckets.values() if isinstance(buckets, dict) else buckets
for b in items:
    if not isinstance(b, dict):
        continue
    if (b.get("enterpriseId") or b.get("tenantId")) != tenant:
        continue
    granted = int(b.get("creditsGranted") or 0)
    consumed = int(b.get("creditsConsumed") or 0)
    total_granted += granted
    total_consumed += consumed
    rows.append({
        "id": b.get("id"),
        "cycleStart": b.get("cycleStart"),
        "bucketType": b.get("bucketType"),
        "creditsGranted": granted,
        "creditsConsumed": consumed,
    })
open(out, "w").write(json.dumps({
    "ok": True,
    "tenantId": tenant,
    "bucketCount": len(rows),
    "creditsGranted": total_granted,
    "creditsConsumed": total_consumed,
    "buckets": rows,
}, indent=2))
print(f"creditsConsumed={total_consumed} granted={total_granted} buckets={len(rows)}")
PY
}

copy_script_into_container() {
  local runtime="$1"
  "$runtime" cp "$SCRIPT_DIR/byok-canary.mjs" "$CONTAINER:/app/byok-canary.mjs"
}

run_rpc_in_container() {
  local runtime="$1"
  shift
  local include_key="${BYOK_INJECT_KEY:-1}"
  local -a env_args=(
    -e "OPENBOT_GATEWAY_TOKEN=$OPENBOT_GATEWAY_TOKEN"
    # Inside container the state volume is always mounted at /root/.openbot
    -e "OPENBOT_STATE_DIR=/root/.openbot"
    -e "OPENCLAW_STATE_DIR=/root/.openbot"
    -e "BYOK_TENANT_ID=$TENANT_ID"
    -e "BYOK_ADMIN_EMAIL=$ADMIN_EMAIL"
    -e "BYOK_PROVIDER_TYPE=$PROVIDER_TYPE"
    -e "BYOK_BASE_URL=$BASE_URL"
    -e "BYOK_DISPLAY_NAME=$DISPLAY_NAME"
    -e "BYOK_UPSTREAM_MODEL=$UPSTREAM_MODEL"
    -e "BYOK_SEAT_ID=$SEAT_ID"
    -e "BYOK_SKIP_AGENT=$SKIP_AGENT"
    -e "BYOK_SKIP_BUDGET=$SKIP_BUDGET"
    -e "BYOK_CLEANUP=$CLEANUP"
    -e "BYOK_PHASE=${BYOK_PHASE:-full}"
    -e "BYOK_CONNECTION_ID=${BYOK_CONNECTION_ID:-}"
    -e "BYOK_RESULT_PATH=${BYOK_RESULT_PATH:-/tmp/byok-canary-result.json}"
    -e "BYOK_GATEWAY_URL=${BYOK_GATEWAY_URL:-ws://127.0.0.1:${HEALTH_PORT}}"
  )
  # Secret injection: --env-file only (never -e BYOK_API_KEY=...)
  if [[ "$include_key" == "1" ]]; then
    [[ -f "$BYOK_ENV_FILE" ]] || {
      echo "missing BYOK_ENV_FILE=$BYOK_ENV_FILE" >&2
      exit 2
    }
    env_args+=(--env-file "$BYOK_ENV_FILE")
  fi
  "$runtime" exec \
    "${env_args[@]}" \
    -w /app \
    "$CONTAINER" \
    node /app/byok-canary.mjs "$@"
}

write_evidence_md() {
  local md="$1"
  local full_json="$2"
  local persist_json="$3"
  local credits_before="$4"
  local credits_after="$5"
  local restart_log="$6"
  python3 - "$md" "$full_json" "$persist_json" "$credits_before" "$credits_after" "$restart_log" "$TENANT_ID" "$TS" <<'PY'
import json, pathlib, sys
md, full_p, persist_p, cb_p, ca_p, restart_p, tenant, ts = sys.argv[1:9]

def load(p):
    try:
        return json.loads(pathlib.Path(p).read_text())
    except Exception as e:
        return {"ok": False, "error": str(e)}

full = load(full_p) if full_p != "-" else {}
persist = load(persist_p) if persist_p != "-" else {}
cb = load(cb_p)
ca = load(ca_p)
delta = None
if cb.get("ok") and ca.get("ok"):
    delta = int(ca.get("creditsConsumed", 0)) - int(cb.get("creditsConsumed", 0))

lines = [
    f"# BYOK canary run — {ts}",
    "",
    f"- tenant: `{tenant}`",
    f"- connectionId: `{full.get('connectionId')}`",
    f"- runtimeModelId: `{full.get('runtimeModelId')}`",
    f"- assetId: `{full.get('assetId')}`",
    f"- seatId: `{full.get('seatId')}`",
    f"- full.pass: `{full.get('pass')}`",
    f"- persist.pass: `{persist.get('pass')}`",
    f"- creditsConsumed before/after: `{cb.get('creditsConsumed')}` → `{ca.get('creditsConsumed')}` (Δ={delta})",
    f"- credits Δ==0: `{delta == 0}`",
    f"- agentOk: `{full.get('agentOk')}`",
    f"- budgetBlocked: `{full.get('budgetBlocked')}`",
    f"- auditPass: `{full.get('auditPass')}`",
    f"- auditHints: `{full.get('auditHints')}`",
    "",
    "## Hard gate",
    "",
    "| Check | Result |",
    "| --- | --- |",
    f"| create→probe→register→grantBatch | {'PASS' if full.get('connectionId') and full.get('runtimeModelId') else 'FAIL'} |",
    f"| Credits not debited (disk buckets) | {'PASS' if delta == 0 else 'FAIL/UNKNOWN'} |",
    f"| Budget block (cap=0) | {'PASS' if full.get('budgetBlocked') else 'FAIL/SKIP'} |",
    f"| Audit trail (create/probe/register/grant/invoke/budget-block) | {'PASS' if full.get('auditPass') else 'FAIL/SKIP'} |",
    f"| Persist after restart | {'PASS' if persist.get('pass') else 'FAIL/SKIP'} |",
    "",
    f"Restart log: `{restart_p}`",
    "",
]
pathlib.Path(md).write_text("\n".join(lines))
print(md)
PY
}

run_local() {
  need_key
  local runtime
  runtime="$(detect_runtime)"
  [[ -n "$runtime" ]] || { echo "Need podman or docker" >&2; exit 1; }
  if ! "$runtime" ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "container $CONTAINER not running" >&2
    exit 1
  fi

  # shellcheck disable=SC1090
  set -a
  # only pull token; do not dump whole env
  OPENBOT_GATEWAY_TOKEN="$(grep -E '^OPENBOT_GATEWAY_TOKEN=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
  set +a
  [[ -n "${OPENBOT_GATEWAY_TOKEN:-}" ]] || { echo "OPENBOT_GATEWAY_TOKEN missing in $ENV_FILE" >&2; exit 1; }

  mkdir -p "$EVIDENCE_DIR"
  local full_json="$EVIDENCE_DIR/byok-canary-full-${TS}.json"
  local persist_json="$EVIDENCE_DIR/byok-canary-persist-${TS}.json"
  local credits_before="$EVIDENCE_DIR/byok-credits-before-${TS}.json"
  local credits_after="$EVIDENCE_DIR/byok-credits-after-${TS}.json"
  local evidence_md="$EVIDENCE_DIR/BYOK_CANARY_${TS}.md"
  local restart_log="$EVIDENCE_DIR/byok-restart-${TS}.log"

  {
    echo "=== BYOK canary host wrapper ==="
    echo "ts=$TS container=$CONTAINER tenant=$TENANT_ID provider=$PROVIDER_TYPE"
    echo "admin=$ADMIN_EMAIL skip_restart=$SKIP_RESTART cleanup=$CLEANUP"
  } | tee -a "$LOG"

  note "disk credits snapshot (before)"
  snapshot_credit_buckets "$TENANT_ID" "$credits_before" | tee -a "$LOG"

  copy_script_into_container "$runtime"
  export BYOK_PHASE=full
  export BYOK_RESULT_PATH=/tmp/byok-canary-result.json
  echo "== RPC full phase ==" | tee -a "$LOG"
  set +e
  run_rpc_in_container "$runtime" 2>&1 | tee -a "$LOG"
  local rpc_rc=${PIPESTATUS[0]}
  set -e
  "$runtime" cp "$CONTAINER:/tmp/byok-canary-result.json" "$full_json" 2>/dev/null || {
    echo '{}' >"$full_json"
  }
  if [[ $rpc_rc -eq 0 ]]; then ok "rpc.full"; else bad "rpc.full (exit $rpc_rc)"; fi

  note "disk credits snapshot (after agent/budget steps)"
  snapshot_credit_buckets "$TENANT_ID" "$credits_after" | tee -a "$LOG"
  set +e
  python3 - "$credits_before" "$credits_after" <<'PY' | tee -a "$LOG"
import json,sys
b=json.load(open(sys.argv[1])); a=json.load(open(sys.argv[2]))
if not (b.get("ok") and a.get("ok")):
    print("NOTE  credits disk compare skipped")
    raise SystemExit(0)
delta=int(a["creditsConsumed"])-int(b["creditsConsumed"])
print(f"creditsConsumed Δ={delta} (expect 0 for BYOK)")
raise SystemExit(0 if delta==0 else 1)
PY
  credits_rc=${PIPESTATUS[0]}
  set -e
  if [[ $credits_rc -eq 0 ]]; then ok "credits.disk.no-debit"; else bad "credits.disk.debited"; fi

  CONNECTION_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("connectionId") or "")' "$full_json")"
  if [[ -z "$CONNECTION_ID" ]]; then
    bad "missing connectionId — skip restart/persist"
    write_evidence_md "$evidence_md" "$full_json" "-" "$credits_before" "$credits_after" "$restart_log" || true
    echo "LOG=$LOG"
    echo "EVIDENCE=$evidence_md"
    echo "Summary: PASS=$pass FAIL=$fail"
    exit 1
  fi

  if [[ "$SKIP_RESTART" != "1" ]]; then
    echo "== restart persistence drill ==" | tee -a "$LOG"
    {
      echo "restart begin $(date -Is)"
      "$runtime" restart "$CONTAINER"
      for i in $(seq 1 60); do
        code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HEALTH_PORT}/healthz" || true)"
        if [[ "$code" == "200" ]]; then
          echo "healthz 200 after ${i}s"
          break
        fi
        sleep 1
      done
      echo "restart end $(date -Is)"
    } | tee "$restart_log" | tee -a "$LOG"

    copy_script_into_container "$runtime"
    export BYOK_PHASE=persist-check
    export BYOK_CONNECTION_ID="$CONNECTION_ID"
    export BYOK_RESULT_PATH=/tmp/byok-canary-persist.json
    # API key not needed for persist-check
    set +e
    BYOK_INJECT_KEY=0 run_rpc_in_container "$runtime" 2>&1 | tee -a "$LOG"
    local persist_rc=${PIPESTATUS[0]}
    set -e
    "$runtime" cp "$CONTAINER:/tmp/byok-canary-persist.json" "$persist_json" 2>/dev/null || echo '{}' >"$persist_json"
    if [[ $persist_rc -eq 0 ]]; then ok "rpc.persist"; else bad "rpc.persist (exit $persist_rc)"; fi
  else
    note "restart skipped (BYOK_SKIP_RESTART=1)"
    echo '{}' >"$persist_json"
    echo "skipped" >"$restart_log"
  fi

  write_evidence_md "$evidence_md" "$full_json" "$persist_json" "$credits_before" "$credits_after" "$restart_log"
  # Redaction gate: evidence must not contain key-shaped material from env-file
  if grep -E 'BYOK_API_KEY=|sk-[A-Za-z0-9]{16,}' "$evidence_md" "$full_json" "$LOG" >/dev/null 2>&1; then
    bad "evidence leaked key-shaped material"
  else
    ok "evidence.redaction"
  fi
  # also copy into repo evidence if present
  if [[ -d "$ROOT/deploy/production/evidence" ]]; then
    cp -f "$evidence_md" "$ROOT/deploy/production/evidence/BYOK_CANARY_LATEST.md" 2>/dev/null || true
    cp -f "$full_json" "$ROOT/deploy/production/evidence/byok-canary-full-latest.json" 2>/dev/null || true
    cp -f "$LOG" "$ROOT/deploy/production/evidence/openbot-byok-canary-latest.log" 2>/dev/null || true
  fi

  echo ""
  echo "LOG=$LOG"
  echo "EVIDENCE=$evidence_md"
  echo "CONNECTION_ID=$CONNECTION_ID"
  echo "Summary: PASS=$pass FAIL=$fail"
  [[ "$fail" -eq 0 ]]
}

run_via_ssh() {
  echo "Not on gateway host — copying scripts to $HOST (no key on SSH cmdline)…"
  scp -q \
    "$SCRIPT_DIR/byok-canary.sh" \
    "$SCRIPT_DIR/byok-canary.mjs" \
    "$SCRIPT_DIR/materialize-byok-canary-env.sh" \
    "$HOST:/tmp/"
  # Non-secret knobs only. Remote host materializes SecretRef → BYOK_ENV_FILE.
  ssh -o BatchMode=yes "$HOST" \
    "BYOK_TENANT_ID=$(printf %q "$TENANT_ID") \
     BYOK_ADMIN_EMAIL=$(printf %q "$ADMIN_EMAIL") \
     BYOK_PROVIDER_TYPE=$(printf %q "$PROVIDER_TYPE") \
     BYOK_BASE_URL=$(printf %q "$BASE_URL") \
     BYOK_DISPLAY_NAME=$(printf %q "$DISPLAY_NAME") \
     BYOK_UPSTREAM_MODEL=$(printf %q "$UPSTREAM_MODEL") \
     BYOK_SEAT_ID=$(printf %q "$SEAT_ID") \
     BYOK_SKIP_AGENT=$(printf %q "$SKIP_AGENT") \
     BYOK_SKIP_BUDGET=$(printf %q "$SKIP_BUDGET") \
     BYOK_SKIP_RESTART=$(printf %q "$SKIP_RESTART") \
     BYOK_CLEANUP=$(printf %q "$CLEANUP") \
     OPENBOT_GATEWAY_CONTAINER=$(printf %q "$CONTAINER") \
     OPENBOT_STATE_DIR=$(printf %q "$STATE_DIR") \
     OPENBOT_ENV_FILE=$(printf %q "$ENV_FILE") \
     BYOK_EVIDENCE_DIR=$(printf %q "$EVIDENCE_DIR") \
     BYOK_GATEWAY_URL=$(printf %q "${BYOK_GATEWAY_URL:-}") \
     BYOK_HEALTH_PORT=$(printf %q "$HEALTH_PORT") \
     BYOK_ENV_FILE=$(printf %q "$BYOK_ENV_FILE") \
     bash -lc 'set -euo pipefail; bash /tmp/materialize-byok-canary-env.sh; bash /tmp/byok-canary.sh'"
}

main() {
  if on_gateway_host; then
    run_local
  else
    run_via_ssh
  fi
}

main "$@"
