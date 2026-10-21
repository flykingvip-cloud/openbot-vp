#!/usr/bin/env bash
set -euo pipefail

# Brand compat: mirror OPENBOT_* <-> OPENCLAW_* env vars so either prefix works,
# matching the Node runtime's normalizeOpenBotCompatEnv(). Prefer OPENBOT_*; the
# legacy OPENCLAW_* names keep working for back-compat.
openbot_mirror_env() {
  local var target
  while IFS= read -r var; do
    [[ -n "$var" ]] || continue
    target="OPENCLAW_${var#OPENBOT_}"
    if [[ -z "${!target:-}" && -n "${!var:-}" ]]; then
      export "${target}=${!var}"
    fi
  done < <(compgen -v OPENBOT_ 2>/dev/null || true)
  while IFS= read -r var; do
    [[ -n "$var" ]] || continue
    target="OPENBOT_${var#OPENCLAW_}"
    if [[ -z "${!target:-}" && -n "${!var:-}" ]]; then
      export "${target}=${!var}"
    fi
  done < <(compgen -v OPENCLAW_ 2>/dev/null || true)
}
openbot_mirror_env

dedupe_chrome_args() {
  local -A seen_args=()
  local -a unique_args=()

  for arg in "${CHROME_ARGS[@]}"; do
    if [[ -n "${seen_args["$arg"]:+x}" ]]; then
      continue
    fi
    seen_args["$arg"]=1
    unique_args+=("$arg")
  done

  CHROME_ARGS=("${unique_args[@]}")
}

export DISPLAY=:1
# Account Computer Files lists this directory under /tmp. The name is OpenBot
# branding. It is baked into the image tip (the COPY of this script); a running
# container keeps the previous openclaw-home name until
# scripts/sandbox-browser-setup.sh is rebuilt and the browser container is
# recreated. That rebuild is not a production cutover.
export HOME=/tmp/openbot-home
export XDG_CONFIG_HOME="${HOME}/.config"
export XDG_CACHE_HOME="${HOME}/.cache"
# In-container desktop binary. Same tip layer as this script. Exported so the
# Openbox rule (awk ENVIRON) and the supervisor use one path.
export SANDBOX_DESKTOP_BIN="/usr/local/bin/openbot-sandbox-desktop"

CDP_PORT="${OPENCLAW_BROWSER_CDP_PORT:-${CLAWDBOT_BROWSER_CDP_PORT:-9222}}"
CDP_SOURCE_RANGE="${OPENCLAW_BROWSER_CDP_SOURCE_RANGE:-${CLAWDBOT_BROWSER_CDP_SOURCE_RANGE:-}}"
VNC_PORT="${OPENCLAW_BROWSER_VNC_PORT:-${CLAWDBOT_BROWSER_VNC_PORT:-5900}}"
NOVNC_PORT="${OPENCLAW_BROWSER_NOVNC_PORT:-${CLAWDBOT_BROWSER_NOVNC_PORT:-6080}}"
ENABLE_NOVNC="${OPENCLAW_BROWSER_ENABLE_NOVNC:-${CLAWDBOT_BROWSER_ENABLE_NOVNC:-1}}"
HEADLESS="${OPENCLAW_BROWSER_HEADLESS:-${CLAWDBOT_BROWSER_HEADLESS:-0}}"
ALLOW_NO_SANDBOX="${OPENCLAW_BROWSER_NO_SANDBOX:-${CLAWDBOT_BROWSER_NO_SANDBOX:-0}}"
# Headed containers draw the dock desktop. Set OPENBOT_BROWSER_DESKTOP=0 to keep
# the single Chromium window. Account-worker feature flags are unrelated and
# stay default off; this only changes the sandbox-browser image entrypoint.
DESKTOP_REQUEST="${OPENBOT_BROWSER_DESKTOP:-${OPENCLAW_BROWSER_DESKTOP:-}}"
NOVNC_PASSWORD="${OPENCLAW_BROWSER_NOVNC_PASSWORD:-${CLAWDBOT_BROWSER_NOVNC_PASSWORD:-}}"
DISABLE_GRAPHICS_FLAGS="${OPENCLAW_BROWSER_DISABLE_GRAPHICS_FLAGS:-1}"
DISABLE_EXTENSIONS="${OPENCLAW_BROWSER_DISABLE_EXTENSIONS:-1}"
RENDERER_PROCESS_LIMIT="${OPENCLAW_BROWSER_RENDERER_PROCESS_LIMIT:-2}"

