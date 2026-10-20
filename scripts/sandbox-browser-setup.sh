#!/usr/bin/env bash
set -euo pipefail

# Wallpaper, the OpenBot logo, the local start page, and the Account Computer
# file names under /tmp (openbot-home, openbot-desktop.log, openbot-openbox.log)
# are baked into this image's tip (the COPY of the entrypoint and desktop).
# A running container does not see them until this script is rebuilt and the
# sandbox is recreated. The apt layer stays cached. OPENBOT_ACCOUNT_WORKER and
# OPENBOT_ACCOUNT_WORKER_DOCKER: P6b unset→ON (set 0 to opt out); rebuild ≠ live cutover.
# Rebuilding is not a production cutover.
IMAGE_NAME="openbot-sandbox-browser:bookworm-slim"
# Temporary alias so configs and hosts that still name the previous browser image keep working.
LEGACY_IMAGE_NAME="openclaw-sandbox-browser:bookworm-slim"

docker build -t "${IMAGE_NAME}" -f Dockerfile.sandbox-browser .
docker tag "${IMAGE_NAME}" "${LEGACY_IMAGE_NAME}"
echo "Built ${IMAGE_NAME} (temporary alias ${LEGACY_IMAGE_NAME})"
echo "Recreate the sandbox browser container to see the wallpaper, OpenBot start page, and /tmp/openbot-* file names."
