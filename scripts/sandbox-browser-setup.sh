#!/usr/bin/env bash
set -euo pipefail

# Wallpaper, the OpenBot logo, the local start page, and the Account Computer
# file names under /tmp (openbot-home, openbot-desktop.log, openbot-openbox.log)
# are baked into this image's tip (the COPY of the entrypoint and desktop).
# A running container does not see them until this script is rebuilt and the
# sandbox is recreated. The apt layer stays cached. OPENBOT_ACCOUNT_WORKER and
# OPENBOT_ACCOUNT_WORKER_DOCKER: P6b unset→ON (set 0 to opt out); rebuild ≠ live cutover.
# Rebuilding is not a production cutover.
#
# Canonical tag is :trixie (Debian 13). Do not retag trixie content as
# :bookworm-slim. Production should lock the immutable image digest printed
# below. Optional peer alias keeps the openclaw-* name on the same trixie image.
IMAGE_NAME="openbot-sandbox-browser:trixie"
LEGACY_IMAGE_NAME="openclaw-sandbox-browser:trixie"

docker build -t "${IMAGE_NAME}" -f Dockerfile.sandbox-browser .
docker tag "${IMAGE_NAME}" "${LEGACY_IMAGE_NAME}"

"$(dirname "$0")/sandbox-browser-image-smoke.sh" "${IMAGE_NAME}"

DIGEST="$(docker image inspect "${IMAGE_NAME}" --format '{{.Id}}')"
echo "Built ${IMAGE_NAME} (temporary peer alias ${LEGACY_IMAGE_NAME})"
echo "Immutable image id: ${DIGEST}"
echo "Record this digest in cutover evidence; production config should lock digest."
echo "Recreate ONE acceptance browser container to validate; do not batch-rebuild aw-browser-*."
