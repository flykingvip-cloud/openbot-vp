#!/usr/bin/env bash
# Build OpenBot Harmony HAP. DevEco forbids non-ASCII project paths, so we
# sync apps/harmony -> ~/openbot-harmony before invoking hvigor.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apps/harmony"
DEST="${OPENBOT_HARMONY_BUILD_DIR:-$HOME/openbot-harmony}"
DEVECO="${DEVECO_HOME:-/Applications/DevEco-Studio.app/Contents}"
SDK="$DEVECO/sdk"
export DEVECO_SDK_HOME="$SDK"
export PATH="$DEVECO/tools/ohpm/bin:$DEVECO/tools/node/bin:$DEVECO/tools/hvigor/bin:$SDK/default/openharmony/toolchains:$PATH"

mkdir -p "$DEST"
rsync -a --delete \
  --exclude '.hvigor' --exclude '**/build' --exclude 'oh_modules' --exclude '**/oh_modules' \
  --exclude 'local.properties' \
  "$SRC/" "$DEST/"
printf 'sdk.dir=%s\n' "$SDK" > "$DEST/local.properties"
cd "$DEST"
ohpm install
hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
HAP="$DEST/entry/build/default/outputs/default/entry-default-unsigned.hap"
echo "HAP: $HAP"
ls -lh "$HAP"
