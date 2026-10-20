#!/usr/bin/env bash
# verify-delivery-alignment.sh — L1/L2/L3 delivery chain check
# See: docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md
#
# Fail closed: PROD_SHA and CANDIDATE_SHA must be supplied (flag or env).
# The 2026-07-20 convergence SHAs are never implicit defaults.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

PROD_SHA="${PROD_SHA:-}"
PROD_SOT_BRANCH="${PROD_SOT_BRANCH:-main}"
CANDIDATE_TAG="${CANDIDATE_TAG:-}"
CANDIDATE_SHA="${CANDIDATE_SHA:-}"
PROD_IMAGE="${PROD_IMAGE:-}"
CANDIDATE_IMAGE="${CANDIDATE_IMAGE:-}"
REMOTE="${REMOTE:-origin}"
LIVE_IMAGE_CHECK=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prod-sha) PROD_SHA="$2"; shift 2 ;;
    --candidate-tag) CANDIDATE_TAG="$2"; shift 2 ;;
    --candidate-sha) CANDIDATE_SHA="$2"; shift 2 ;;
    --prod-image-hint) PROD_IMAGE="$2"; shift 2 ;;
    --candidate-image-hint) CANDIDATE_IMAGE="$2"; shift 2 ;;
    --remote) REMOTE="$2"; shift 2 ;;
    # R9 gate: also assert the RUNNING container's build-info.commit equals its image's
    # OCI revision label (overlay detector). Opt-in because it needs host/podman access.
    --live-image) LIVE_IMAGE_CHECK=true; shift ;;
    -h|--help)
      sed -n '1,40p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$PROD_SHA" || -z "$CANDIDATE_SHA" ]]; then
  echo "ERROR: PROD_SHA and CANDIDATE_SHA are required (fail closed)." >&2
  echo "The 2026-07-20 convergence SHAs are not implicit defaults." >&2
  echo "Usage: $0 --prod-sha <live> --candidate-sha <candidate> [--candidate-tag <tag>]" >&2
  echo "   or: PROD_SHA=<live> CANDIDATE_SHA=<candidate> $0" >&2
  exit 2
fi

PROD_SHA="$(git rev-parse "$PROD_SHA")"
CANDIDATE_SHA="$(git rev-parse --verify "$CANDIDATE_SHA^{commit}")"

ok=0
warn=0
fail=0
note() { echo "  · $*"; }
pass() { echo "PASS  $*"; ok=$((ok + 1)); }
warn() { echo "WARN  $*"; warn=$((warn + 1)); }
fail() { echo "FAIL  $*"; fail=$((fail + 1)); }

echo "=== OpenBot delivery alignment ==="
echo "ROOT=$ROOT"
echo "PROD_SHA=$PROD_SHA"
echo "CANDIDATE_TAG=$CANDIDATE_TAG (expect $CANDIDATE_SHA)"
echo "REMOTE=$REMOTE"
echo

# --- L1 local objects ---
if git cat-file -t "$CANDIDATE_SHA" >/dev/null 2>&1; then
  pass "L1 candidate SHA exists locally"
else
  fail "L1 candidate SHA missing locally: $CANDIDATE_SHA"
fi

if git cat-file -t "$PROD_SHA" >/dev/null 2>&1; then
  pass "L1 prod SHA exists locally"
else
  warn "L1 prod SHA missing locally: $PROD_SHA"
fi

# --- L1 tag (only when an explicit candidate tag is supplied) ---
if [[ -n "$CANDIDATE_TAG" ]]; then
  if git rev-parse -q --verify "refs/tags/$CANDIDATE_TAG" >/dev/null; then
    tag_sha="$(git rev-list -n1 "$CANDIDATE_TAG")"
    if [[ "$tag_sha" == "$CANDIDATE_SHA" ]]; then
      pass "L1 tag $CANDIDATE_TAG → $CANDIDATE_SHA"
    else
      fail "L1 tag $CANDIDATE_TAG → $tag_sha (want $CANDIDATE_SHA)"
    fi
  else
    fail "L1 tag missing: $CANDIDATE_TAG"
  fi
else
  warn "CANDIDATE_TAG unset; skipping L1/L2 tag checks"
fi

# --- L2 remote ---
if [[ -n "$CANDIDATE_TAG" ]]; then
  if git ls-remote --exit-code "$REMOTE" "refs/tags/$CANDIDATE_TAG" >/dev/null 2>&1; then
    remote_tag_sha="$(git ls-remote "$REMOTE" "refs/tags/$CANDIDATE_TAG" | awk '{print $1}' | head -1)"
    # annotated tags: ls-remote may show tag object; peel if needed
    if git cat-file -t "$remote_tag_sha" 2>/dev/null | grep -q tag; then
      peeled="$(git rev-parse "${remote_tag_sha}^{commit}" 2>/dev/null || true)"
      [[ -n "$peeled" ]] && remote_tag_sha="$peeled"
    fi
    if [[ "$remote_tag_sha" == "$CANDIDATE_SHA" ]] || git rev-parse -q --verify "$remote_tag_sha^{commit}" >/dev/null 2>&1 && [[ "$(git rev-parse "$remote_tag_sha^{commit}")" == "$CANDIDATE_SHA" ]]; then
      pass "L2 origin has tag $CANDIDATE_TAG at candidate SHA"
    else
      # compare short
      if [[ "${remote_tag_sha:0:12}" == "${CANDIDATE_SHA:0:12}" ]]; then
        pass "L2 origin tag $CANDIDATE_TAG matches candidate (peeled/short)"
      else
        fail "L2 origin tag $CANDIDATE_TAG → $remote_tag_sha (want $CANDIDATE_SHA)"
      fi
    fi
  else
    fail "L2 origin missing tag $CANDIDATE_TAG (candidate not on GitHub)"
  fi
