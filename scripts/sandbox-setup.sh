#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="openbot-sandbox:bookworm-slim"
# Temporary alias so configs and hosts that still name openclaw-sandbox keep working.
LEGACY_IMAGE_NAME="openclaw-sandbox:bookworm-slim"

# Build from canonical Dockerfile.sandbox only (debian-slim + apt nodejs/npm).
# Do NOT substitute a FROM node:* noapt Dockerfile: official node images own
# uid 1000, so naive `useradd sandbox` becomes 1001 and LIVE workspace mounts
# (chowned to SANDBOX_RUNTIME_UID=1000) are EACCES inside the container.
docker build -t "${IMAGE_NAME}" -f Dockerfile.sandbox .
docker tag "${IMAGE_NAME}" "${LEGACY_IMAGE_NAME}"

# Fail loud if the image user is not 1000:1000 (gateway ownership contract).
runtime_uid="$(docker run --rm --entrypoint id "${IMAGE_NAME}" -u)"
runtime_gid="$(docker run --rm --entrypoint id "${IMAGE_NAME}" -g)"
if [[ "${runtime_uid}" != "1000" || "${runtime_gid}" != "1000" ]]; then
  echo "error: ${IMAGE_NAME} runtime uid:gid is ${runtime_uid}:${runtime_gid}, expected 1000:1000" >&2
  echo "hint: never FROM node:* + naive useradd sandbox; use Dockerfile.sandbox" >&2
  exit 1
fi

echo "Built ${IMAGE_NAME} (temporary alias ${LEGACY_IMAGE_NAME}; sandbox uid:gid ${runtime_uid}:${runtime_gid})"
