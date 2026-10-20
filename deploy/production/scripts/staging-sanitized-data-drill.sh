#!/usr/bin/env bash
# Same-host isolated staging drill: sanitized prod copy → independent volume/container/port.
# HARD RULES:
#   - NEVER mount /root/.openbot into the staging container
#   - Evidence logs contain counts/paths only (no secrets / PII payloads)
set -euo pipefail

STAGING_ROOT="${STAGING_ROOT:-/var/lib/openbot-staging}"
STAGING_STATE="${STAGING_STATE:-$STAGING_ROOT/state}"
STAGING_SNAP="${STAGING_SNAP:-$STAGING_ROOT/snapshot-pre-migrate}"
STAGING_ENV="${STAGING_ENV:-$STAGING_ROOT/staging.env}"
STAGING_EVIDENCE="${STAGING_EVIDENCE:-$STAGING_ROOT/evidence}"
PROD_STATE="${PROD_STATE:-/root/.openbot}"
IMAGE="${OPENBOT_STAGING_IMAGE:-localhost/openbot:rc-amd64-provenance-225de96b270f}"
CONTAINER="${OPENBOT_STAGING_CONTAINER:-openbot-gateway-staging}"
PORT="${OPENBOT_STAGING_PORT:-18790}"
TS="$(date +%Y%m%dT%H%M%S)"
LOG="${STAGING_EVIDENCE}/staging-data-drill-${TS}.log"
REPORT="${STAGING_EVIDENCE}/STAGING_DATA_DRILL_${TS}.md"

RUNTIME=podman
command -v podman >/dev/null 2>&1 || RUNTIME=docker

log() { echo "$*" | tee -a "$LOG"; }

count_tree() {
  local root="$1"
  local out="$2"
  python3 - "$root" "$out" <<'PY'
import json, os, pathlib, sys
root = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
tenants_root = root / "tenants"
tenant_ids = sorted([p.name for p in tenants_root.iterdir() if p.is_dir()]) if tenants_root.is_dir() else []
per = {}
for tid in tenant_ids:
    t = tenants_root / tid
    files = 0
    dirs = 0
    for dirpath, dirnames, filenames in os.walk(t):
        dirs += len(dirnames)
        files += len(filenames)
    kb = list((t / "knowledge").glob("**/*")) if (t / "knowledge").exists() else []
    sessions = list(t.glob("**/sessions/*.jsonl")) + list(t.glob("**/sessions/*.json"))
    per[tid] = {
        "files": files,
        "dirs": dirs,
        "knowledgeNodes": len([p for p in kb if p.is_file()]),
        "sessionFiles": len(sessions),
    }
payload = {
    "root": str(root),
    "tenantCount": len(tenant_ids),
    "tenantIds": tenant_ids,
    "perTenant": per,
    "topFiles": {
        "creditBuckets": (root / "openbot-credit-buckets.json").exists(),
        "seatModelGrant": (root / "openbot-seat-model-grant.json").exists(),
        "enterpriseModelSecrets": (root / "openbot-enterprise-model-secrets.json").exists(),
    },
}
out.write_text(json.dumps(payload, indent=2) + "\n")
print(f"tenants={payload['tenantCount']} files_sum={sum(v['files'] for v in per.values())}")
PY
}

