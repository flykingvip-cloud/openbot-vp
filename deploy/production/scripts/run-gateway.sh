#!/usr/bin/env bash
# Production-oriented gateway launcher with sandbox docker bake/probe.
#
# Cross-tenant: every tenant on this host needs docker CLI and/or a mounted
# engine socket when sandbox.mode=all / account-worker docker is on.
# Rebuild images with: docker build --build-arg OPENCLAW_INSTALL_DOCKER_CLI=1 ...
# (Dockerfile defaults this ON; pass empty to opt out for slim local images.)
#
# Usage:
#   OPENBOT_IMAGE=localhost/openbot:rc \
#   OPENBOT_STATE_DIR=/root/.openbot \
#   ./deploy/production/scripts/run-gateway.sh
#
set -euo pipefail

IMAGE="${OPENBOT_IMAGE:-${OPENCLAW_IMAGE:-openbot:prod}}"
NAME="${OPENBOT_GATEWAY_NAME:-openbot-gateway-rc}"
STATE_DIR="${OPENBOT_STATE_DIR:-${OPENCLAW_STATE_DIR:-/root/.openbot}}"
ENV_FILE="${OPENBOT_ENV_FILE:-${STATE_DIR}/.env.docker}"
DOCKER_SOCKET="${OPENBOT_DOCKER_SOCKET:-${DOCKER_HOST#unix://}}"
DOCKER_SOCKET="${DOCKER_SOCKET:-/var/run/docker.sock}"
RUNTIME="${OPENBOT_CONTAINER_RUNTIME:-}"
if [[ -z "${RUNTIME}" ]]; then
  if command -v podman >/dev/null 2>&1; then
    RUNTIME=podman
  else
    RUNTIME=docker
  fi
fi

echo "==> Gateway image: ${IMAGE}"
echo "==> Runtime: ${RUNTIME}"
echo "==> State dir: ${STATE_DIR}"

if [[ ! -d "${STATE_DIR}" ]]; then
  echo "ERROR: state dir missing: ${STATE_DIR}" >&2
  exit 1
fi

SOCKET_MOUNT=()
if [[ -S "${DOCKER_SOCKET}" ]]; then
  SOCKET_MOUNT=(-v "${DOCKER_SOCKET}:/var/run/docker.sock")
  echo "==> Mounting engine socket: ${DOCKER_SOCKET}"
else
  echo "WARNING: engine socket not found at ${DOCKER_SOCKET}; relying on baked docker CLI" >&2
fi

echo "==> Recreating ${NAME}"
"${RUNTIME}" rm -f "${NAME}" >/dev/null 2>&1 || true

RUN_ARGS=(
  -d
  --name "${NAME}"
  --restart=unless-stopped
  --network host
  -v "${STATE_DIR}:${STATE_DIR}"
  "${SOCKET_MOUNT[@]}"
)
if [[ -f "${ENV_FILE}" ]]; then
  RUN_ARGS+=(--env-file "${ENV_FILE}")
fi

"${RUNTIME}" run "${RUN_ARGS[@]}" "${IMAGE}" \
  node openbot.mjs gateway --bind loopback --port 18789

echo "==> Probe docker inside gateway (CLI or engine socket)"
sleep 2
if "${RUNTIME}" exec "${NAME}" sh -c 'command -v docker >/dev/null && docker version >/dev/null'; [[ -S /var/run/docker.sock ]] || [[ -S /run/docker.sock ]] || [[ -S /run/podman/podman.sock ]]'; [[ -S /var/run/podman/podman.sock ]]'; then
  echo "PASS: docker runtime available inside gateway"
else
  echo "CRITICAL: docker CLI and engine socket both missing inside ${NAME}" >&2
  echo "  Rebuild with --build-arg OPENCLAW_INSTALL_DOCKER_CLI=1 and/or mount docker.sock" >&2
  echo "  Without this, every tenant hits spawn docker ENOENT." >&2
  exit 1
fi

echo "==> healthz / readyz"
curl -fsS "http://127.0.0.1:18789/healthz" || true
echo
curl -fsS "http://127.0.0.1:18789/readyz" || true
echo
echo "Done. Container: ${NAME}"
