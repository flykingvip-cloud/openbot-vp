#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="${ROOT_DIR}/apps/ios"

for file in \
  "${IOS_DIR}/build/BetaRelease.xcconfig" \
  "${IOS_DIR}/.local-signing.xcconfig" \
  "${IOS_DIR}/LocalSigning.xcconfig" \
  "${IOS_DIR}/Signing.xcconfig" \
  "${IOS_DIR}/Config/Signing.xcconfig"
do
  [[ -f "$file" ]] || continue
  value="$(awk -F'=' '/OPENBOT_APP_BUNDLE_ID/ { gsub(/[[:space:]]/, "", $2); print $2; exit }' "$file")"
  if [[ -n "${value:-}" ]]; then
    printf '%s\n' "$value"
    exit 0
  fi
done

printf 'ai.openbot.client\n'