scrub_copy() {
  local src="$1"
  local dst="$2"
  rm -rf "$dst"
  mkdir -p "$dst"
  # Structure-preserving copy (no rsync dependency on slim hosts)
  tar -C "$src" \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='compile-cache' \
    --exclude='.DS_Store' \
    --exclude='evidence' \
    --exclude='bin' \
    --exclude='CUTOVER_HOLD.txt' \
    --exclude='tenant-import-pkgs' \
    --exclude='attachment-assets' \
    --exclude='media' \
    -cf - . | tar -C "$dst" -xf -
  find "$dst" -name '._*' -delete 2>/dev/null || true
  find "$dst" -name 'screenshot*.png' -delete 2>/dev/null || true
  find "$dst" -type d -name 'video-assets' -exec rm -rf {} + 2>/dev/null || true
  # Drop plaintext secret stores (structure kept via placeholder markers only)
  rm -f \
    "$dst/openbot-enterprise-model-secrets.json" \
    "$dst/openbot-enterprise-model-secrets.json.key" \
    "$dst/openbot-enterprise-operational-identity-secrets.json" \
    "$dst/.env.docker" \
    "$dst/.env" 2>/dev/null || true
  find "$dst" -type f \( -name '*.key' -o -name '*secrets*.json' -o -name 'auth-profiles.json' \) -delete 2>/dev/null || true
  # Staging-only env (dedicated token; never reuse prod token file path)
  local tok
  tok="$(openssl rand -hex 24)"
  cat >"$STAGING_ENV" <<EOF
OPENBOT_STATE_DIR=/root/.openbot
OPENBOT_CONFIG_PATH=/root/.openbot/openbot.json
OPENBOT_NO_RESPAWN=1
OPENCLAW_STATE_DIR=/root/.openbot
OPENCLAW_CONFIG_PATH=/root/.openbot/openbot.json
OPENCLAW_SKIP_CHANNELS=1
OPENCLAW_NO_RESPAWN=1
OPENBOT_GATEWAY_TOKEN=${tok}
OPENCLAW_GATEWAY_TOKEN=${tok}
OPENBOT_DATA_MODE=managed
NODE_ENV=production
OPENBOT_MULTITENANT=1
OPENBOT_IMAGE_INSTALL=1
OPENBOT_FABRIC_ENABLED=0
OPENBOT_SUPERVISOR_ENABLED=0
OPENBOT_SUPERVISOR_RUNNER_ENABLED=0
OPENBOT_TENANTS_ROOT=/root/.openbot/tenants
EOF
  chmod 600 "$STAGING_ENV"
  # Ensure config skeleton exists
  if [[ ! -f "$dst/openbot.json" ]]; then
    echo '{}' >"$dst/openbot.json"
  fi
  # Neutralize SMTP / credential fields inside openbot.json without printing values.
  # Do NOT match substrings like maxTokens / passwordResetTtlMinutes.
  python3 - "$dst/openbot.json" <<'PY'
import json, pathlib, re, sys
p = pathlib.Path(sys.argv[1])
try:
    data = json.loads(p.read_text() or "{}")
except Exception:
    data = {}
SECRET_KEY = re.compile(
    r"^(api[_-]?key|access[_-]?token|refresh[_-]?token|gateway[_-]?token|"
    r"auth[_-]?token|client[_-]?secret|secret|password|smtpPass|smtp_pass|"
    r"credential|private[_-]?key)$",
    re.I,
)
def scrub(obj):
    if isinstance(obj, dict):
        for k in list(obj.keys()):
            if SECRET_KEY.match(str(k)):
                obj[k] = "***STAGING_REDACTED***"
            else:
                scrub(obj[k])
    elif isinstance(obj, list):
        for i in obj:
            scrub(i)
scrub(data)
p.write_text(json.dumps(data, indent=2) + "\n")
PY
}

assert_not_prod_mount() {
  local mounts
  mounts="$("$RUNTIME" inspect "$CONTAINER" --format '{{range .Mounts}}{{.Source}}->{{.Destination}};{{end}}')"
  if echo "$mounts" | grep -q '/root/.openbot->'; then
    echo "FATAL: staging container mounts prod /root/.openbot: $mounts" >&2
    exit 3
  fi
  if echo "$mounts" | grep -vq "$STAGING_STATE"; then
    # must include staging state
    echo "$mounts" | grep -q "$STAGING_STATE" || {
      echo "FATAL: staging state mount missing: $mounts" >&2
      exit 3
    }
  fi
}