fi

# --- L3 images (local docker; only when an image hint is supplied) ---
if command -v docker >/dev/null 2>&1; then
  if [[ -n "$CANDIDATE_IMAGE" ]]; then
    if docker image inspect "$CANDIDATE_IMAGE" >/dev/null 2>&1; then
      ver="$(docker run --rm --platform linux/amd64 --entrypoint node "$CANDIDATE_IMAGE" openbot.mjs --version 2>/dev/null || true)"
      note "candidate image version: $ver"
      if echo "$ver" | grep -q "${CANDIDATE_SHA:0:7}"; then
        pass "L3-local candidate image pins short SHA ${CANDIDATE_SHA:0:7}"
      else
        warn "L3-local candidate image version mismatch or unreadable: $ver"
      fi
    else
      warn "L3-local candidate image not present: $CANDIDATE_IMAGE"
    fi
  fi
  if [[ -n "$PROD_IMAGE" ]]; then
    if docker image inspect "$PROD_IMAGE" >/dev/null 2>&1; then
      pass "L3-local prod image hint present: $PROD_IMAGE"
    else
      warn "L3-local prod image not on this machine: $PROD_IMAGE"
    fi
  fi
else
  warn "docker not available; skip L3 image checks"
fi

# --- RELEASE_RECORD (SoT is origin/main; do not fall back to a frozen July branch) ---
RR="deploy/production/RELEASE_RECORD.md"
prod_rr_ok=0
local_stale=0
if [[ -f "$RR" ]] && grep -q "STALE — NOT L3 SoT" "$RR"; then
  local_stale=1
  warn "local RELEASE_RECORD marked STALE"
fi
if [[ "$local_stale" -eq 0 ]] && [[ -f "$RR" ]] && grep -q "$PROD_SHA" "$RR"; then
  pass "local RELEASE_RECORD mentions prod SHA"
  prod_rr_ok=1
elif [[ -f "$RR" ]] && [[ "$local_stale" -eq 0 ]]; then
  warn "local RELEASE_RECORD missing prod SHA"
fi
if [[ "$prod_rr_ok" -eq 0 ]]; then
  sot_rr="$(git show "$REMOTE/$PROD_SOT_BRANCH:deploy/production/RELEASE_RECORD.md" 2>/dev/null || true)"
  if [[ -n "$sot_rr" ]] && echo "$sot_rr" | grep -q "$PROD_SHA"; then
    pass "L3 SoT RELEASE_RECORD ($PROD_SOT_BRANCH) mentions prod SHA"
  else
    fail "L3 SoT RELEASE_RECORD missing prod SHA $PROD_SHA"
  fi
fi
if [[ -f "$RR" ]]; then
  if grep -q "${CANDIDATE_SHA:0:12}" "$RR"; then
    pass "local RELEASE_RECORD mentions candidate SHA"
  else
    warn "local RELEASE_RECORD has no candidate section"
  fi
elif [[ ! -f "$RR" ]]; then
  warn "missing local $RR"
fi

# --- R9: running artifact == image provenance (opt-in; fail-closed when it runs) ---
if [[ "$LIVE_IMAGE_CHECK" == true ]]; then
  if "$ROOT/deploy/production/scripts/verify-live-image-identity.sh"; then
    pass "R9 live build-info.commit == image OCI revision (no /app/dist overlay)"
  else
    # 20 = identity split (overlay), 21 = LIVE/label unreadable; both fail closed.
    fail "R9 live image identity check failed (overlay or unknown identity; see output above)"
  fi
fi

# --- dirty main tree ---
dirty="$(git status --porcelain | wc -l | tr -d ' ')"
if [[ "$dirty" -gt 0 ]]; then
  warn "L0/L1 shared tree dirty file count=$dirty (OK if not used as release tip)"
else
  pass "shared tree clean"
fi

echo
echo "=== summary: PASS=$ok WARN=$warn FAIL=$fail ==="
if [[ "$fail" -gt 0 ]]; then
  echo "GAP: layers inconsistent — fix before claiming production parity."
  exit 1
fi
if [[ "$warn" -gt 0 ]]; then
  echo "OK with warnings — candidate may be on GitHub while prod still on older SHA (expected pre-cutover)."
  exit 0
fi
echo "Aligned for declared checks."
exit 0
