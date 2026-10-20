#!/usr/bin/env bash
# Host watchdog: if LIVE control-ui fails the overlay gate, restore the pinned tip/full image.
#
# ALIGNMENT (2026-08-02): tip/full UI 2.0 (employee home / space-import / daily cards) and
# org-archive polish (更改邮箱 / KV rail) MUST ship as ONE combined tip overlay.
# Never force FALLBACK to lean org-archive-* — that caused tip↔lean rollback wars.
set -euo pipefail

CONTAINER="${OPENBOT_GATEWAY_CONTAINER:-openbot-gateway-rc}"
# Anti-hijack: env pins must not strip create-seat invite + archive email edit.
unset OPENBOT_UI_OVERLAY_PINNED_ENTRY OPENBOT_UI_OVERLAY_FORBIDDEN_ENTRIES || true
VERIFY_SCRIPT="${OPENBOT_UI_OVERLAY_VERIFY:-}"
# Canonical fallback is frozen/combined tip UI — not lean polish.
FALLBACK_IMAGE="${OPENBOT_UI_OVERLAY_FALLBACK_IMAGE:-localhost/openbot:ui-v2.0}"
AUDIT_LOG="${OPENBOT_UI_OVERLAY_AUDIT_LOG:-/var/log/openbot-control-ui-overlay-watch.log}"
LOCK_FILE="${OPENBOT_UI_OVERLAY_LOCK:-/tmp/openbot-control-ui-overlay-watch.lock}"
TMP_DIR="${OPENBOT_UI_OVERLAY_TMP:-/tmp/openbot-control-ui-overlay-watch}"
RESTORE_SH="${OPENBOT_UI_V2_RESTORE:-/root/openbot-ui-baselines/v2.0/restore-ui-v2.0.sh}"

log() {
  local line="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$line"
  mkdir -p "$(dirname "$AUDIT_LOG")" 2>/dev/null || true
  echo "$line" >>"$AUDIT_LOG" 2>/dev/null || true
}

# Refuse lean fallback misconfiguration (anti-rollback)
if [[ "$FALLBACK_IMAGE" == *org-archive* || "$FALLBACK_IMAGE" == *polish* || "$FALLBACK_IMAGE" == *refine-r* ]]; then
  log "warn: refusing lean FALLBACK_IMAGE=$FALLBACK_IMAGE — forcing localhost/openbot:ui-v2.0"
  FALLBACK_IMAGE=localhost/openbot:ui-v2.0
fi

if [[ -z "$VERIFY_SCRIPT" ]]; then
  if [[ -x /root/openbot-ui-baselines/v2.0/verify-control-ui-overlay.sh ]]; then
    VERIFY_SCRIPT=/root/openbot-ui-baselines/v2.0/verify-control-ui-overlay.sh
  elif [[ -x /root/openbot/deploy/production/scripts/verify-control-ui-overlay.sh ]]; then
    VERIFY_SCRIPT=/root/openbot/deploy/production/scripts/verify-control-ui-overlay.sh
  elif [[ -x "$(dirname "$0")/verify-control-ui-overlay.sh" ]]; then
    VERIFY_SCRIPT="$(cd "$(dirname "$0")" && pwd)/verify-control-ui-overlay.sh"
  else
    log "error: set OPENBOT_UI_OVERLAY_VERIFY to verify-control-ui-overlay.sh"
    exit 2
  fi
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "skip: another watchdog run holds $LOCK_FILE"
  exit 0
fi

if ! podman inspect "$CONTAINER" >/dev/null 2>&1; then
  log "error: container missing: $CONTAINER"
  exit 10
fi

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR/control-ui"
podman cp "$CONTAINER:/app/dist/control-ui/." "$TMP_DIR/control-ui/" >/dev/null

set +e
"$VERIFY_SCRIPT" "$TMP_DIR/control-ui"
GATE_RC=$?
set -e

if [[ "$GATE_RC" -eq 0 ]]; then
  ENTRY="$(grep -oE 'assets/index-[^"]+\.js' "$TMP_DIR/control-ui/index.html" | head -1 || true)"
  log "ok: LIVE passes overlay gate entry=$ENTRY image=$(podman inspect "$CONTAINER" --format '{{.ImageName}}')"
  exit 0
fi

LIVE_IMAGE="$(podman inspect "$CONTAINER" --format '{{.ImageName}}')"
log "fail: LIVE overlay gate rc=$GATE_RC image=$LIVE_IMAGE — restoring tip fallback=$FALLBACK_IMAGE"

# Prefer restore script (rebuilds ui-v2.0 from frozen tar if needed)
if [[ -x "$RESTORE_SH" ]]; then
  bash "$RESTORE_SH"
else
  if ! podman image exists "$FALLBACK_IMAGE"; then
    log "error: fallback image missing: $FALLBACK_IMAGE"
    exit 11
  fi
  TS="$(date -u +%Y%m%dT%H%M%SZ)"
  PREV="${CONTAINER}-prev-overlay-watch-${TS}"
  ENV_FILE="/tmp/openbot-gateway-rc.env.overlay-watch.${TS}"
  podman inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' >"$ENV_FILE"
  podman rename "$CONTAINER" "$PREV"
  podman stop -t 5 "$PREV" || true
  podman run -d \
    --name "$CONTAINER" \
    --network host \
    --restart always \
    --env-file "$ENV_FILE" \
    -v /root/.openbot:/root/.openbot \
    "$FALLBACK_IMAGE" >/dev/null
fi

for i in $(seq 1 40); do
  code="$(curl -sS -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:18789/healthz || true)"
  ready="$(curl -sS -m 2 http://127.0.0.1:18789/readyz 2>/dev/null || true)"
  if [[ "$code" == "200" ]] && echo "$ready" | grep -q '"ready":true'; then
    break
  fi
  sleep 1
done

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR/control-ui"
podman cp "$CONTAINER:/app/dist/control-ui/." "$TMP_DIR/control-ui/" >/dev/null
set +e
"$VERIFY_SCRIPT" "$TMP_DIR/control-ui"
RESTORE_RC=$?
set -e

AFTER_IMAGE="$(podman inspect "$CONTAINER" --format '{{.ImageName}}')"
if [[ "$RESTORE_RC" -ne 0 ]]; then
  log "error: restored image still fails gate rc=$RESTORE_RC image=$AFTER_IMAGE"
  exit 13
fi

log "restored: $LIVE_IMAGE -> $AFTER_IMAGE"
exit 0
