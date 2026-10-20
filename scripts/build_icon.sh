#!/usr/bin/env bash
set -euo pipefail

# Build the macOS .icns from the prepared OpenBot PNG source. We keep the iconset
# files around for debugging/reference, but the final .icns is generated through
# Pillow because the local iconutil/Icon Composer pipeline is not stable across
# current host setups.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCE_DIR=${RESOURCE_DIR:-"$ROOT_DIR/apps/macos/Sources/$(sed -n 's/.*\.executable(name: "\([^"]*\)".*/\1/p' "$ROOT_DIR/apps/macos/Package.swift" | head -n 1)/Resources"}
if [[ ! -d "$RESOURCE_DIR" ]]; then
  LEGACY_RESOURCE_DIR="$ROOT_DIR/apps/macos/Sources/OpenBot/Resources"
  if [[ -d "$LEGACY_RESOURCE_DIR" ]]; then
    RESOURCE_DIR="$LEGACY_RESOURCE_DIR"
  fi
fi
DEFAULT_ICON_NAME="${DEFAULT_ICON_NAME:-OpenBot}"

ICON_FILE=${1:-"$ROOT_DIR/apps/macos/Icon.icon/Assets/openbot-mac.png"}
BASENAME=${2:-${DEFAULT_ICON_NAME:-OpenBot}}
OUT_ROOT=${3:-"$ROOT_DIR/apps/macos/build/icon"}
# Where the final .icns should live; override DEST_ICNS to change.
DEST_ICNS=${DEST_ICNS:-"$RESOURCE_DIR/${BASENAME}.icns"}

ICONSET_DIR="$OUT_ROOT/${BASENAME}.iconset"
TMP_DIR="$OUT_ROOT/tmp"
mkdir -p "$ICONSET_DIR" "$TMP_DIR"

mkdir -p "$(dirname "$DEST_ICNS")"
python3 - <<'PY' "$ICON_FILE" "$DEST_ICNS"
from pathlib import Path
from PIL import Image
import sys

src = Path(sys.argv[1])
dest = Path(sys.argv[2])

img = Image.open(src).convert("RGBA")
dest.parent.mkdir(parents=True, exist_ok=True)
img.save(dest, format="ICNS")
print(f"Icon.icns generated at {dest}")
PY
