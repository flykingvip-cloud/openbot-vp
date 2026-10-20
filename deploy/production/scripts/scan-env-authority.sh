#!/usr/bin/env bash
# Optional: re-scan OPENBOT_/OPENCLAW_ symbols for matrix maintenance.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
echo "OPENBOT_ symbols (src+deploy+Dockerfile):"
grep -rohE 'OPENBOT_[A-Z0-9_]+' src deploy Dockerfile docker-compose.yml fly.toml render.yaml .env.example 2>/dev/null \
  | sort -u | wc -l
echo "OPENCLAW_ symbols:"
grep -rohE 'OPENCLAW_[A-Z0-9_]+' src deploy Dockerfile docker-compose.yml fly.toml render.yaml .env.example 2>/dev/null \
  | sort -u | wc -l
echo "Shared suffixes (bot ∩ claw):"
comm -12 \
  <(grep -rohE 'OPENBOT_[A-Z0-9_]+' src deploy Dockerfile 2>/dev/null | sed 's/^OPENBOT_//' | sort -u) \
  <(grep -rohE 'OPENCLAW_[A-Z0-9_]+' src deploy Dockerfile 2>/dev/null | sed 's/^OPENCLAW_//' | sort -u) \
  | head -60
echo "(see deploy/production/env-authority-matrix.md for ruled Primary list)"
