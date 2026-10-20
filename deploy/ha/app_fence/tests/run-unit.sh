#!/usr/bin/env bash
# E1 App Fence server unit tests (no PG required).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"   # deploy/ha/app_fence
HA="$(cd "$APP/.." && pwd)"     # deploy/ha
CTL="$HA/controller"

export PYTHONPATH="$HA:$CTL${PYTHONPATH:+:$PYTHONPATH}"
# Clear token between runs
unset HA_APP_FENCE_TOKEN || true
unset HA_APP_FENCE_ALLOW_RESET || true

echo ">> app_fence unit tests (PYTHONPATH=$PYTHONPATH)"
python3 -m unittest discover -s "$HERE" -v
echo ">> app_fence unit OK"
