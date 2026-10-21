#!/usr/bin/env bash
# cutover-from-ghcr.sh — verify and stage a CI-published GHCR image for production.
#
# Why: production images used to be compiled on the 3.5 GB production host, which
# has been OOM-killed mid-build (see RELEASE_RECORD.md "Still open"). Docker Release
# now publishes immutable images for `main`, `v*`, `provenance/sha-*` and
# `baseline/*`, so the host can pull a verified image instead of building one.
#
# Runs from a maintainer checkout and drives the production host over SSH, reusing
# the conventions already used by scripts/delivery/resolve-live-sha.ts
# (OPENBOT_PRODUCTION_SSH_HOST, OPENBOT_PRODUCTION_CONTAINER,
# OPENBOT_PRODUCTION_BUILD_INFO_PATH).
#
# Deliberately does NOT swap the live container. Recreating `openbot-gateway-rc`
# needs judgement that varies per release (full-dist overlay versus recreate, and
# whether env/mounts changed), and a half-automated swap that renames the live
# container without reliably starting its replacement would take production down.
# This script therefore proves the image is the right one, stages it on the host,
# and prints the exact swap and rollback commands for the operator to run.
#
# Gates (fail closed):
#   plan          : forward-only, with LIVE read from the running artifact
#   stage         : image revision label == candidate, and image build-info == candidate
#   verify-live   : container build-info == candidate, healthz 200, readyz ready:true
#
# The GHCR package is private, so the host must already be logged in with a
# read-only token:  podman login ghcr.io -u <user> --password-stdin
#
# Exit codes: 0 ok · 2 usage · 20 candidate behind/diverged · 21 LIVE unknown · 1 other

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Set OPENBOT_PRODUCTION_SSH_HOST=local when running on the production host itself.
SSH_HOST="${OPENBOT_PRODUCTION_SSH_HOST:-root@8.217.93.71}"
LOCAL_EXEC=false
if [[ "$SSH_HOST" == "local" || "$SSH_HOST" == "localhost" ]]; then
  LOCAL_EXEC=true
fi
CONTAINER="${OPENBOT_PRODUCTION_CONTAINER:-openbot-gateway-rc}"
BUILD_INFO_PATH="${OPENBOT_PRODUCTION_BUILD_INFO_PATH:-/app/dist/build-info.json}"
IMAGE_REPO="${OPENBOT_GHCR_IMAGE:-ghcr.io/upbeyond/openbot}"
HEALTH_URL="${OPENBOT_PRODUCTION_HEALTH_URL:-http://127.0.0.1:18789/healthz}"
READY_URL="${OPENBOT_PRODUCTION_READY_URL:-http://127.0.0.1:18789/readyz}"

MODE="plan"
CANDIDATE=""
SLUG=""
DIGEST=""
IMAGE_TAG=""
INTENTIONAL_REVERT=""
RECORD=false

die() {
  echo "ERROR: $*" >&2
  exit 1
}

# Env-supplied values also reach the ssh command line, so validate them too.
[[ "$SSH_HOST" =~ ^[A-Za-z0-9._@-]+$ ]] ||
  die "OPENBOT_PRODUCTION_SSH_HOST must match ^[A-Za-z0-9._@-]+$"
[[ "$CONTAINER" =~ ^[A-Za-z0-9._-]+$ ]] ||
  die "OPENBOT_PRODUCTION_CONTAINER must match ^[A-Za-z0-9._-]+$"