# Account browser profile is mounted at /account/browser (state/browser on the host).
# Chromium must use that directory so cookies survive container recycle.
# Non-account sandboxes keep ${HOME}/.chrome.
resolve_chrome_user_data_dir() {
  local requested="${OPENBOT_BROWSER_USER_DATA_DIR:-${OPENCLAW_BROWSER_USER_DATA_DIR:-}}"
  if [[ -n "${requested}" ]]; then
    printf '%s\n' "${requested}"
    return
  fi
  if [[ -d /account/browser ]]; then
    printf '%s\n' "/account/browser"
    return
  fi
  printf '%s\n' "${HOME}/.chrome"
}

CHROME_USER_DATA_DIR="$(resolve_chrome_user_data_dir)"
mkdir -p "${HOME}" "${CHROME_USER_DATA_DIR}" "${XDG_CONFIG_HOME}" "${XDG_CACHE_HOME}"

# Directory opens use Thunar. The image also writes a system mimeapps.list;
# this covers the runtime HOME (/tmp/openbot-home), which is created here.
install_directory_mime_default() {
  if ! command -v xdg-mime >/dev/null 2>&1; then
    return 0
  fi
  if [[ ! -f /usr/share/applications/thunar.desktop ]]; then
    return 0
  fi
  mkdir -p "${HOME}/.local/share/applications"
  xdg-mime default thunar.desktop inode/directory || true
}
install_directory_mime_default

if [[ "${OPENBOT_BROWSER_ENTRYPOINT_PRINT_USER_DATA:-${OPENCLAW_BROWSER_ENTRYPOINT_PRINT_USER_DATA:-}}" == "1" ]]; then
  printf '%s\n' "${CHROME_USER_DATA_DIR}"
  exit 0
fi

# Chromium's SingletonLock records "<hostname>-<pid>". After the container is
# removed, the hostname is a dead container id. Leaving that symlink makes the
# next container refuse the account profile ("in use by another computer") and
# the saved login never loads. Only a lock for this container's own hostname is
# kept; a same-host stale pid is Chromium's own takeover case.
clear_stale_chrome_singleton() {
  local dir="$1"
  local lock="${dir}/SingletonLock"
  if [[ ! -e "${lock}" && ! -L "${lock}" ]]; then
    return 0
  fi
  local target host
  target="$(readlink "${lock}" 2>/dev/null || true)"
  host="${target%%-*}"
  if [[ -z "${host}" || "${host}" != "$(hostname)" ]]; then
    rm -f "${dir}/SingletonLock" "${dir}/SingletonCookie" "${dir}/SingletonSocket"
  fi
}
clear_stale_chrome_singleton "${CHROME_USER_DATA_DIR}"

openbot_env_enabled() {
  local value="${1:-}"
  value="${value,,}"
  [[ "${value}" == "1" || "${value}" == "true" || "${value}" == "yes" || "${value}" == "on" ]]
}

if [[ "${HEADLESS}" == "1" ]]; then
  DESKTOP_ENABLED=0
elif [[ -z "${DESKTOP_REQUEST}" ]]; then
  DESKTOP_ENABLED=1
elif openbot_env_enabled "${DESKTOP_REQUEST}"; then
  DESKTOP_ENABLED=1
else
  DESKTOP_ENABLED=0
fi

