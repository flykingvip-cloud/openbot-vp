#!/usr/bin/env bash
# Fail-closed gate for Control UI overlays before production cutover.
#
# Accepted profiles:
#   A) tip/full UI (>=2.5MB): employee home + space-import + org surfaces (may embed enterprise)
#   B) lean org overlay (<2.5MB): lazy enterprise chunks only; no static enterprise import in entry
#
# Both profiles MUST carry create-seat-invite + archive email-edit markers.
# Do NOT reject tip/full solely for size — that caused LIVE tip↔lean rollback wars.
set -euo pipefail

CONTROL_UI="${1:-}"
if [[ -z "$CONTROL_UI" ]]; then
  echo "usage: $0 <path-to-control-ui-dir>" >&2
  exit 2
fi
if [[ ! -d "$CONTROL_UI" || ! -f "$CONTROL_UI/index.html" ]]; then
  echo "error: control-ui dir / index.html not found: $CONTROL_UI" >&2
  exit 2
fi

ENTRY_REL="$(grep -oE 'assets/index-[^"]+\.js' "$CONTROL_UI/index.html" | head -1 || true)"
if [[ -z "$ENTRY_REL" ]]; then
  echo "error: could not resolve assets/index-*.js from index.html" >&2
  exit 20
fi
ENTRY="$CONTROL_UI/$ENTRY_REL"
if [[ ! -f "$ENTRY" ]]; then
  echo "error: entry file missing: $ENTRY" >&2
  exit 20
fi

BYTES="$(wc -c < "$ENTRY" | tr -d ' ')"
MIN_ENTRY_BYTES="${OPENBOT_UI_ENTRY_MIN_BYTES:-500000}"
MAX_ENTRY_BYTES="${OPENBOT_UI_ENTRY_MAX_BYTES:-5000000}"
TIP_MIN_BYTES="${OPENBOT_UI_TIP_MIN_BYTES:-2500000}"

[[ "$BYTES" -ge "$MIN_ENTRY_BYTES" ]] || {
  echo "error: entry too small bytes=$BYTES" >&2
  exit 21
}
[[ "$BYTES" -lt "$MAX_ENTRY_BYTES" ]] || {
  echo "error: entry too large bytes=$BYTES" >&2
  exit 21
}

require_in_file() {
  local needle="$1"
  local file="$2"
  local label="$3"
  if ! grep -q -- "$needle" "$file"; then
    echo "error: missing required $label marker '$needle' in $(basename "$file")" >&2
    exit 24
  fi
}

require_in_any() {
  local needle="$1"
  local label="$2"
  shift 2
  local f
  for f in "$@"; do
    [[ -n "$f" && -f "$f" ]] || continue
    if grep -q -- "$needle" "$f"; then
      return 0
    fi
  done
  echo "error: missing required $label marker '$needle'" >&2
  exit 24
}

ORG="$(ls "$CONTROL_UI"/assets/enterprise-organization*.js 2>/dev/null | head -1 || true)"
ZH="$(ls "$CONTROL_UI"/assets/zh-CN-*.js 2>/dev/null | head -1 || true)"

# Optional pin (frozen baseline / combined tip)
PINNED_ENTRY="${OPENBOT_UI_OVERLAY_PINNED_ENTRY:-}"
ENTRY_BASE="$(basename "$ENTRY_REL")"
if [[ -n "$PINNED_ENTRY" && "$ENTRY_BASE" != "$PINNED_ENTRY" ]]; then
  echo "error: pinned entry mismatch: got=$ENTRY_REL want=$PINNED_ENTRY" >&2
  exit 30
fi

# Forbidden lean-only rollback bundle (pre-combined)
FORBIDDEN_ENTRIES="${OPENBOT_UI_OVERLAY_FORBIDDEN_ENTRIES:-index-Dh2kHcfF.js}"
IFS=',' read -r -a _forbid <<< "$FORBIDDEN_ENTRIES"
for bad in "${_forbid[@]}"; do
  bad="$(echo "$bad" | tr -d '[:space:]')"
  [[ -z "$bad" ]] && continue
  if [[ "$ENTRY_BASE" == "$bad" ]]; then
    echo "error: forbidden lean entry (use tip/full combined overlay): $ENTRY_REL" >&2
    exit 31
  fi
done

if [[ "$BYTES" -ge "$TIP_MIN_BYTES" ]]; then
  # tip/full profile
  if [[ -n "$ZH" ]]; then
    require_in_file "本机索引" "$ZH" "space-import"
    require_in_file "加密仓库" "$ZH" "space-import-folderSync"
  else
    require_in_any "本机索引" "space-import" "$ENTRY"
    require_in_any "加密仓库" "space-import-folderSync" "$ENTRY"
  fi
  # Org markers may live in lazy chunk or (tip) entry
  require_in_any "data-create-position-email" "create-seat-invite" "$ORG" "$ENTRY"
  require_in_any "创建并邀请" "create-seat-invite" "$ORG" "$ENTRY" "$ZH"
  require_in_any "data-archive-email-edit" "archive-email-edit" "$ORG" "$ENTRY"
  require_in_any "更改邮箱" "archive-email-edit" "$ORG" "$ENTRY" "$ZH"
  if ! grep -qE 'employee/provision|sendActivationEmail' "$ENTRY"; then
    echo "error: entry missing provision/activation path: $ENTRY_REL" >&2
    exit 25
  fi
  echo "OK control-ui overlay gate (tip/full)"
  echo "  entry=$ENTRY_REL bytes=$BYTES"
  echo "  markers=space-import+create-seat+archive-email-edit+provision"
  exit 0
fi

# lean profile
if grep -q 'from"./enterprise-' "$ENTRY"; then
  echo "error: static enterprise import in lean entry (breaks lazy org surfaces): $ENTRY_REL" >&2
  exit 22
fi
if [[ -z "$ORG" ]]; then
  echo "error: missing enterprise-organization*.js chunk under $CONTROL_UI/assets" >&2
  exit 23
fi
require_in_file "data-create-position-email" "$ORG" "create-seat-invite"
require_in_file "创建并邀请" "$ORG" "create-seat-invite"
require_in_file "data-archive-email-edit" "$ORG" "archive-email-edit"
require_in_file "更改邮箱" "$ORG" "archive-email-edit"
if ! grep -qE 'employee/provision|sendActivationEmail' "$ENTRY"; then
  echo "error: entry missing provision/activation path: $ENTRY_REL" >&2
  exit 25
fi

echo "OK control-ui overlay gate (lean)"
echo "  entry=$ENTRY_REL bytes=$BYTES"
echo "  org=$(basename "$ORG")"
echo "  markers=create-seat-invite,archive-email-edit,provision"
exit 0