usage() {
  cat <<'USAGE'
cutover-from-ghcr.sh — verify and stage a CI-published GHCR image for production.

Usage:
  cutover-from-ghcr.sh --candidate <full-sha> [--digest <sha256:...> | --image-tag <tag>] [mode]

Modes (pick one; default --plan):
  --plan          run the forward-only gate, print the swap plan and the live spec
  --stage         also pull on the host and assert provenance + artifact commit
  --verify-live   assert the running container is the candidate (run after the swap)

Options:
  --candidate <sha>        40-hex commit to cut over to (required)
  --slug <name>            short release slug for the local image alias
  --digest <sha256:...>    pull this exact manifest digest (strongest provenance)
  --image-tag <tag>        pull this GHCR tag (e.g. provenance-sha-2a45057c6671)
  --intentional-revert <r> approved rollback; forwarded to the forward-only gate
  --record                 refuse a local ledger write and print the OHBE ledger URL
  -h, --help               show this help

Environment:
  OPENBOT_PRODUCTION_SSH_HOST         default root@8.217.93.71
  OPENBOT_PRODUCTION_CONTAINER        default openbot-gateway-rc
  OPENBOT_PRODUCTION_BUILD_INFO_PATH  default /app/dist/build-info.json
  OPENBOT_GHCR_IMAGE                  default ghcr.io/upbeyond/openbot
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plan)
      MODE="plan"
      shift
      ;;
    --stage)
      MODE="stage"
      shift
      ;;
    --verify-live)
      MODE="verify-live"
      shift
      ;;
    --candidate)
      CANDIDATE="${2:-}"
      shift 2
      ;;
    --slug)
      SLUG="${2:-}"
      shift 2
      ;;
    --digest)
      DIGEST="${2:-}"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG="${2:-}"
      shift 2
      ;;
    --intentional-revert)
      INTENTIONAL_REVERT="${2:-}"
      shift 2
      ;;
    --record)
      RECORD=true
      shift
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

# Validate every value that reaches an ssh command line, so a malformed argument
# cannot inject remote commands.
if [[ -z "$CANDIDATE" ]]; then
  usage >&2
  exit 2
