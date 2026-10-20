#!/usr/bin/env bash
# Fail-closed gate for Control UI v3 pin (production served root + container embed).
# Scans entry + all lazy asset chunks — org/create-seat markers may live off-entry.
set -euo pipefail
UI="${1:-/root/.openbot/control-ui}"
PINNED_ENTRY="${OPENBOT_UI_OVERLAY_PINNED_ENTRY:-}"
if [[ -z "$PINNED_ENTRY" && -f /root/openbot-ui-baselines/v3.0/pin.env ]]; then
  # shellcheck disable=SC1091
  . /root/openbot-ui-baselines/v3.0/pin.env
  PINNED_ENTRY="${OPENBOT_UI_OVERLAY_PINNED_ENTRY:-}"
fi
python3 - "$UI" "$PINNED_ENTRY" <<'PY'
import re, sys
from pathlib import Path

ui = Path(sys.argv[1])
pinned = (sys.argv[2] or "").strip()
html = (ui / "index.html").read_text(errors="ignore")
m = re.search(r"assets/(index-[A-Za-z0-9_-]+\.js)", html)
assert m, "no entry"
entry = m.group(1)
entry_js = (ui / "assets" / entry).read_text(errors="ignore")
css_m = re.search(r"assets/(index-[A-Za-z0-9_-]+\.css)", html)
css = ""
if css_m:
  css_path = ui / "assets" / css_m.group(1)
  if css_path.exists():
    css = css_path.read_text(errors="ignore")

assets_dir = ui / "assets"
all_js = "\n".join(
  p.read_text(errors="ignore") for p in sorted(assets_dir.glob("*.js")) if p.is_file()
)
entry_blob = entry_js + "\n" + css
full_blob = all_js + "\n" + css

# Capability checklist — freeze floor (2026-08-05+)
need = [
  "employee-embed-hydrating",
  "data-openbot-embed-auth",
  "wb-bots__tabs",
  "personal-settings-tabs",
  "module-page--personal-settings",
  "数据与备份",
  "data-create-position-email",
  "创建并邀请",
  "data-archive-email-edit",
  "更改邮箱",
  "enterprise-org-archive__",
  "enterprise-settings-shell",
  "employee-model-access-section",
]
missing = [n for n in need if n not in full_blob]
if missing:
  raise SystemExit(f"verify failed missing={missing} entry={entry}")
if pinned and entry != pinned:
  raise SystemExit(f"verify failed unexpected entry={entry} want={pinned}")
# enterprise settings nav must be button/callback when shell lives in entry (not href stub)
if "enterprise-settings-shell" in entry_js:
  i = entry_js.find("enterprise-settings-shell")
  snip = entry_js[i : i + 320]
  if "href:" in snip:
    raise SystemExit(f"verify failed enterprise-settings href-stub entry={entry}")
elif "enterprise-settings-shell" not in full_blob:
  raise SystemExit(f"verify failed missing enterprise-settings-shell entry={entry}")
if "grid-template-rows:auto minmax(0,1fr)" not in css:
  raise SystemExit(f"verify failed missing groups/robots grid row fix entry={entry}")
# Isolation UI: chat surface equivalence for employee-scoped steward keys
if "agent:main:employee:" not in full_blob:
  raise SystemExit(f"verify failed missing tenant chat surface isolation marker entry={entry}")
print(f"OK entry={entry} freeze_caps={len(need)} settings_nav=button grid_fix=1 isolation_ui=1")
PY
