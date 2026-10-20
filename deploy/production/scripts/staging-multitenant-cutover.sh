#!/usr/bin/env bash
# Recreate staging gateway with OPENBOT_MULTITENANT=1 for a dedicated smoke window.
# Reverts by removing the var from .env.docker and re-running with multitenant=0.
set -euo pipefail

STAGING_HOST="${STAGING_HOST:-root@8.217.93.71}"
CONTAINER="${OPENBOT_GATEWAY_CONTAINER:-openbot-gateway-rc}"
ENV_FILE="${OPENBOT_ENV_FILE:-/root/.openbot/.env.docker}"
IMAGE="${OPENBOT_STAGING_IMAGE:-docker.io/library/openbot:rc-amd64-v2}"
ENABLE="${1:-1}"

ssh -o BatchMode=yes "$STAGING_HOST" bash -s <<REMOTE
set -euo pipefail
ENV_FILE='$ENV_FILE'
CONTAINER='$CONTAINER'
IMAGE='$IMAGE'
ENABLE='$ENABLE'

if [ "\$ENABLE" = "1" ]; then
  if ! grep -q '^OPENBOT_MULTITENANT=' "\$ENV_FILE" 2>/dev/null; then
    echo 'OPENBOT_MULTITENANT=1' >>"\$ENV_FILE"
  else
    sed -i 's/^OPENBOT_MULTITENANT=.*/OPENBOT_MULTITENANT=1/' "\$ENV_FILE"
  fi
else
  if grep -q '^OPENBOT_MULTITENANT=' "\$ENV_FILE" 2>/dev/null; then
    sed -i 's/^OPENBOT_MULTITENANT=.*/OPENBOT_MULTITENANT=0/' "\$ENV_FILE"
  fi
fi

RUNTIME=podman
command -v podman >/dev/null 2>&1 || RUNTIME=docker
\$RUNTIME rm -f "\$CONTAINER" 2>/dev/null || true
\$RUNTIME run -d --name "\$CONTAINER" --network host --user 0 \\
  -v /root/.openbot:/root/.openbot \\
  -v /var/tmp/openbot-compile-cache:/var/tmp/openbot-compile-cache \\
  --env-file "\$ENV_FILE" \\
  "\$IMAGE" \\
  node openbot.mjs gateway --bind loopback --port 18789
sleep 12
curl -sS -o /dev/null -w 'healthz=%{http_code}\n' http://127.0.0.1:18789/healthz
\$RUNTIME exec "\$CONTAINER" printenv OPENBOT_MULTITENANT || true
REMOTE

echo "Done. Run deploy/production/scripts/staging-multitenant-smoke.sh on host for gates."