install_openbox_desktop_rule() {
  local src="/etc/xdg/openbox/rc.xml"
  local dst="${XDG_CONFIG_HOME}/openbox/rc.xml"
  mkdir -p "${XDG_CONFIG_HOME}/openbox"
  if [[ ! -f "${src}" ]]; then
    return 0
  fi
  # Desktop stays below. Apps maximize to the framebuffer. The shelf is an
  # override-redirect window the desktop unmaps while any app is showing, so
  # these rules do not reserve a bottom band. Fullscreen stays off; maximized
  # with no decorations is the whole 1280x800.
  # Control UI 返回桌面 injects Control+Alt+D. This bind runs even when
  # Chromium is focused, and unmaps apps so the dock shelf comes back.
  awk '
    BEGIN { inserted=0; keybound=0 }
    /<\/keyboard>/ && !keybound {
      print "  <keybind key=\"C-A-d\">"
      print "    <action name=\"Execute\">"
      print "      <command>" ENVIRON["SANDBOX_DESKTOP_BIN"] " --show-desktop</command>"
      print "    </action>"
      print "  </keybind>"
      keybound=1
    }
    /<applications>/ && !inserted {
      print
      print "  <application title=\"OpenBot Desktop\">"
      print "    <decor>no</decor>"
      print "    <maximized>yes</maximized>"
      print "    <layer>below</layer>"
      print "    <focus>no</focus>"
      print "  </application>"
      print "  <application title=\"OpenBot Dock\">"
      print "    <decor>no</decor>"
      print "    <maximized>no</maximized>"
      print "    <fullscreen>no</fullscreen>"
      print "    <layer>above</layer>"
      print "    <focus>no</focus>"
      print "  </application>"
      print "  <application class=\"*hromium*\">"
      print "    <decor>no</decor>"
      print "    <maximized>yes</maximized>"
      print "    <fullscreen>no</fullscreen>"
      print "  </application>"
      print "  <application class=\"Thunar\">"
      print "    <decor>no</decor>"
      print "    <maximized>yes</maximized>"
      print "    <fullscreen>no</fullscreen>"
      print "  </application>"
      print "  <application name=\"thunar\">"
      print "    <decor>no</decor>"
      print "    <maximized>yes</maximized>"
      print "    <fullscreen>no</fullscreen>"
      print "  </application>"
      print "  <application title=\"* - Thunar\">"
      print "    <decor>no</decor>"
      print "    <maximized>yes</maximized>"
      print "    <fullscreen>no</fullscreen>"
      print "  </application>"
      print "  <application title=\"终端\">"
      print "    <decor>no</decor>"
      print "    <maximized>yes</maximized>"
      print "    <fullscreen>no</fullscreen>"
      print "  </application>"
      print "  <application class=\"XTerm\">"
      print "    <decor>no</decor>"
      print "    <maximized>yes</maximized>"
      print "    <fullscreen>no</fullscreen>"
      print "  </application>"
      inserted=1
      next
    }
    { print }
  ' "${src}" > "${dst}"
}

write_chrome_launcher() {
  local launcher="${HOME}/bin/open-chrome"
  local arg
  mkdir -p "${HOME}/bin"
  {
    printf '%s\n' '#!/bin/sh'
    printf '%s' 'exec chromium'
    for arg in "${CHROME_ARGS[@]}"; do
      printf ' %q' "${arg}"
    done
    printf ' %s\n' '"$@"'
  } > "${launcher}"
  chmod 755 "${launcher}"
  export OPENBOT_BROWSER_CHROME_LAUNCHER="${launcher}"
}

start_clean_desktop() {
  if [[ "${DESKTOP_ENABLED}" != "1" ]]; then
    return 0
  fi
  local _i
  for _i in $(seq 1 50); do
    if [[ -S /tmp/.X11-unix/X1 ]]; then
      break
    fi
    sleep 0.05
  done
  install_openbox_desktop_rule
  write_chrome_launcher
  # Supervisors stay up if openbox or the shell exits, so `wait -n` does not
  # tear the container down with Chromium still serving CDP.
  if command -v openbox >/dev/null 2>&1; then
    (
      while true; do
        openbox || true
        sleep 1
      done
    ) >/tmp/openbot-openbox.log 2>&1 &
    track_child
  fi
  if [[ -x "${SANDBOX_DESKTOP_BIN}" ]]; then
    (
      while true; do
        "${SANDBOX_DESKTOP_BIN}" || true
        sleep 1
      done
    ) >/tmp/openbot-desktop.log 2>&1 &
    track_child
  fi
}

