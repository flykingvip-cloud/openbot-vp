#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="openbot-sandbox:bookworm-slim"
# Temporary alias so configs and hosts that still name openclaw-sandbox keep working.
LEGACY_IMAGE_NAME="openclaw-sandbox:bookworm-slim"

# Build from canonical Dockerfile.sandbox only (Debian trixie-slim + apt
# nodejs/npm/chromium/poppler/fonts). The published tag stays bookworm-slim.
# Do NOT substitute a FROM node:* Dockerfile: official node images own
# uid 1000, so naive `useradd sandbox` becomes 1001 and LIVE workspace mounts
# (chowned to SANDBOX_RUNTIME_UID=1000) are EACCES inside the container.
docker build -t "${IMAGE_NAME}" -f Dockerfile.sandbox .
docker tag "${IMAGE_NAME}" "${LEGACY_IMAGE_NAME}"

"$(dirname "$0")/sandbox-image-smoke.sh" "${IMAGE_NAME}"

echo "Built ${IMAGE_NAME} (temporary alias ${LEGACY_IMAGE_NAME})"
