#!/usr/bin/env bash
# verify-forward-only.sh — Gate 1: production may only move forward along git history.
#
# Asserts `merge-base --is-ancestor(LIVE, CANDIDATE)`, where LIVE is read from the
# RUNNING artifact (`/app/dist/build-info.json`), never from a ledger. Read-only:
# it never mutates production, branches, stashes or worktrees.
#
# Exit codes: 0 allow · 20 candidate behind/diverged · 21 LIVE unknown (fail closed).
# Escape hatch for an approved rollback: --intentional-revert "<reason>".
#
# Sibling script: verify-delivery-alignment.sh checks L1/L2/L3 *publication*
# (tag → SHA, tag on origin, image pins the SHA, RELEASE_RECORD mentions it).
# Different question; both gates are expected to pass before a cutover.
#
# See: docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

exec node --import tsx scripts/delivery/cli.ts verify "$@"