# This script is PID 1. The kernel ignores default-fatal signals for PID 1, so
# `docker stop` used to sit out the timeout and then SIGKILL the container
# (exit 137). Chromium never checkpointed cookies, and Xvfb left /tmp/.X1-lock
# behind when /tmp is not a tmpfs, so the next `docker start` died immediately.
BROWSER_CHILD_PIDS=()
track_child() {
  BROWSER_CHILD_PIDS+=("$!")
}
stop_browser_children() {
  trap '' TERM INT
  local pid alive _i cmd chrome_pid=""
  # Checkpoint Chromium before tearing down Xvfb. Signaling every child at once
  # kills the display out from under the browser and skips the cookie flush.
  for pid in "${BROWSER_CHILD_PIDS[@]}"; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      continue
    fi
    cmd="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
    case "${cmd}" in
      *chromium*|*chrome*)
        # SIGTERM exits this headless build without flushing cookies. SIGINT
        # runs the normal shutdown path (cookie checkpoint + SingletonLock).
        kill -INT "${pid}" 2>/dev/null || true
        chrome_pid="${pid}"
        ;;
    esac
  done
  if [[ -n "${chrome_pid}" ]]; then
    for _i in $(seq 1 40); do
      if ! kill -0 "${chrome_pid}" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
  fi
  for pid in "${BROWSER_CHILD_PIDS[@]}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      kill -TERM "${pid}" 2>/dev/null || true
    fi
  done
  for _i in $(seq 1 10); do
    alive=0
    for pid in "${BROWSER_CHILD_PIDS[@]}"; do
      if kill -0 "${pid}" 2>/dev/null; then
        alive=1
        break
      fi
    done
    if [[ "${alive}" -eq 0 ]]; then
      break
    fi
    sleep 0.2
  done
  for pid in "${BROWSER_CHILD_PIDS[@]}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      kill -KILL "${pid}" 2>/dev/null || true
    fi
  done
  wait || true
  exit 0
}
trap stop_browser_children TERM INT

# Stale display lock from a previous start of this same container.
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1
Xvfb :1 -screen 0 1280x800x24 -ac -nolisten tcp &
track_child

if [[ "${HEADLESS}" == "1" ]]; then
  CHROME_ARGS=(
    "--headless=new"
  )
else
  CHROME_ARGS=()
fi

if [[ "${CDP_PORT}" -ge 65535 ]]; then
  CHROME_CDP_PORT="$((CDP_PORT - 1))"
else
  CHROME_CDP_PORT="$((CDP_PORT + 1))"
fi

CHROME_ARGS+=(
  "--remote-debugging-address=127.0.0.1"
  "--remote-debugging-port=${CHROME_CDP_PORT}"
  "--user-data-dir=${CHROME_USER_DATA_DIR}"
  "--no-first-run"
  "--no-default-browser-check"
  "--disable-dev-shm-usage"
  "--disable-background-networking"
  "--disable-features=TranslateUI"
  "--disable-session-crashed-bubble"
  "--hide-crash-restore-bubble"
  "--noerrdialogs"
  "--disable-infobars"
  "--disable-breakpad"
  "--disable-crash-reporter"
  "--no-zygote"
  "--metrics-recording-only"
)

DISABLE_GRAPHICS_FLAGS_LOWER="${DISABLE_GRAPHICS_FLAGS,,}"
if [[ "${DISABLE_GRAPHICS_FLAGS_LOWER}" == "1" || "${DISABLE_GRAPHICS_FLAGS_LOWER}" == "true" || "${DISABLE_GRAPHICS_FLAGS_LOWER}" == "yes" || "${DISABLE_GRAPHICS_FLAGS_LOWER}" == "on" ]]; then
  CHROME_ARGS+=(
    "--disable-3d-apis"
    "--disable-gpu"
    "--disable-software-rasterizer"
  )
fi

DISABLE_EXTENSIONS_LOWER="${DISABLE_EXTENSIONS,,}"
if [[ "${DISABLE_EXTENSIONS_LOWER}" == "1" || "${DISABLE_EXTENSIONS_LOWER}" == "true" || "${DISABLE_EXTENSIONS_LOWER}" == "yes" || "${DISABLE_EXTENSIONS_LOWER}" == "on" ]]; then
  CHROME_ARGS+=(
    "--disable-extensions"
  )
fi

if [[ "${RENDERER_PROCESS_LIMIT}" =~ ^[0-9]+$ && "${RENDERER_PROCESS_LIMIT}" -gt 0 ]]; then
  CHROME_ARGS+=("--renderer-process-limit=${RENDERER_PROCESS_LIMIT}")
fi

if [[ "${ALLOW_NO_SANDBOX}" == "1" ]]; then
  CHROME_ARGS+=(
    "--no-sandbox"
    "--disable-setuid-sandbox"
  )
fi

dedupe_chrome_args

