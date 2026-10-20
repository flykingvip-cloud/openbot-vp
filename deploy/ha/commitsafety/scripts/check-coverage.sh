#!/usr/bin/env bash
# CI / pre-merge CommitSafety gate coverage check (Appendix A.6).
# Exit 0 = PASS; non-zero = at least one authoritative table lacks the gate,
# an HA-exempt table carries it, or the gate function is not hardened.
#
# Usage:
#   DATABASE_URL=... deploy/ha/commitsafety/scripts/check-coverage.sh [--schemas public,x] [--report-only]
# --report-only prints the gaps but exits 0 (only for the §15.2 rollout window
# before step 4 "enable CI blocking"; never in the merge gate afterwards).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL is required}"

schemas="public"
report_only=0
while [ $# -gt 0 ]; do
  case "$1" in
    --schemas) schemas="$2"; shift 2 ;;
    --report-only) report_only=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v schemas="$schemas" -v report_only="$report_only" \
  -f "$ROOT/checks/gate_coverage.sql"