start_staging() {
  local state_dir="$1"
  "$RUNTIME" rm -f "$CONTAINER" >/dev/null 2>&1 || true
  # Bind staging state to the path the gateway expects INSIDE the container,
  # but the host path is never /root/.openbot.
  "$RUNTIME" run -d --name "$CONTAINER" --restart=no --network host \
    --env-file "$STAGING_ENV" \
    -e OPENBOT_GATEWAY_PORT="$PORT" \
    -v "${state_dir}:/root/.openbot:rw" \
    "$IMAGE" \
    node openbot.mjs gateway --bind loopback --port "$PORT"
  local i
  for i in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
      log "staging healthz ok after ${i}s"
      return 0
    fi
    sleep 1
  done
  log "FATAL: staging healthz timeout"
  "$RUNTIME" logs --tail 80 "$CONTAINER" || true
  exit 2
}

mkdir -p "$STAGING_ROOT" "$STAGING_EVIDENCE"
chmod 700 "$STAGING_ROOT"
: >"$LOG"
log "=== staging sanitized data drill $TS ==="
log "image=$IMAGE container=$CONTAINER port=$PORT"
log "staging_state=$STAGING_STATE snap=$STAGING_SNAP"
log "prod_state=$PROD_STATE (copy source only; not mounted)"

log "== 1) export + scrub into staging state =="
scrub_copy "$PROD_STATE" "$STAGING_STATE"
# pre-migration snapshot (second copy for rollback)
rm -rf "$STAGING_SNAP"
mkdir -p "$STAGING_SNAP"
tar -C "$STAGING_STATE" -cf - . | tar -C "$STAGING_SNAP" -xf -
count_tree "$STAGING_STATE" "$STAGING_EVIDENCE/counts-pre-${TS}.json" | tee -a "$LOG"
count_tree "$STAGING_SNAP" "$STAGING_EVIDENCE/counts-snap-${TS}.json" | tee -a "$LOG"

log "== 2) start staging gateway =="
start_staging "$STAGING_STATE"
assert_not_prod_mount
curl -sf "http://127.0.0.1:${PORT}/healthz" | tee -a "$LOG"; echo
# Staging intentionally lacks channel secrets; readyz may report wecom failing — do not hard-fail.
curl -sS "http://127.0.0.1:${PORT}/readyz" | tee "$STAGING_EVIDENCE/readyz-${TS}.json" | tee -a "$LOG"; echo
python3 - "$STAGING_EVIDENCE/readyz-${TS}.json" <<'PY' | tee -a "$LOG"
import json, sys
j = json.load(open(sys.argv[1]))
failing = set(j.get("failing") or [])
unexpected = failing - {"wecom"}
if unexpected:
    raise SystemExit(f"readyz unexpected failing={sorted(unexpected)}")
print(f"PASS readyz acceptable failing={sorted(failing)}")
PY
"$RUNTIME" exec "$CONTAINER" cat /app/dist/build-info.json | tee -a "$LOG"

log "== 3) post-start counts + tenant isolation sample =="
count_tree "$STAGING_STATE" "$STAGING_EVIDENCE/counts-post-start-${TS}.json" | tee -a "$LOG"
python3 - "$STAGING_EVIDENCE/counts-pre-${TS}.json" "$STAGING_EVIDENCE/counts-post-start-${TS}.json" <<'PY' | tee -a "$LOG"
import json,sys
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2]))
assert a["tenantCount"]==b["tenantCount"], (a["tenantCount"], b["tenantCount"])
assert a["tenantIds"]==b["tenantIds"]
print(f"PASS tenantCount stable={a['tenantCount']}")
# isolation: each tenant id path exists only under its own prefix
for tid in a["tenantIds"][:5]:
    print(f"SAMPLE tenant={tid} files={a['perTenant'][tid]['files']} sessions={a['perTenant'][tid]['sessionFiles']}")
PY

