#!/usr/bin/env bash
# Local substitute for .github/workflows/ci-gate.yml when GitHub-hosted minutes
# are exhausted (jobs finish with runner_id=0 / empty steps).
#
# Usage:
#   ./scripts/ci-local-merge-gate.sh
#   ./scripts/ci-local-merge-gate.sh --base origin/main --candidate HEAD
#   ./scripts/ci-local-merge-gate.sh --skip-absolute   # skip format + host-policy
#
# Docs: docs/reference/ci-local-merge-gate.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE_REF="origin/main"
CANDIDATE_REF="HEAD"
SKIP_ABSOLUTE=0

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
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

export OPENBOT_TEST_PROFILE="${OPENBOT_TEST_PROFILE:-low}"

echo "== resolve refs =="
# Fail closed: a stale or unreachable origin/main must never look like a green gate.
if ! git fetch origin main --quiet; then
  echo "BLOCKED: git fetch origin main failed; cannot certify a fresh main baseline" >&2
  echo "result=blocked" >&2
  exit 3
fi
BASE_SHA="$(git rev-parse --verify "${BASE_REF}^{commit}")"
CANDIDATE_SHA="$(git rev-parse --verify "${CANDIDATE_REF}^{commit}")"
echo "base=$BASE_SHA ($BASE_REF)"
echo "candidate=$CANDIDATE_SHA ($CANDIDATE_REF)"
if ! git merge-base --is-ancestor "$BASE_SHA" "$CANDIDATE_SHA"; then
  echo "BLOCKED: $BASE_REF ($BASE_SHA) is not an ancestor of $CANDIDATE_REF ($CANDIDATE_SHA)" >&2
  echo "Rebase/replay onto freshly fetched origin/main before treating this gate as usable." >&2
  echo "result=blocked" >&2
  exit 3
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
fi

echo "== block new tsgo/oxlint diagnostics =="
node scripts/ci-diagnostic-delta.mjs --base "$BASE_SHA" --candidate "$CANDIDATE_SHA"

echo "== delivery unit tests =="
pnpm vitest run scripts/delivery

echo "== release ledger audit =="
pnpm delivery:ledger:audit

echo ""
echo "OK: local ci-gate substitute passed for $BASE_SHA -> $CANDIDATE_SHA"
echo "Also run scoped vitest for the files you changed before merging."
