#!/bin/bash
# Ad-hoc distribution helper: clear Gatekeeper quarantine / xattrs, install to
# /Applications, then launch. Does NOT replace Developer ID + notarization.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC_APP="$ROOT/OpenBot.app"
DEST="/Applications/OpenBot.app"

die() {
  osascript -e "display alert \"OpenBot 安装失败\" message \"$1\" as critical" >/dev/null 2>&1 || echo "ERROR: $1" >&2
  exit 1
}

info() {
  osascript -e "display notification \"$1\" with title \"OpenBot\"" >/dev/null 2>&1 || echo "$1"
}

if [[ ! -d "$SRC_APP" ]]; then
  die "未找到 OpenBot.app。请先解压完整安装包，再双击本脚本。"
fi

info "正在清理隔离属性并安装到「应用程序」…"

# Read-only resources block xattr clears; make the tree writable first.
chmod -R u+w "$SRC_APP" 2>/dev/null || true

# Heal download/unzip pollution that breaks codesign (FinderInfo, quarantine, etc.).
xattr -cr "$SRC_APP" 2>/dev/null || true

# Fresh ad-hoc seal after xattr cleanup (keeps local install runnable).
if ! /usr/bin/codesign --force --deep --sign - "$SRC_APP" 2>/tmp/openbot-adhoc-codesign.log; then
  die "重新签名失败。请查看 /tmp/openbot-adhoc-codesign.log"
fi

if [[ -d "$DEST" ]]; then
  rm -rf "$DEST" || die "无法覆盖 /Applications/OpenBot.app（可能需要先退出 OpenBot）。"
fi

ditto "$SRC_APP" "$DEST" || die "复制到 /Applications 失败。"
chmod -R u+w "$DEST" 2>/dev/null || true
xattr -cr "$DEST" 2>/dev/null || true
# Re-seal destination copy as well (ditto can retain quarantine flags).
/usr/bin/codesign --force --deep --sign - "$DEST" 2>/dev/null || true

# Launch; if Gatekeeper still blocks, guide the user.
if open "$DEST" 2>/tmp/openbot-adhoc-open.log; then
  osascript -e 'display alert "OpenBot 已安装" message "已安装到「应用程序」并尝试启动。\n\n若仍被拦截：系统设置 → 隐私与安全性 → 仍要打开。" as informational' >/dev/null 2>&1 || true
  exit 0
fi

osascript -e 'display alert "需要手动允许" message "应用已装到「应用程序」，但系统拦截了启动。\n\n请打开：系统设置 → 隐私与安全性 → 找到 OpenBot → 仍要打开。\n\n或在 Finder 中右键 OpenBot.app → 打开。" as warning' >/dev/null 2>&1 || true
open -R "$DEST" 2>/dev/null || true
exit 0
