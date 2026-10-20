#!/usr/bin/env bash
# Temporary ad-hoc "release" packaging for Gatekeeper-hostile installs.
# Produces a clean ditto zip with an install helper (not a substitute for
# Developer ID + notarization).
#
# Usage (repo root):
#   ALLOW_ADHOC_SIGNING=1 scripts/package-mac-adhoc-dist.sh
#   SKIP_BUILD=1 scripts/package-mac-adhoc-dist.sh   # re-pack existing dist/OpenBot.app
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCT="${PRODUCT:-OpenBot}"
BUNDLE_NAME="${BUNDLE_NAME:-$PRODUCT}"
BUILD_CONFIG="${BUILD_CONFIG:-release}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_DMG="${SKIP_DMG:-0}"

export ALLOW_ADHOC_SIGNING=1
export SIGN_IDENTITY="${SIGN_IDENTITY:--}"
export BUNDLE_ID="${BUNDLE_ID:-ai.openbot.mac}"
export BUILD_CONFIG
export BUILD_ARCHS="${BUILD_ARCHS:-all}"
export SKIP_NOTARIZE=1

APP="$ROOT_DIR/dist/${BUNDLE_NAME}.app"
STAGE="$ROOT_DIR/dist/${BUNDLE_NAME}-mac-stage"
INSTALL_HELPER_SRC="$ROOT_DIR/scripts/mac/Install-OpenBot.command"

if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "📦 Building ad-hoc app (ALLOW_ADHOC_SIGNING=1)…"
  "$ROOT_DIR/scripts/package-mac-app.sh"
else
  echo "⏭️  SKIP_BUILD=1 — using existing $APP"
fi

if [[ ! -d "$APP" ]]; then
  echo "Error: missing app bundle at $APP" >&2
  exit 1
fi

# Final hygiene before packaging (xattrs break deep/strict verify after unzip).
# Some bundled resources are shipped mode 0444; chmod so xattr can clear.
chmod -R u+w "$APP" 2>/dev/null || true
xattr -cr "$APP" 2>/dev/null || true
/usr/bin/codesign --force --deep --sign - "$APP"

VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || echo "0.0.0")
ZIP="$ROOT_DIR/dist/${BUNDLE_NAME}-$VERSION.zip"
ZIP_ALIAS="$ROOT_DIR/dist/${BUNDLE_NAME}-mac.zip"
DMG="$ROOT_DIR/dist/${BUNDLE_NAME}-$VERSION.dmg"
README="$STAGE/安装说明.txt"

echo "🧹 Staging install folder…"
rm -rf "$STAGE"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/${BUNDLE_NAME}.app"
cp "$INSTALL_HELPER_SRC" "$STAGE/双击安装 OpenBot.command"
chmod +x "$STAGE/双击安装 OpenBot.command"

cat >"$README" <<EOF
OpenBot macOS（临时 ad-hoc 安装包）

本包未使用 Apple Developer ID / 公证，下载后系统可能拦截。
请按下面步骤安装（推荐）：

1. 解压本 zip（建议用 macOS 自带「归档实用工具」，不要用会写入扩展属性的第三方解压工具）
2. 双击「双击安装 OpenBot.command」
3. 若提示无法打开脚本：右键该文件 → 打开
4. 安装完成后若仍拦截 App：系统设置 → 隐私与安全性 → 仍要打开
   或在「应用程序」里右键 OpenBot → 打开

正式对外发行仍需 Developer ID Application + 公证。
版本：$VERSION
EOF

# Clear any FinderInfo that cp/ditto may have attached on the stage tree.
chmod -R u+w "$STAGE" 2>/dev/null || true
xattr -cr "$STAGE" 2>/dev/null || true

echo "📦 Zip: $ZIP"
rm -f "$ZIP" "$ZIP_ALIAS"
# Zip the stage *contents* under a single top-level folder name for a clean extract.
(
  cd "$ROOT_DIR/dist"
  rm -rf "${BUNDLE_NAME}-mac"
  mv "$STAGE" "${BUNDLE_NAME}-mac"
  ditto -c -k --sequesterRsrc --keepParent "${BUNDLE_NAME}-mac" "$ZIP"
  cp -f "$ZIP" "$ZIP_ALIAS"
)

echo "🔗 Alias: $ZIP_ALIAS"

if [[ "$SKIP_DMG" != "1" ]]; then
  echo "💿 DMG: $DMG"
  # DMG still ships the app; helper stays in the zip for download users.
  "$ROOT_DIR/scripts/create-dmg.sh" "$APP" "$DMG" || {
    echo "WARN: DMG creation failed (continuing; zip is the primary ad-hoc artifact)" >&2
  }
fi

echo
echo "✅ Ad-hoc dist ready:"
echo "   $ZIP"
echo "   $ZIP_ALIAS"
ls -lh "$ZIP" "$ZIP_ALIAS" 2>/dev/null || true
echo
echo "Verify extract + helper:"
echo "  ditto -x -k \"$ZIP_ALIAS\" /tmp/openbot-adhoc-test && open /tmp/openbot-adhoc-test/OpenBot-mac"
echo
echo "Upload $ZIP_ALIAS to https://www.openbot.love/downloads/OpenBot-mac.zip when ready."
