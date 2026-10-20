#!/usr/bin/env bash
# Controlled full-dist cutover: isolation expert-fix-r1 (#369/#378/#379)
# Run on production host as root. Do NOT mid-run `rm -rf /app/dist` on a live container.
set -euo pipefail

OVERLAY="${OVERLAY:-isolation-expert-fix-r1}"
STAMP="${STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
CAND="${CAND:?set CAND to origin/main tip SHA}"
ART_DIR="${ART_DIR:?set ART_DIR to directory containing gateway-dist.tgz (+ optional control-ui.tgz)}"
CONTAINER="${CONTAINER:-openbot-gateway-rc}"
BK="/root/openbot-maintenance-${OVERLAY}-${STAMP}"
GW_TGZ="${ART_DIR}/gateway-dist.tgz"
UI_TGZ="${ART_DIR}/control-ui.tgz"

die() { echo "FATAL: $*" >&2; exit 1; }

[[ -f "$GW_TGZ" ]] || die "missing $GW_TGZ"
command -v podman >/dev/null || die "podman required"
[[ -x /usr/local/bin/openbot-gateway-restart ]] || die "missing /usr/local/bin/openbot-gateway-restart"

echo "== preflight =="
curl -fsS http://127.0.0.1:18789/healthz || die "preflight healthz failed"
curl -fsS http://127.0.0.1:18789/readyz || die "preflight readyz failed"
podman exec "$CONTAINER" printenv | grep -E 'OPENBOT_TENANTS_ROOT|OPENBOT_MULTITENANT' || true
TENANTS_ROOT="$(podman exec "$CONTAINER" printenv OPENBOT_TENANTS_ROOT 2>/dev/null || true)"
[[ -n "${TENANTS_ROOT:-}" ]] || die "OPENBOT_TENANTS_ROOT unset — abort (DG0 risk)"
case "$TENANTS_ROOT" in
  /root/.openbot/*) die "OPENBOT_TENANTS_ROOT nested under state root ($TENANTS_ROOT) — abort" ;;
esac

mkdir -p "$BK"
echo "BK=$BK CAND=$CAND OVERLAY=$OVERLAY"

echo "== backup LIVE dist =="
podman exec "$CONTAINER" sh -c 'cd /app && tar czf - dist' >"$BK/container-app-dist.before.tgz"
podman exec "$CONTAINER" cat /app/dist/build-info.json >"$BK/build-info.before.json" || true
if [[ -d /root/.openbot/control-ui ]]; then
  cp -a /root/.openbot/control-ui "$BK/ui-before-control-ui"
fi
sha256sum "$BK/container-app-dist.before.tgz" | tee "$BK/before.sha256"

echo "== stage new dist on host =="
STAGE="$BK/stage-dist"
rm -rf "$STAGE"
mkdir -p "$STAGE"
tar -C "$STAGE" -xzf "$GW_TGZ"
[[ -f "$STAGE/build-info.json" ]] || die "staged dist missing build-info.json"
# Ensure overlay annotation
python3 - <<PY
import json
from pathlib import Path
p=Path("$STAGE/build-info.json")
data=json.loads(p.read_text())
data["commit"]="$CAND"
data["overlay"]="$OVERLAY"
data["buildMode"]="full-dist"
data["cutoverStamp"]="$STAMP"
p.write_text(json.dumps(data, indent=2)+"\n")
print(p.read_text())
PY

echo "== stop + mount + atomic replace (no live empty /app/dist) =="
podman stop -t 20 "$CONTAINER"
MNT="$(podman mount "$CONTAINER")"
[[ -n "$MNT" && -d "$MNT/app/dist" ]] || die "mount failed"
# Replace contents only after full stage exists
rm -rf "$MNT/app/dist"/*
cp -a "$STAGE"/. "$MNT/app/dist/"
[[ -f "$MNT/app/dist/build-info.json" ]] || die "post-copy build-info missing"
podman umount "$CONTAINER"

if [[ -f "$UI_TGZ" ]]; then
  echo "== pin host Control UI =="
  rm -rf /root/.openbot/control-ui
  mkdir -p /root/.openbot/control-ui
  tar -C /root/.openbot/control-ui -xzf "$UI_TGZ"
  # Mirror into container served tree if present after start (restart script may remount)
fi

echo "== restart =="
/usr/local/bin/openbot-gateway-restart
sleep 8

echo "== smoke =="
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:18789/healthz >/tmp/hz.json \
    && curl -fsS http://127.0.0.1:18789/readyz >/tmp/rz.json; then
    break
  fi
  sleep 3
done
cat /tmp/hz.json; echo
cat /tmp/rz.json; echo
grep -q '"ok":true' /tmp/hz.json || die "healthz not ok — ROLLBACK required"
grep -q '"ready":true' /tmp/rz.json || die "readyz not ready — ROLLBACK required"

podman exec "$CONTAINER" cat /app/dist/build-info.json | tee "$BK/build-info.after.json"
# Isolation markers (count JS files still containing bare .broadcast("chat") / .broadcast('chat'))
BARE="$(podman exec "$CONTAINER" sh -c "grep -REl \"\\.broadcast([\\\"']chat[\\\"'])\" /app/dist --include='*.js' 2>/dev/null | wc -l | tr -d ' '")"
BCHAT="$(podman exec "$CONTAINER" sh -c "grep -R \"broadcastChat(\" /app/dist --include='*.js' 2>/dev/null | wc -l | tr -d ' '")"
echo "bareBroadcastFiles=$BARE broadcastChatHits=$BCHAT"
[[ "${BARE:-0}" = "0" ]] || die "bare broadcast(chat) still present"

echo "OK cutover ${OVERLAY} cand=${CAND} stamp=${STAMP}"
echo "Rollback:"
echo "  podman stop -t 10 $CONTAINER"
echo "  MNT=\$(podman mount $CONTAINER)"
echo "  tar -C /tmp/restore-${OVERLAY} -xzf $BK/container-app-dist.before.tgz"
echo "  rm -rf \"\$MNT/app/dist\"/*; cp -a /tmp/restore-${OVERLAY}/. \"\$MNT/app/dist/\""
echo "  podman umount $CONTAINER && /usr/local/bin/openbot-gateway-restart"