fi
[[ "$CANDIDATE" =~ ^[0-9a-f]{40}$ ]] || die "--candidate must be a full 40-hex sha"
[[ -z "$SLUG" || "$SLUG" =~ ^[A-Za-z0-9._-]+$ ]] || die "--slug must match ^[A-Za-z0-9._-]+$"
[[ -z "$DIGEST" || "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || die "--digest must be sha256:<64-hex>"
[[ -z "$IMAGE_TAG" || "$IMAGE_TAG" =~ ^[A-Za-z0-9._-]+$ ]] || die "--image-tag must match ^[A-Za-z0-9._-]+$"

if [[ "$MODE" == "stage" && -z "$DIGEST" && -z "$IMAGE_TAG" ]]; then
  die "--stage needs --digest or --image-tag"
fi

if [[ -n "$DIGEST" ]]; then
  PULL_REF="${IMAGE_REPO}@${DIGEST}"
elif [[ -n "$IMAGE_TAG" ]]; then
  PULL_REF="${IMAGE_REPO}:${IMAGE_TAG}"
else
  PULL_REF=""
fi

# Image aliases in the ledger use 10 hex (rc-amd64-provenance-2a45057c66-...),
# while the most recent provenance tag uses 12 (provenance/sha-2a45057c6671).
SHORT="${CANDIDATE:0:10}"
TAG_SHORT="${CANDIDATE:0:12}"
LOCAL_ALIAS="localhost/openbot:rc-amd64-provenance-${SHORT}${SLUG:+-${SLUG}}"

run_host() {
  # Running directly on the production host is the normal operator position, and
  # there ssh-to-self has no key and would fail. Execute in place instead.
  if [[ "$LOCAL_EXEC" == true ]]; then
    "$@"
    return
  fi
  # ssh concatenates its command arguments into one string that the remote shell
  # re-parses, so local quoting is lost. Quote each argument for the remote shell
  # explicitly; without this, a --format template containing spaces and double
  # quotes is split into several remote arguments and podman fails.
  remote_cmd=""
  for arg in "$@"; do
    remote_cmd+=" $(printf '%q' "$arg")"
  done
  ssh -o BatchMode=yes "$SSH_HOST" "$remote_cmd"
}

# Prefix for the copy-pasteable commands this script prints. Empty when local.
host_prefix() {
  if [[ "$LOCAL_EXEC" == true ]]; then
    printf ''
  else
    printf 'ssh %s ' "$SSH_HOST"
  fi
}

read_commit() {
  # Extracts the commit field from a build-info.json payload on stdin.
  sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{7,40\}\)".*/\1/p' | head -1
}

live_build_info() {
  run_host podman exec "$CONTAINER" cat "$BUILD_INFO_PATH"
}

emit_ledger_row() {
  # Production rows are appended in OHBE. This script must not recreate the
  # duplicated deploy/production/releases.jsonl in openbot-vp.
  ledger_url="https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl"
  live_from="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  executor="${OPENBOT_CUTOVER_EXECUTOR:-$(git config user.name 2> /dev/null || echo operator)}"
  ledger_image_tag="${LOCAL_ALIAS#localhost/openbot:}"
  evidence="container build-info (commit=${CANDIDATE})"
  notes="pulled from GHCR; no host build"

  if [[ "$RECORD" == true && "$MODE" != "verify-live" ]]; then
    echo "NOTE: --record is only honored with --verify-live (evidence must be observed)."
  fi
  if [[ "$RECORD" == true && "$MODE" == "verify-live" && -z "$DIGEST" ]]; then
    DIGEST="$(run_host podman inspect --format '{{.ImageDigest}}' "$CONTAINER" || true)"
    [[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] ||
      die "cannot describe a v2 ledger row without artifactDigest; pass --digest sha256:<64-hex>"
  fi
  cat <<EOF
--- production ledger is OHBE, not this repo ---
  Append the cutover row in:
  ${ledger_url}
  See deploy/production/LEDGER.md.
  refusing to append deploy/production/releases.jsonl in openbot-vp
  gateway-sha ${CANDIDATE}
  ui-sha ${CANDIDATE}
  build-mode full-dist
  artifact-kind image
  artifact-id ${ledger_image_tag}
  artifact-digest ${DIGEST:-sha256:REPLACE_WITH_OBSERVED_DIGEST}
  tag provenance/sha-${TAG_SHORT}
  live-from ${live_from}
  evidence ${evidence}
  executor ${executor}
  notes ${notes}
  live-verified
EOF
  if [[ -n "$INTENTIONAL_REVERT" ]]; then
    echo "  intentional-revert ${INTENTIONAL_REVERT}"
  fi
  if [[ "$RECORD" == true && "$MODE" == "verify-live" ]]; then
    die "refusing to append deploy/production/releases.jsonl in openbot-vp; record the row in OHBE: ${ledger_url}"
  fi
  cat <<EOF

--- close out ---
  git tag -a provenance/sha-${TAG_SHORT} ${CANDIDATE} -m "production cutover"
  pnpm delivery:merge-back-plan -- --cutover-sha ${CANDIDATE}
EOF
}

echo "=== OpenBot cutover from GHCR ($MODE) ==="
if [[ "$LOCAL_EXEC" == true ]]; then
  echo "host           : local (running on the production host)"
else
  echo "host           : $SSH_HOST (over ssh)"
fi
echo "container      : $CONTAINER"
echo "candidate      : $CANDIDATE"
[[ -n "$PULL_REF" ]] && echo "pull ref       : $PULL_REF"
echo "local alias    : $LOCAL_ALIAS"
echo

# ── verify-live: assert the running container is already the candidate ───────────
if [[ "$MODE" == "verify-live" ]]; then
  after_json="$(live_build_info)" || die "container $CONTAINER not readable"
  after_sha="$(printf '%s' "$after_json" | read_commit)"
  [[ "$after_sha" == "$CANDIDATE" ]] || die "live build-info ($after_sha) != candidate ($CANDIDATE)"
  echo "build-info     : $after_sha (matches)"

  health="$(run_host curl -fsS -o /dev/null -w '%{http_code}' "$HEALTH_URL")"
  [[ "$health" == "200" ]] || die "healthz returned $health"
  echo "healthz        : 200"

  ready_body="$(run_host curl -fsS "$READY_URL")"
  printf '%s' "$ready_body" | grep -q '"ready"[[:space:]]*:[[:space:]]*true' ||
    die "readyz not ready: $ready_body"
  printf '%s' "$ready_body" | grep -q '"failing"[[:space:]]*:[[:space:]]*\[[[:space:]]*\]' ||
    die "readyz reports failing checks: $ready_body"
  echo "readyz         : ready:true, failing:[]"
  echo "verify-live    : PASS"
  emit_ledger_row
  exit 0
fi

# ── Precondition: the forward-only gate compares git history, so the checkout this
# script lives in must actually contain the candidate commit. On the production host
# that checkout is often absent or stale, which would otherwise surface as a
# confusing failure inside the gate. ────────────────────────────────────────────
# Not `-d "$ROOT/.git"`: inside a git worktree that path is a file, not a directory.
git -C "$ROOT" rev-parse --git-dir > /dev/null 2>&1 ||
  die "no git checkout at $ROOT; the forward-only gate needs repository history"
git -C "$ROOT" cat-file -e "${CANDIDATE}^{commit}" 2> /dev/null ||
  die "candidate $CANDIDATE is not in the checkout at $ROOT; run: git -C $ROOT fetch origin"

# ── Gate: forward-only, with LIVE read from the running artifact ─────────────────
echo "--- gate: forward-only ---"
live_json="$(live_build_info)" ||
  die "could not read $BUILD_INFO_PATH from $CONTAINER (LIVE unknown)"
live_sha="$(printf '%s' "$live_json" | read_commit)"
[[ -n "$live_sha" ]] || die "no commit field in $BUILD_INFO_PATH (LIVE unknown)"
echo "LIVE commit    : $live_sha"

guard_args=(--candidate "$CANDIDATE" --live-sha "$live_sha")
if [[ -n "$INTENTIONAL_REVERT" ]]; then
  guard_args+=(--intentional-revert "$INTENTIONAL_REVERT")
fi
"$ROOT/deploy/production/scripts/verify-forward-only.sh" "${guard_args[@]}"
echo "forward-only   : PASS"
echo

# ── stage: pull on the host and prove the image is the candidate ─────────────────
if [[ "$MODE" == "stage" ]]; then
  echo "--- pull ---"
  run_host podman pull "$PULL_REF"

  echo "--- gate: provenance label ---"
  revision="$(run_host podman image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$PULL_REF")"
  revision="${revision//[$'\r\n']/}"
  [[ "$revision" == "$CANDIDATE" ]] ||
    die "image revision label ($revision) != candidate ($CANDIDATE)"
  echo "revision label : $revision (matches)"

  echo "--- gate: artifact build-info ---"
  pulled_json="$(run_host podman run --rm --entrypoint cat "$PULL_REF" "$BUILD_INFO_PATH")"
  pulled_sha="$(printf '%s' "$pulled_json" | read_commit)"
  [[ "$pulled_sha" == "$CANDIDATE" ]] ||
    die "pulled build-info commit ($pulled_sha) != candidate ($CANDIDATE)"
  echo "build-info     : $pulled_sha (matches)"

  run_host podman tag "$PULL_REF" "$LOCAL_ALIAS"
  echo "tagged         : $LOCAL_ALIAS"
  echo
fi

# ── Live spec, so the operator's recreate cannot drift from what was running ─────
echo "--- live container spec (recreate reference) ---"
# Single-line template on purpose: a template containing newlines would be split
# by the remote shell. Fields are pipe-delimited and expanded locally.
spec="$(run_host podman inspect "$CONTAINER" --format '{{.ImageName}}|{{.HostConfig.NetworkMode}}|{{.Config.User}}|{{.HostConfig.RestartPolicy.Name}}|{{.Config.Cmd}}|{{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}')"
IFS='|' read -r spec_image spec_network spec_user spec_restart spec_cmd spec_mounts <<< "$spec"
echo "image          : $spec_image"
echo "network        : $spec_network"
echo "user           : ${spec_user:-<root>}"
echo "restart        : $spec_restart"
echo "cmd            : $spec_cmd"
echo "mounts         : $spec_mounts"
echo "ports          : $(run_host podman inspect "$CONTAINER" --format '{{.HostConfig.PortBindings}}')"
# Names only. Values would print provider keys and channel tokens in clear, and
# every variable must be carried forward, not just the OPENBOT_-prefixed ones.
echo "env names      : (carry ALL of these forward, values not printed)"
run_host podman inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/  \1/p'
echo
HP="$(host_prefix)"
echo "Full spec for scripting the recreate:"
echo "  ${HP}podman inspect $CONTAINER"
echo

SAFETY="${CONTAINER}-prev-${live_sha:0:10}-safety"
cat <<EOF
--- swap (run manually; this script does not touch the live container) ---
# stop first: rename leaves the old container running and it still holds :18789,
# so the replacement would fail to bind.
${HP}podman stop $CONTAINER
${HP}podman rename $CONTAINER $SAFETY
# recreate $CONTAINER from $LOCAL_ALIAS using the spec above (all env, mounts,
# network, user, restart policy and port bindings), then:
${HP}podman start $CONTAINER
$0 --verify-live --candidate $CANDIDATE

--- rollback ---
${HP}podman rm -f $CONTAINER
${HP}podman rename $SAFETY $CONTAINER
${HP}podman start $CONTAINER
EOF
echo

emit_ledger_row
