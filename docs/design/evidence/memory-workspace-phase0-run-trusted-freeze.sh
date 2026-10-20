#!/usr/bin/env bash
# Local helper only. CI must inline this logic in
# .github/workflows/memory-workspace-freeze.yml and must not exec this file
# from the candidate tree.
#
# Scan the candidate worktree with a trusted scanner (origin/main or pinned blobs).
# Never execute the candidate's docs/design/evidence/memory-workspace-phase0-inventory.mjs.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

BASELINE_PATH="docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json"
INVENTORY_PATH="docs/design/evidence/memory-workspace-phase0-inventory.mjs"
SCAN_PATH="docs/design/evidence/memory-workspace-phase0-inventory-scan.mjs"

TRUSTED_INVENTORY_BLOB="${TRUSTED_INVENTORY_BLOB:-4b012d9cdb41a55e9d352f572ad882565776c3ca}"
TRUSTED_SCAN_BLOB="${TRUSTED_SCAN_BLOB:-dad5eae85de25c25493a8bb23545666e39f81733}"
TRUSTED_BASELINE_BLOB="${TRUSTED_BASELINE_BLOB:-0c1860caf8c02a2840ccddda0a392f19aeb588a8}"

# Keep extracted scanner inside the repo so `import "typescript"` resolves.
# Must stay outside node_modules: tsx skips CLI isMain for files there.
WORKDIR="${ROOT}/.cache/memory-workspace-trusted-freeze"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

extract() {
  local dest="$1"
  local spec="$2"
  local blob="$3"
  if git show "$spec" >/dev/null 2>&1; then
    echo "trusted file ${spec}"
    git show "$spec" >"$dest"
  else
    echo "origin/main lacks ${spec#*:}; using pinned blob ${blob}"
    git cat-file -e "$blob"
    git cat-file -p "$blob" >"$dest"
  fi
}

extract "$WORKDIR/memory-workspace-phase0-inventory.mjs" "origin/main:${INVENTORY_PATH}" "$TRUSTED_INVENTORY_BLOB"
extract "$WORKDIR/memory-workspace-phase0-inventory-scan.mjs" "origin/main:${SCAN_PATH}" "$TRUSTED_SCAN_BLOB"

# Baseline source is the CODEOWNERS-protected blob pin, not origin/main
# and not the working-tree JSON. Updating only the JSON cannot hide sites.
echo "trusted baseline blob ${TRUSTED_BASELINE_BLOB}"
git cat-file -e "$TRUSTED_BASELINE_BLOB"
if grep -q -- "--baseline-blob" "$WORKDIR/memory-workspace-phase0-inventory.mjs"; then
  node --import tsx "$WORKDIR/memory-workspace-phase0-inventory.mjs" \
    --mode freeze --baseline-blob "$TRUSTED_BASELINE_BLOB" --baseline "$BASELINE_PATH"
else
  git cat-file -p "$TRUSTED_BASELINE_BLOB" >"$WORKDIR/baseline.json"
  node --import tsx "$WORKDIR/memory-workspace-phase0-inventory.mjs" \
    --mode freeze --baseline "$WORKDIR/baseline.json"
fi