log "== 4) restart staging + recount =="
"$RUNTIME" restart "$CONTAINER"
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    log "staging healthz after restart ${i}s"
    break
  fi
  sleep 1
done
count_tree "$STAGING_STATE" "$STAGING_EVIDENCE/counts-post-restart-${TS}.json" | tee -a "$LOG"
python3 - "$STAGING_EVIDENCE/counts-pre-${TS}.json" "$STAGING_EVIDENCE/counts-post-restart-${TS}.json" <<'PY' | tee -a "$LOG"
import json,sys
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2]))
assert a["tenantCount"]==b["tenantCount"]
for tid in a["tenantIds"]:
    assert a["perTenant"][tid]["files"]==b["perTenant"][tid]["files"], tid
print("PASS file counts stable across restart")
PY

log "== 5) rollback to pre-migrate snapshot volume =="
"$RUNTIME" rm -f "$CONTAINER" >/dev/null 2>&1 || true
# restore snapshot over state
rm -rf "$STAGING_STATE"
mkdir -p "$STAGING_STATE"
tar -C "$STAGING_SNAP" -cf - . | tar -C "$STAGING_STATE" -xf -
start_staging "$STAGING_STATE"
assert_not_prod_mount
count_tree "$STAGING_STATE" "$STAGING_EVIDENCE/counts-post-rollback-${TS}.json" | tee -a "$LOG"
python3 - "$STAGING_EVIDENCE/counts-snap-${TS}.json" "$STAGING_EVIDENCE/counts-post-rollback-${TS}.json" <<'PY' | tee -a "$LOG"
import json,sys
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2]))
assert a["tenantCount"]==b["tenantCount"]
for tid in a["tenantIds"]:
    assert a["perTenant"][tid]["files"]==b["perTenant"][tid]["files"], tid
print("PASS rollback counts match snapshot")
PY

MOUNTS="$("$RUNTIME" inspect "$CONTAINER" --format '{{range .Mounts}}{{.Source}}->{{.Destination}};{{end}}')"
python3 - "$REPORT" "$TS" "$STAGING_STATE" "$STAGING_SNAP" "$PORT" "$IMAGE" "$MOUNTS" \
  "$STAGING_EVIDENCE/counts-pre-${TS}.json" \
  "$STAGING_EVIDENCE/counts-post-restart-${TS}.json" \
  "$STAGING_EVIDENCE/counts-post-rollback-${TS}.json" <<'PY'
import json, pathlib, sys
report, ts, state, snap, port, image, mounts, pre_p, restart_p, rb_p = sys.argv[1:11]
pre=json.load(open(pre_p)); rst=json.load(open(restart_p)); rb=json.load(open(rb_p))
lines=[
  f"# Staging sanitized data drill — {ts}",
  "",
  "## Isolation",
  "",
  f"- staging state host path: `{state}`",
  f"- snapshot path: `{snap}`",
  f"- container port: `{port}`",
  f"- image: `{image}`",
  f"- mounts: `{mounts}`",
  "- prod `/root/.openbot` mounted: **NO**",
  "",
  "## Reconciliation",
  "",
  "| Checkpoint | tenantCount | fileSum |",
  "| --- | ---: | ---: |",
  f"| pre-migrate | {pre['tenantCount']} | {sum(v['files'] for v in pre['perTenant'].values())} |",
  f"| post-restart | {rst['tenantCount']} | {sum(v['files'] for v in rst['perTenant'].values())} |",
  f"| post-rollback | {rb['tenantCount']} | {sum(v['files'] for v in rb['perTenant'].values())} |",
  "",
  f"- tenantIds: `{', '.join(pre['tenantIds'])}`",
  "",
  "## Result",
  "",
  "**DONE** — sanitized copy, restart persistence, and snapshot rollback reconciled.",
  "",
]
pathlib.Path(report).write_text("\n".join(lines))
print(report)
PY

log "REPORT=$REPORT"
log "LOG=$LOG"
log "STAGING_DRILL_OK"
