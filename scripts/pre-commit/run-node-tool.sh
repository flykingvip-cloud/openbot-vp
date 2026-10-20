#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARM64_PREFIX=()

if [[ "$(uname -s)" == "Darwin" ]] && command -v arch >/dev/null 2>&1; then
  arm64_capable="$(sysctl -in hw.optional.arm64 2>/dev/null || printf '0')"
  if [[ "$arm64_capable" == "1" ]]; then
    ARM64_PREFIX=(arch -arm64)
  fi
fi

run_tool() {
  if [[ "${#ARM64_PREFIX[@]}" -gt 0 ]]; then
    exec "${ARM64_PREFIX[@]}" "$@"
  fi
  exec "$@"
}

if [[ $# -lt 1 ]]; then
  echo "usage: run-node-tool.sh <tool> [args...]" >&2
  exit 2
fi

tool="$1"
shift

if [[ -f "$ROOT_DIR/pnpm-lock.yaml" ]] && command -v pnpm >/dev/null 2>&1; then
  run_tool pnpm exec "$tool" "$@"
fi

if { [[ -f "$ROOT_DIR/bun.lockb" ]] || [[ -f "$ROOT_DIR/bun.lock" ]]; } && command -v bun >/dev/null 2>&1; then
  run_tool bunx --bun "$tool" "$@"
fi

if command -v npm >/dev/null 2>&1; then
  run_tool npm exec -- "$tool" "$@"
fi

if command -v npx >/dev/null 2>&1; then
  run_tool npx "$tool" "$@"
fi

echo "Missing package manager: pnpm, bun, or npm required." >&2
exit 1
