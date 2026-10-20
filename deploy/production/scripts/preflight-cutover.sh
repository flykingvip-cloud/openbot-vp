#!/usr/bin/env bash
# preflight-cutover.sh — checks that must pass BEFORE a production cutover,
# covering the four failure modes that actually bit us on 2026-10-01 and that no
# existing gate catches.
#
# Deliberately NOT re-implemented here (use the existing gates alongside this):
#   deploy/production/scripts/verify-forward-only.sh      Gate 1: is-ancestor(LIVE, candidate)
#   deploy/production/scripts/verify-delivery-alignment.sh Gate 2: tag/origin/image/ledger
#
# What this adds:
#   1. dependency-manifest drift between LIVE and CANDIDATE. A `dist`-only layer
#      is only safe while package.json / pnpm-lock.yaml / ui/package.json are
#      unchanged; otherwise the image's node_modules is stale and the gateway can
#      die at runtime with ERR_MODULE_NOT_FOUND.
#   2. gateway config loads and validates under a FRESH process. `loadConfig` is a
#      per-process snapshot, so an invalid edit is only discovered on restart —
#      i.e. during the outage. This asks a new process to parse it first.
#   3. model providers will actually serve this host, probed with the gateway's
#      own credentials (probe-model-providers.mjs). Google models were geo-blocked
#      ("User location is not supported for the API use") and the only signal was
#      user-visible PDF/vision failures days later. Note a bare GET of the base
#      URL does NOT see this — it answers 404 and looks reachable.
#   4. candidate image smoke. Running `--version` inside the image catches a dist
#      whose hashed chunks no longer resolve.
#
# Read-only: never mutates production, git state, or the running container.
#
# Usage:
#   preflight-cutover.sh --candidate <sha> [--image <ref>] [--host <ssh-target>]
#                        [--container <name>] [--skip-providers]
#
# Exit codes: 0 all checks passed · 30 a check failed · 2 bad usage.

set -uo pipefail

CANDIDATE=""
IMAGE=""
HOST=""
CONTAINER="openbot-gateway-rc"
SKIP_PROVIDERS=0

die_usage() {
  printf 'usage: %s --candidate <sha> [--image <ref>] [--host <ssh-target>] [--container <name>] [--skip-providers]\n' "$(basename "$0")" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --candidate) CANDIDATE="${2:-}"; shift 2 ;;
    --image) IMAGE="${2:-}"; shift 2 ;;
    --host) HOST="${2:-}"; shift 2 ;;
    --container) CONTAINER="${2:-}"; shift 2 ;;
    --skip-providers) SKIP_PROVIDERS=1; shift ;;
    -h|--help) die_usage ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; die_usage ;;
  esac
done

[ -n "$CANDIDATE" ] || die_usage

FAILED=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }
skip() { printf '  SKIP  %s\n' "$1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROBE_MJS="${SCRIPT_DIR}/probe-model-providers.mjs"

# Run a command on the gateway host (or locally when --host is omitted).
remote() {
  if [ -n "$HOST" ]; then
    # BatchMode so a missing key fails fast instead of prompting.
    ssh -o BatchMode=yes -o ConnectTimeout=20 "$HOST" "$@"
  else
    sh -c "$*"
  fi
}

# Same as remote(), but feeds a local file to the remote command's stdin. Used to
# run a readable companion script inside the container without shipping it to the
# host or mangling it through nested shell quoting.
remote_with_stdin() {
  stdin_file="$1"
  shift
  if [ -n "$HOST" ]; then
    ssh -o BatchMode=yes -o ConnectTimeout=60 "$HOST" "$@" <"$stdin_file"
  else
    sh -c "$*" <"$stdin_file"
  fi
}

printf '== preflight for candidate %s ==\n' "$CANDIDATE"

# ---------------------------------------------------------------- 1. LIVE sha
printf '\n[1/5] live artifact\n'
LIVE="$(remote "podman exec ${CONTAINER} cat /app/dist/build-info.json 2>/dev/null" \
  | tr -d '\r' \
  | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{7,40\}\)".*/\1/p' \
  | head -1)"
if [ -z "$LIVE" ]; then
  # Fail closed: without a LIVE sha the dependency comparison below is meaningless.
  fail "could not read the live commit from ${CONTAINER}:/app/dist/build-info.json"
  LIVE=""
else
  pass "live commit ${LIVE}"
fi

# ------------------------------------------------- 2. dependency manifest drift
printf '\n[2/5] dependency manifests (LIVE..CANDIDATE)\n'
if [ -z "$LIVE" ]; then
  skip "no live sha; cannot compare manifests"
elif ! git rev-parse --verify --quiet "$LIVE" >/dev/null; then
  fail "live sha ${LIVE} is not in this clone (fetch it before judging dependency drift)"
elif ! git rev-parse --verify --quiet "$CANDIDATE" >/dev/null; then
  fail "candidate ${CANDIDATE} is not in this clone"
else
  DRIFT="$(git diff --name-only "$LIVE" "$CANDIDATE" -- \
    package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc patches ui/package.json 2>/dev/null)"
  if [ -z "$DRIFT" ]; then
    pass "unchanged; an image whose node_modules predates the candidate is still valid"
  else
    printf '%s\n' "$DRIFT" | sed 's/^/        /'
    # Not fatal on its own: a full image rebuild handles it. It is only fatal for
    # a dist-only layer, which the operator must then not use.
    fail "manifests changed; a dist-only layer is NOT safe — rebuild the full image"
  fi
fi

# -------------------------------------------------------- 3. config validation
printf '\n[3/5] gateway config parses in a fresh process\n'
CFG_KEYS="gateway.bind agents.defaults.model agents.defaults.imageModel agents.defaults.pdfModel"
for key in $CFG_KEYS; do
  OUT="$(remote "podman exec ${CONTAINER} sh -lc 'cd /app && node openbot.mjs config get ${key} 2>&1'" 2>/dev/null | tr -d '\r')"
  case "$OUT" in
    ""|*[Ee]rror*|*error*|*Invalid*|*invalid*) fail "config get ${key}: ${OUT:-<empty>}" ;;
    *) pass "config get ${key}" ;;
  esac
