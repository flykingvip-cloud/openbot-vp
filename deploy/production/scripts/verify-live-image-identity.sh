#!/usr/bin/env bash
# verify-live-image-identity.sh — R9 gate: the running artifact must be the image.
#
# Asserts that the running container's `build-info.commit` (the LIVE authority, read the
# same way as scripts/delivery/resolve-live-sha.ts: `podman exec … cat
# /app/dist/build-info.json`) equals the `org.opencontainers.image.revision` label of the
# image the container was created from. A hot overlay of /app/dist makes the two diverge
# (see OHBE ledger seq 34–41:
# https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl),
# so this check is a machine-executable
# detector for the overlay pattern banned by red line R9 in deploy/production/README.md.
#
# Read-only: never mutates the container, images, branches or worktrees.
#
# Exit codes: 0 identity aligned · 20 identity split (overlay or wrong image) ·
#             21 LIVE or label unreadable (fail closed) · 2 usage.
#
# Siblings: verify-forward-only.sh (ancestry), verify-delivery-alignment.sh (L1/L2/L3
# publication; pass --live-image there to include this gate).

set -euo pipefail

# Set OPENBOT_PRODUCTION_SSH_HOST=local when running on the production host itself.
SSH_HOST="${OPENBOT_PRODUCTION_SSH_HOST:-root@8.217.93.71}"
LOCAL_EXEC=false
if [[ "$SSH_HOST" == "local" || "$SSH_HOST" == "localhost" ]]; then
  LOCAL_EXEC=true
fi
CONTAINER="${OPENBOT_PRODUCTION_CONTAINER:-openbot-gateway-rc}"
BUILD_INFO_PATH="${OPENBOT_PRODUCTION_BUILD_INFO_PATH:-/app/dist/build-info.json}"

usage() {
  cat <<'USAGE'
verify-live-image-identity.sh — assert running build-info.commit == image OCI revision.

Usage:
  verify-live-image-identity.sh [--container <name>] [--ssh-host <host|local>]

Environment (same conventions as cutover-from-ghcr.sh / resolve-live-sha.ts):
  OPENBOT_PRODUCTION_SSH_HOST         default root@8.217.93.71 ("local" = run in place)
  OPENBOT_PRODUCTION_CONTAINER        default openbot-gateway-rc
  OPENBOT_PRODUCTION_BUILD_INFO_PATH  default /app/dist/build-info.json
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container)
      CONTAINER="${2:-}"
      shift 2
      ;;
    --ssh-host)
      SSH_HOST="${2:-}"
      [[ "$SSH_HOST" == "local" || "$SSH_HOST" == "localhost" ]] && LOCAL_EXEC=true
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Every value below reaches an ssh command line; validate so a malformed value cannot
# inject remote commands (same guard as cutover-from-ghcr.sh).
[[ "$SSH_HOST" =~ ^[A-Za-z0-9._@-]+$ ]] || {
  echo "ERROR: ssh host must match ^[A-Za-z0-9._@-]+$" >&2
  exit 2
}
[[ "$CONTAINER" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "ERROR: container must match ^[A-Za-z0-9._-]+$" >&2
  exit 2
}

run_host() {
  if [[ "$LOCAL_EXEC" == true ]]; then
    "$@"
    return
  fi
  remote_cmd=""
  for arg in "$@"; do
    remote_cmd+=" $(printf '%q' "$arg")"
  done
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" "$remote_cmd"
}

read_commit() {
  sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{7,40\}\)".*/\1/p' | head -1
}

echo "=== OpenBot live image identity (R9 gate) ==="
if [[ "$LOCAL_EXEC" == true ]]; then
  echo "host           : local"
else
  echo "host           : $SSH_HOST (over ssh)"
fi
echo "container      : $CONTAINER"

# ── LIVE: build-info.commit from the running artifact (the only LIVE authority) ──
live_json="$(run_host podman exec "$CONTAINER" cat "$BUILD_INFO_PATH")" || {
  echo "FAIL: could not read $BUILD_INFO_PATH from $CONTAINER (LIVE unknown, fail closed)" >&2
  exit 21
}
live_sha="$(printf '%s' "$live_json" | read_commit | tr '[:upper:]' '[:lower:]')"
if [[ -z "$live_sha" ]]; then
  echo "FAIL: no commit field in $BUILD_INFO_PATH (LIVE unknown, fail closed)" >&2
  exit 21
fi
echo "build-info     : $live_sha"

# ── Image the container was created from, and its provenance label ──
image_id="$(run_host podman inspect "$CONTAINER" --format '{{.Image}}')" || {
  echo "FAIL: could not inspect container $CONTAINER" >&2
  exit 21
}
image_id="${image_id//[$'\r\n']/}"
image_name="$(run_host podman inspect "$CONTAINER" --format '{{.ImageName}}' || true)"
image_name="${image_name//[$'\r\n']/}"
echo "image          : ${image_name:-<unnamed>} ($image_id)"

revision="$(run_host podman image inspect "$image_id" \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" || {
  echo "FAIL: could not inspect image $image_id" >&2
  exit 21
}
revision="${revision//[$'\r\n']/}"
revision="$(printf '%s' "$revision" | tr '[:upper:]' '[:lower:]')"
if [[ -z "$revision" || "$revision" == "<no value>" ]]; then
  echo "FAIL: image has no org.opencontainers.image.revision label — identity unknown," >&2
  echo "      fail closed. Rebuild from a provenance tag with the revision label set." >&2
  exit 21
fi
echo "OCI revision   : $revision"

# ── Assertion: equal, allowing a documented short/full prefix pair (>= 12 hex) ──
matches=false
if [[ "$live_sha" == "$revision" ]]; then
  matches=true
elif [[ ${#live_sha} -ge 12 && "$revision" == "$live_sha"* ]]; then
  matches=true
elif [[ ${#revision} -ge 12 && "$live_sha" == "$revision"* ]]; then
  matches=true
fi

if [[ "$matches" == true ]]; then
  echo "identity       : PASS (running artifact matches the image provenance)"
  exit 0
fi

cat >&2 <<EOF
identity       : FAIL — build-info.commit ($live_sha) != image OCI revision ($revision)
This is the R9 overlay signature: /app/dist was replaced inside the running container,
or the container runs an image whose provenance label does not match its artifact.
Remediation: recreate the container from an image built at provenance/sha-${live_sha:0:12}
(see deploy/production/README.md "Overlay ban (R9)"); register any break-glass overlay in
deploy/production/RELEASE_RECORD.md.
EOF
exit 20