# A previous container exit leaves the profile looking crashed, which opens
# "Restore pages?" on the first window. Mark it clean before Chromium starts.
mark_chrome_clean_exit() {
  local prefs="${CHROME_USER_DATA_DIR}/Default/Preferences"
  mkdir -p "${CHROME_USER_DATA_DIR}/Default"
  PREFS_PATH="${prefs}" python3 - <<'PY' || true
import json, os
path = os.environ["PREFS_PATH"]
data = {}
if os.path.exists(path):
    try:
        with open(path, encoding="utf-8") as handle:
            loaded = json.load(handle)
        if isinstance(loaded, dict):
            data = loaded
    except Exception:
        data = {}
profile = data.get("profile") if isinstance(data.get("profile"), dict) else {}
profile["exit_type"] = "Normal"
profile["exited_cleanly"] = True
data["profile"] = profile
session = data.get("session") if isinstance(data.get("session"), dict) else {}
session["restore_on_startup"] = 5
data["session"] = session
with open(path, "w", encoding="utf-8") as handle:
    json.dump(data, handle)
PY
}
mark_chrome_clean_exit

# Dock clicks open a local logo page. Desktop opt-out and headless keep about:blank.
BROWSER_START_PAGE="/usr/local/share/openbot/desktop/index.html"
if [[ "${DESKTOP_ENABLED}" == "1" && -f "${BROWSER_START_PAGE}" ]]; then
  export OPENBOT_BROWSER_START_URL="file://${BROWSER_START_PAGE}"
else
  export OPENBOT_BROWSER_START_URL="about:blank"
fi

start_clean_desktop
# Hide the first Chromium window only when the dock shell is actually installed.
# An image without that binary keeps the previous about:blank window.
HIDDEN_CHROME=0
if [[ "${DESKTOP_ENABLED}" == "1" && -x "${SANDBOX_DESKTOP_BIN}" ]]; then
  HIDDEN_CHROME=1
  # CDP stays up without covering the dock. The dock launcher opens a window.
  chromium "${CHROME_ARGS[@]}" --no-startup-window &
else
  chromium "${CHROME_ARGS[@]}" about:blank &
fi
CHROMIUM_PID=$!
track_child

CDP_READY=0
for _ in $(seq 1 50); do
  if curl -sS --max-time 1 "http://127.0.0.1:${CHROME_CDP_PORT}/json/version" >/dev/null; then
    CDP_READY=1
    break
  fi
  if ! kill -0 "${CHROMIUM_PID}" 2>/dev/null; then
    break
  fi
  sleep 0.1
done
if [[ "${HIDDEN_CHROME}" == "1" && "${CDP_READY}" != "1" ]] && ! kill -0 "${CHROMIUM_PID}" 2>/dev/null; then
  # Some Chromium builds quit when asked not to open a window. A visible
  # window keeps CDP alive; with the dock on, that window is the logo page.
  chromium "${CHROME_ARGS[@]}" "${OPENBOT_BROWSER_START_URL}" &
  track_child
fi

SOCAT_LISTEN_ADDR="TCP-LISTEN:${CDP_PORT},fork,reuseaddr,bind=0.0.0.0"
if [[ -n "${CDP_SOURCE_RANGE}" ]]; then
  SOCAT_LISTEN_ADDR="${SOCAT_LISTEN_ADDR},range=${CDP_SOURCE_RANGE}"
fi
socat "${SOCAT_LISTEN_ADDR}" "TCP:127.0.0.1:${CHROME_CDP_PORT}" &
track_child

if [[ "${ENABLE_NOVNC}" == "1" && "${HEADLESS}" != "1" ]]; then
  # VNC auth passwords are max 8 chars; use a random default when not provided.
  if [[ -z "${NOVNC_PASSWORD}" ]]; then
    NOVNC_PASSWORD="$(< /proc/sys/kernel/random/uuid)"
    NOVNC_PASSWORD="${NOVNC_PASSWORD//-/}"
    NOVNC_PASSWORD="${NOVNC_PASSWORD:0:8}"
  fi
  NOVNC_PASSWD_FILE="${HOME}/.vnc/passwd"
  mkdir -p "${HOME}/.vnc"
  x11vnc -storepasswd "${NOVNC_PASSWORD}" "${NOVNC_PASSWD_FILE}" >/dev/null
  chmod 600 "${NOVNC_PASSWD_FILE}"
  x11vnc -display :1 -rfbport "${VNC_PORT}" -shared -forever -rfbauth "${NOVNC_PASSWD_FILE}" -localhost &
  track_child
  # Docker forwards the published host port to eth0, not this container's loopback.
  websockify --web /usr/share/novnc/ "0.0.0.0:${NOVNC_PORT}" "127.0.0.1:${VNC_PORT}" &
  track_child
fi

wait -n
