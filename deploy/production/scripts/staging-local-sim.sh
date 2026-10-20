#!/usr/bin/env bash
# Local staging simulation: run openbot:rc with Wave2-ish config + smoke --local-only.
# Does NOT install host nginx (macOS often has no system nginx). Edge smoke needs a real host.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PROD="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${OPENBOT_IMAGE:-openbot:rc}"
NAME="${OPENBOT_STAGING_SIM_NAME:-openbot-staging-sim}"
# Default 18799 to avoid clashing with a host gateway on 18789.
HOST_PORT="${OPENBOT_STAGING_SIM_PORT:-18799}"
WORK="$(mktemp -d /tmp/openbot-staging-sim.XXXXXX)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== staging-local-sim =="
echo "image=$IMAGE work=$WORK"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Missing image $IMAGE — build first: docker build -t openbot:rc $ROOT" >&2
  exit 1
fi

mkdir -p "$WORK/state" "$WORK/workspace"
TOKEN="$(openssl rand -hex 32)"

# Minimal config: local mode + token auth (trusted-proxy needs real proxy headers;
# for container-only health + control-ui-config we use token + mode local).
cat > "$WORK/state/openclaw.json" <<EOF
{
  "gateway": {
    "mode": "local",
    "bind": "lan",
    "port": 18789,
    "auth": {
      "mode": "token",
      "token": "${TOKEN}"
    },
    "controlUi": {
      "enabled": true,
      "allowedOrigins": ["http://127.0.0.1:${HOST_PORT}", "http://localhost:${HOST_PORT}"]
    }
  },
  "data": {
    "mode": "local"
  }
}
EOF

# Stop anything conflicting on host port inside docker mapping only
docker rm -f "$NAME" >/dev/null 2>&1 || true

docker run -d --name "$NAME" \
  -e NODE_ENV=production \
  -e OPENBOT_GATEWAY_TOKEN="$TOKEN" \
  -e OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  -e OPENBOT_STATE_DIR=/home/node/.openclaw \
  -v "$WORK/state:/home/node/.openclaw" \
  -v "$WORK/workspace:/home/node/.openclaw/workspace" \
  -p "127.0.0.1:${HOST_PORT}:18789" \
  "$IMAGE" \
  node dist/index.js gateway --port 18789 --bind lan

echo "waiting for healthz..."
for i in $(seq 1 60); do
  if curl -sS -o /dev/null -w '' --connect-timeout 1 "http://127.0.0.1:${HOST_PORT}/healthz" 2>/dev/null; then
    code=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/healthz" || true)
    if [[ "$code" == "200" ]]; then
      echo "healthy after ${i}s"
      break
    fi
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "gateway failed to become healthy" >&2
    docker logs "$NAME" 2>&1 | tail -40 >&2
    exit 1
  fi
  sleep 1
done

echo
echo "--- docker logs (tail) ---"
docker logs "$NAME" 2>&1 | tail -20
echo

export PATH_SMOKE="$PROD/proxy/smoke.sh"
"$PATH_SMOKE" --local-only --gateway "http://127.0.0.1:${HOST_PORT}"
echo
echo "PASS: local staging simulation OK"
echo "Config/token workdir: $WORK (deleted on exit)"
echo "For full Wave2 edge smoke, use a Linux host + staging-runbook.md"