done

# ------------------------------------------------- 4. provider will serve us
printf '\n[4/5] configured model providers answer an authenticated call\n'
if [ "$SKIP_PROVIDERS" -eq 1 ]; then
  skip "--skip-providers"
elif [ ! -f "$PROBE_MJS" ]; then
  fail "companion probe missing: ${PROBE_MJS}"
else
  # Deliberately an authenticated model-list call, not a GET of the base URL: a
  # bare GET of generativelanguage.googleapis.com/v1beta answers 404 ("reachable")
  # while the authenticated call returns 400 FAILED_PRECONDITION "User location is
  # not supported for the API use" — which is the failure that actually shipped.
  # The probe runs inside the container so it reads the same config and keys the
  # gateway uses, and it scrubs those keys from everything it prints.
  PROBE_OUT="$(remote_with_stdin "$PROBE_MJS" \
    "podman exec -i ${CONTAINER} node --input-type=module - 2>/dev/null" 2>/dev/null | tr -d '\r')"
  if [ -z "$PROBE_OUT" ]; then
    fail "provider probe produced no output (could not run node inside ${CONTAINER})"
  else
    while IFS="$(printf '\t')" read -r p_name p_api p_code p_verdict p_detail; do
      [ -n "$p_name" ] || continue
      case "$p_verdict" in
        OK) pass "${p_name} (${p_api}) answers ${p_code}" ;;
        SKIP) skip "${p_name}: ${p_detail}" ;;
        REFUSED) fail "${p_name} (${p_api}) answered ${p_code} but refused: ${p_detail}" ;;
        UNREACHABLE) fail "${p_name} (${p_api}) unreachable: ${p_detail}" ;;
        *) fail "${p_name}: unparsed probe record (${p_verdict}) ${p_detail}" ;;
      esac
    done <<EOF
$PROBE_OUT
EOF
  fi
fi

# ------------------------------------------------------- 5. candidate image smoke
if [ -n "$IMAGE" ]; then
  printf '\n[5/5] candidate image smoke\n'
  VER="$(remote "podman run --rm --entrypoint node '${IMAGE}' /app/openbot.mjs --version 2>&1" 2>/dev/null | tr -d '\r' | tail -1)"
  if [ -z "$VER" ]; then
    fail "image did not run: ${IMAGE}"
  else
    case "$VER" in
      *ERR_MODULE_NOT_FOUND*|*[Ee]rror*) fail "image smoke: ${VER}" ;;
      *) pass "image smoke: ${VER}" ;;
    esac
  fi
  IMG_SHA="$(remote "podman run --rm --entrypoint cat '${IMAGE}' /app/dist/build-info.json 2>/dev/null" 2>/dev/null \
    | tr -d '\r' | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{7,40\}\)".*/\1/p' | head -1)"
  if [ -z "$IMG_SHA" ]; then
    fail "image has no build-info commit"
  # build-info may carry a short sha while --candidate is full (or vice versa),
  # so accept either being a prefix of the other.
  elif [ "${CANDIDATE#"$IMG_SHA"}" != "$CANDIDATE" ] || [ "${IMG_SHA#"$CANDIDATE"}" != "$IMG_SHA" ]; then
    pass "image build-info ${IMG_SHA} matches the candidate"
  else
    fail "image build-info is ${IMG_SHA}, expected ${CANDIDATE}"
  fi
else
  printf '\n[5/5] candidate image smoke\n'
  skip "--image not given; the image that will actually run was not tested"
fi

printf '\n'
if [ "$FAILED" -ne 0 ]; then
  printf 'preflight FAILED — do not cut over.\n'
  exit 30
fi
printf 'preflight passed.\n'
