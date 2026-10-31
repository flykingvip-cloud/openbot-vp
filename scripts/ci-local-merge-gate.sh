#!/usr/bin/env bash
# Local substitute for parts of .github/workflows/ci-gate.yml when GitHub-hosted
# jobs cannot obtain a runner (observed: runner_id=0 / empty steps / log 404).
# Root cause of that pattern (minutes, spending limit, policy, etc.) is separate
# and must be proven with Billing evidence or explicit annotations — not assumed.
#
# Usage:
#   ./scripts/ci-local-merge-gate.sh
#   ./scripts/ci-local-merge-gate.sh --base origin/main --candidate HEAD
#   ./scripts/ci-local-merge-gate.sh --skip-absolute   # skip format + host-policy → partial
#
# Docs: docs/reference/ci-local-merge-gate.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE_REF="origin/main"
CANDIDATE_REF="HEAD"
SKIP_ABSOLUTE=0
RESULT="passed"
SKIPPED=()
NOTES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE_REF="${2:?--base requires a value}"
      shift 2
      ;;
    --candidate)
      CANDIDATE_REF="${2:?--candidate requires a value}"
      shift 2
      ;;
    --skip-absolute)
      SKIP_ABSOLUTE=1
      shift
      ;;
    -h | --help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

emit_blocked() {
  echo "BLOCKED: $*" >&2
  echo "result=blocked" >&2
  exit 3
}

mark_partial() {
  RESULT="partial"
  NOTES+=("$*")
}

export OPENBOT_TEST_PROFILE="${OPENBOT_TEST_PROFILE:-low}"

echo "== resolve refs =="
# Fail closed: a stale or unreachable origin/main must never look like a green gate.
if ! git fetch origin main --quiet; then
  emit_blocked "git fetch origin main failed; cannot certify a fresh main baseline"
fi

FRESH_MAIN_SHA="$(git rev-parse --verify "origin/main^{commit}")"
BASE_SHA="$(git rev-parse --verify "${BASE_REF}^{commit}")"
CANDIDATE_SHA="$(git rev-parse --verify "${CANDIDATE_REF}^{commit}")"
CHECKOUT_SHA="$(git rev-parse --verify "HEAD^{commit}")"

echo "fresh_main=$FRESH_MAIN_SHA (origin/main)"
echo "base=$BASE_SHA ($BASE_REF)"
echo "candidate=$CANDIDATE_SHA ($CANDIDATE_REF)"
echo "checkout=$CHECKOUT_SHA (HEAD)"

# Trunk constraint: freshly fetched origin/main must be an ancestor of candidate,
# regardless of which SHA was chosen as the diagnostic --base.
if ! git merge-base --is-ancestor "$FRESH_MAIN_SHA" "$CANDIDATE_SHA"; then
  emit_blocked "freshly fetched origin/main ($FRESH_MAIN_SHA) is not an ancestor of candidate ($CANDIDATE_SHA); rebase/replay onto fresh main first"
fi

if ! git merge-base --is-ancestor "$BASE_SHA" "$CANDIDATE_SHA"; then
  emit_blocked "$BASE_REF ($BASE_SHA) is not an ancestor of $CANDIDATE_REF ($CANDIDATE_SHA)"
fi

if [[ "$CHECKOUT_SHA" != "$CANDIDATE_SHA" ]]; then
  mark_partial "checkout HEAD ($CHECKOUT_SHA) != candidate ($CANDIDATE_SHA); absolute/format/tests ran on checkout tree, not candidate tip"
fi

if [[ -n "$(git status --porcelain 2>/dev/null || true)" ]]; then
  mark_partial "working tree dirty; absolute/format/tests may not match a clean candidate snapshot"
fi

echo "== ci-diagnostic-delta unit tests =="
pnpm vitest run \
  scripts/ci-diagnostic-delta.test.ts \
  scripts/check-knowledge-universe-page-tabs.test.ts

echo "== knowledge universe page-tab integrity =="
node scripts/check-knowledge-universe-page-tabs.mjs

if [[ "$SKIP_ABSOLUTE" -eq 0 ]]; then
  echo "== host env policy (swift) =="
  pnpm check:host-env-policy:swift
  echo "== format check =="
  pnpm format:check
else
  echo "== skip absolute gates (--skip-absolute) =="
  SKIPPED+=("pnpm check:host-env-policy:swift")
  SKIPPED+=("pnpm format:check")
  mark_partial "absolute gates skipped via --skip-absolute"
fi

echo "== block new tsgo/oxlint diagnostics =="
node scripts/ci-diagnostic-delta.mjs --base "$BASE_SHA" --candidate "$CANDIDATE_SHA"

echo "== delivery unit tests =="
pnpm vitest run scripts/delivery

echo "== release ledger audit =="
pnpm delivery:ledger:audit

echo ""
if [[ "$RESULT" == "partial" ]]; then
  echo "result=partial"
  if [[ ${#SKIPPED[@]} -gt 0 ]]; then
    echo "skipped:"
    for item in "${SKIPPED[@]}"; do
      echo "  - $item"
    done
  fi
  if [[ ${#NOTES[@]} -gt 0 ]]; then
    echo "notes:"
    for note in "${NOTES[@]}"; do
      echo "  - $note"
    done
  fi
  echo "Local ci-gate substitute finished PARTIAL for base=$BASE_SHA candidate=$CANDIDATE_SHA fresh_main=$FRESH_MAIN_SHA"
  echo "Do not treat partial as a merge-gate PASS."
  exit 0
fi

echo "result=passed"
echo "OK: local ci-gate substitute passed for base=$BASE_SHA candidate=$CANDIDATE_SHA fresh_main=$FRESH_MAIN_SHA"
echo "Also run scoped vitest for the files you changed before merging."
