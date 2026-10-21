#!/usr/bin/env python3
"""Minimal account-computer desktop inside the sandbox browser container.

Flat light wallpaper, the official OpenBot logo, and three launchers
(Chrome, Thunar, terminal). There is no dock tray and no custom file list.
On an empty desktop the three icons sit in a wallpaper-colored band so the
user can still launch apps. While any app window is mapped and not
minimized, that band is unmapped and the app fills the framebuffer.
Agent-opened Chromium windows are included, not only Dock launches. The
wallpaper stays below those apps even after Openbox raises it. This is not
a full desktop environment.
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path

WALLPAPER = "#e7e7eb"
# Gold folder on the light wallpaper. A near-white body disappears into #e7e7eb.
FOLDER_EDGE = "#5c3408"
FOLDER_TAB = "#8a4e0c"
FOLDER_BODY = "#9a5a0a"
FOLDER_FRONT = "#b86a0e"
# Official wordmark (ui/public/openbot-logo.png), copied into the image.
LOGO_FILE = "/usr/local/share/openbot/desktop/openbot-logo.png"
START_PAGE = "/usr/local/share/openbot/desktop/index.html"

# Sizes stay in lockstep with sandboxDesktopHotspots() in
# src/browser/novnc-observer-http.ts.
# Glyphs are ~75% of the previous dock (hit 56, glyph 48, gap 156, band 148)
# so the icons stay easy to hit without filling the wallpaper.
DOCK_W = 392
DOCK_H = 112
DOCK_MARGIN = 20
ICON_GAP = 120
ICON_HIT = 42
ICON_GLYPH = 36


def desktop_hotspots(width: int, height: int) -> dict[str, dict[str, int]]:
    """Click targets for the three dock icons. There is no center launcher."""
    _dx1, dy1, _dx2, dy2 = dock_bounds(width, height)
    icon_y = (dy1 + dy2) // 2
    center = width // 2

    def box(cx: int) -> dict[str, int]:
        return {
            "x1": cx - ICON_HIT,
            "y1": icon_y - ICON_HIT,
            "x2": cx + ICON_HIT,
            "y2": icon_y + ICON_HIT,
            "cx": cx,
            "cy": icon_y,
        }

    return {
        "chrome": box(center - ICON_GAP),
        "files": box(center),
        "terminal": box(center + ICON_GAP),
    }


def dock_bounds(width: int, height: int) -> tuple[int, int, int, int]:
    dx1 = (width - DOCK_W) // 2
    dy2 = height - DOCK_MARGIN
    dy1 = dy2 - DOCK_H
    return dx1, dy1, dx1 + DOCK_W, dy2


def dock_shelf_bounds(width: int, height: int) -> tuple[int, int, int, int]:
    """Full-width wallpaper band that contains the icon row and the bottom margin.

    Drawn only while no app is mapped. On an empty desktop the band is the
    same color as the wallpaper, so it does not read as a tray.
    """
    _dx1, dy1, _dx2, _dy2 = dock_bounds(width, height)
    return 0, dy1, width, height


def app_work_area(width: int, height: int) -> tuple[int, int, int, int]:
    """Apps cover the whole framebuffer. The icon band is hidden while one is mapped."""
    return 0, 0, width, height


def logo_point(width: int, height: int) -> tuple[int, int]:
    _dx1, dy1, _dx2, _dy2 = dock_bounds(width, height)
    # Center the mark in the wallpaper above the dock.
    return width // 2, dy1 // 2


def hit_launcher(width: int, height: int, x: int, y: int) -> str | None:
    for name, rect in desktop_hotspots(width, height).items():
        if rect["x1"] <= x <= rect["x2"] and rect["y1"] <= y <= rect["y2"]:
            return name
    return None


def files_start_dir() -> Path:
    home = Path(os.environ.get("HOME", "/tmp")).expanduser()
    if home.is_dir():
        return home
    return Path("/tmp")


def spawn(args: list[str]) -> None:
    if not args:
        return
    executable = args[0]
    if shutil.which(executable) is None and not os.access(executable, os.X_OK):
        print(f"desktop launcher missing: {executable}", file=sys.stderr, flush=True)
        return
    subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def chrome_start_url() -> str:
    requested = os.environ.get("OPENBOT_BROWSER_START_URL", "").strip()
    if requested:
        return requested
    page = Path(START_PAGE)
    if page.is_file():
        return page.as_uri()
    return "about:blank"


def chrome_launcher(width: int = 1280, height: int = 800) -> list[str]:
    url = chrome_start_url()
    _x, _y, work_w, work_h = app_work_area(width, height)
    # Full framebuffer. The shelf unmaps while this window is on screen.
    flags = [f"--window-size={work_w},{work_h}", "--window-position=0,0"]
    launcher = os.environ.get("OPENBOT_BROWSER_CHROME_LAUNCHER", "").strip()
    if launcher and os.access(launcher, os.X_OK):
        return [launcher, *flags, url]
    binary = shutil.which("chromium") or shutil.which("chromium-browser") or "chromium"
    return [binary, *flags, url]


def terminal_argv() -> list[str] | None:
    binary = shutil.which("xterm")
    if not binary:
        return None
    home = shlex.quote(str(files_start_dir()))
    # Liberation Mono ships in the browser image. A missing Xft font makes xterm
    # exit immediately, so the dock icon would look clickable and do nothing.
    return [
        binary,
        "-title",
        "终端",
        "-fa",
        "Liberation Mono",
        "-fs",
        "12",
        "+sb",
        "-b",
        "0",
        "-bg",
        "#1e1e1e",
        "-fg",
        "#f2f2f2",
        "-e",
        "bash",
        "-c",
        f"cd {home} && exec bash",
    ]


def open_chrome() -> None:
    width, height = _screen_size
    spawn(chrome_launcher(width, height))


def open_terminal() -> None:
    argv = terminal_argv()
    if not argv:
        print("desktop launcher missing: xterm", file=sys.stderr, flush=True)
        return
    spawn(argv)


def logo_path() -> Path | None:
    override = os.environ.get("OPENBOT_BROWSER_LOGO", "").strip()
    candidates: list[Path] = []
    if override:
        candidates.append(Path(override))
    candidates.append(Path(LOGO_FILE))
    candidates.append(Path(__file__).resolve().parents[1] / "ui/public/openbot-logo.png")
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def load_tk():
    import tkinter as tk
    import tkinter.font as tkfont

    return tk, tkfont


def ui_font(size: int, weight: str = "normal") -> tuple[str, int, str]:
    _tk, tkfont = load_tk()
    try:
        families = set(tkfont.families())
    except Exception:
        families = set()
    for name in ("WenQuanYi Micro Hei", "Noto Sans CJK SC", "DejaVu Sans"):
        if name in families:
            return (name, size, weight)
    return ("sans", size, weight)


def round_rect(canvas, x1: int, y1: int, x2: int, y2: int, radius: int, **kwargs: object) -> int:
    radius = int(min(radius, max(1, (x2 - x1) / 2), max(1, (y2 - y1) / 2)))
    points = [
        x1 + radius,
        y1,
        x2 - radius,
        y1,
        x2,
        y1,
        x2,
        y1 + radius,
        x2,
        y2 - radius,
        x2,
        y2,
        x2 - radius,
        y2,
        x1 + radius,
        y2,
        x1,
        y2,
        x1,
        y2 - radius,
        x1,
        y1 + radius,
        x1,
        y1,
    ]
    return canvas.create_polygon(points, smooth=True, splinesteps=24, **kwargs)


def place_logo(root, canvas, center_x: int, center_y: int) -> None:
    tk, _tkfont = load_tk()
    path = logo_path()
    if path is None:
        return
    try:
        loaded = tk.PhotoImage(master=root, file=str(path))
    except tk.TclError:
        return
    shown = loaded
    # Native mark is 416×277. Half size sits in the wallpaper above the dock.
    if loaded.width() > 280:
        factor = max(2, int(round(loaded.width() / 240)))
        shown = loaded.subsample(factor, factor)
    # PhotoImage is collected if nothing keeps a reference.
    setattr(canvas, "logo_images", (loaded, shown))
    canvas.create_image(center_x, center_y, image=shown, anchor="center")


def files_launch_dir(start: Path | None = None) -> Path:
    """Absolute directory Thunar should open. Same start as files_start_dir()."""
    directory = start if start is not None else files_start_dir()
    if not directory.is_dir():
        directory = directory.parent if directory.parent.is_dir() else Path("/tmp")
    return directory.resolve()


def files_argv(start: Path | None = None) -> list[str] | None:
    """Prefer `thunar <absolute path>`. Fall back to xdg-open for the same path."""
    path = str(files_launch_dir(start))
    binary = shutil.which("thunar")
    if binary:
        return [binary, path]
    opener = shutil.which("xdg-open")
    if opener:
        return [opener, path]
    return None


def draw_chrome(canvas, cx: int, cy: int, radius: int) -> None:
    canvas.create_oval(cx - radius, cy - radius, cx + radius, cy + radius, fill="#4285f4", outline="")
    canvas.create_arc(
        cx - radius,
        cy - radius,
        cx + radius,
        cy + radius,
        start=90,
        extent=120,
        fill="#ea4335",
        outline="",
    )
    canvas.create_arc(
        cx - radius,
        cy - radius,
        cx + radius,
        cy + radius,
        start=210,
        extent=120,
        fill="#fbbc05",
        outline="",
    )
    canvas.create_arc(
        cx - radius,
        cy - radius,
        cx + radius,
        cy + radius,
        start=330,
        extent=120,
        fill="#34a853",
        outline="",
    )
    inner = int(radius * 0.46)
    canvas.create_oval(cx - inner, cy - inner, cx + inner, cy + inner, fill="#ffffff", outline="")
    core = int(radius * 0.28)
    canvas.create_oval(cx - core, cy - core, cx + core, cy + core, fill="#4285f4", outline="")


def draw_files(canvas, cx: int, cy: int, radius: int) -> None:
    # Dark gold silhouette so the folder stays visible without a tray behind it.
    edge = max(2, radius // 16)
    left, right = cx - radius, cx + radius
    top, bottom = cy - radius, cy + radius
    tab_h = max(10, radius // 3)
    tab_w = max(18, int(radius * 0.62))
    round_rect(
        canvas,
        left,
        top + tab_h - 2,
        right,
        bottom,
        12,
        fill=FOLDER_BODY,
        outline=FOLDER_EDGE,
        width=edge,
    )
    round_rect(
        canvas,
        left,
        top,
        left + tab_w,
        top + tab_h + 6,
        6,
        fill=FOLDER_TAB,
        outline=FOLDER_EDGE,
        width=edge,
    )
    inset = max(7, radius // 5)
    round_rect(
        canvas,
        left + inset,
        cy,
        right - inset,
        bottom - inset,
        8,
        fill=FOLDER_FRONT,
        outline=FOLDER_EDGE,
        width=max(1, edge - 1),
    )


def draw_terminal(canvas, cx: int, cy: int, radius: int) -> None:
    round_rect(canvas, cx - radius, cy - radius, cx + radius, cy + radius, 10, fill="#1c1c1f", outline="")
    canvas.create_text(
        cx,
        cy,
        text=">_ ",
        fill="#f4f4f5",
        font=ui_font(max(16, int(round(radius * 0.55))), "bold"),
    )


def wait_for_wm() -> None:
    if shutil.which("xprop") is None:
        return
    for _ in range(40):
        result = subprocess.call(
            ["xprop", "-root", "_NET_SUPPORTING_WM_CHECK"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if result == 0:
            return
        subprocess.call(["sleep", "0.05"])


def open_files() -> None:
    """Launch Thunar on the sandbox home. The dock raises an existing window.

    There is no Tk list. Openbox matches class Thunar / title ``* - Thunar``
    and maximizes that window. xdg-open is only used when thunar is absent.
    """
    argv = files_argv()
    if not argv:
        print("desktop launcher missing: thunar", file=sys.stderr, flush=True)
        return
    spawn(argv)


def is_thunar_client(wm_class: str, title: str) -> bool:
    """Real Thunar window. The retired Tk list titled 文件 is not one."""
    parts = [part for part in wm_class.lower().split(".") if part]
    if "thunar" in parts:
        return True
    stripped = title.strip()
    return stripped == "Thunar" or stripped.endswith(" - Thunar")


def same_window(left: str, right: str) -> bool:
    try:
        return int(left, 16) == int(right, 16)
    except ValueError:
        return left == right


def client_matches(name: str, wm_class: str, title: str) -> bool:
    kind = wm_class.lower()
    if name == "chrome":
        return "chromium" in kind or "chrome" in kind
    if name == "files":
        return is_thunar_client(wm_class, title)
    if name == "terminal":
        return title == "终端" or "xterm" in kind
    return False


def client_is_app(wm_class: str, title: str) -> bool:
    """Chrome, Thunar, or xterm. The wallpaper and the shelf are not apps."""
    if title in {"OpenBot Desktop", "OpenBot Dock"}:
        return False
    kind = wm_class.lower()
    if "chromium" in kind or "chrome" in kind:
        return True
    if is_thunar_client(wm_class, title) or title == "终端" or "xterm" in kind:
        return True
    return False


def shelf_should_show(
    clients: list[tuple[str, str, str]],
    hidden_ids: set[str] | None = None,
) -> bool:
    """Icons stay on an empty desktop. Any mapped, non-minimized app hides them."""
    hidden = hidden_ids or set()
    for wid, wm_class, title in clients:
        if not client_is_app(wm_class, title):
            continue
        if any(same_window(wid, item) for item in hidden):
            continue
        return False
    return True


def dock_click_action(
    name: str,
    clients: list[tuple[str, str, str]],
) -> tuple[str, str | None]:
    """Launch when that app is not open. Otherwise raise it, including from minimized.

    The shelf is unmapped while an app is on screen, so a click cannot mean
    "minimize the front window".
    """
    matched = [wid for wid, wm_class, title in clients if client_matches(name, wm_class, title)]
    if not matched:
        return ("launch", None)
    return ("raise", matched[0])


def list_client_rows() -> list[tuple[str, str, str, tuple[int, int, int, int] | None]]:
    """wmctrl -lGx rows: (id, class, title, geometry or None)."""
    if shutil.which("wmctrl") is None:
        return []
    try:
        output = subprocess.check_output(["wmctrl", "-lGx"], text=True, stderr=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, OSError):
        return []
    rows: list[tuple[str, str, str, tuple[int, int, int, int] | None]] = []
    for line in output.splitlines():
        # id desk x y w h class host title...
        parts = line.split(None, 8)
        if len(parts) < 8:
            continue
        wid, _desk, xs, ys, ws, hs, wm_class, _host = parts[:8]
        title = parts[8] if len(parts) > 8 else ""
        try:
            geom = (int(xs), int(ys), int(ws), int(hs))
        except ValueError:
            geom = None
        rows.append((wid, wm_class, title, geom))
    return rows


def list_clients() -> list[tuple[str, str, str]]:
    return [(wid, wm_class, title) for wid, wm_class, title, _geom in list_client_rows()]


def windows_to_hide(
    clients: list[tuple[str, str, str]],
    hidden_ids: set[str] | None = None,
) -> list[str]:
    """Apps still covering the desktop. Ids already off-screen are left alone."""
    hidden = hidden_ids or set()
    chosen: list[str] = []
    for wid, wm_class, title in clients:
        if not client_is_app(wm_class, title):
            continue
        if any(same_window(wid, item) for item in hidden):
            continue
        chosen.append(wid)
    return chosen


def hide_client(wid: str) -> None:
    """Unmap one app so the dock shelf can return. The process keeps running."""
    if shutil.which("wmctrl") is None or not wid:
        return
    subprocess.call(
        ["wmctrl", "-i", "-r", wid, "-b", "remove,fullscreen,maximized_vert,maximized_horz"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.call(
        ["wmctrl", "-i", "-r", wid, "-b", "add,hidden"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def show_desktop() -> list[str]:
    """Hide every visible app. The shelf poll maps the dock once the screen is clear.

    Control UI 返回桌面 sends Control+Alt+D. Openbox binds that chord to
    `openbot-sandbox-desktop --show-desktop`, which calls this function.
    """
    already: set[str] = set()
    rows = list_clients()
    for wid, wm_class, title in rows:
        if client_is_app(wm_class, title) and not client_is_visible(wid):
            already.add(wid)
    targets = windows_to_hide(rows, already)
    for wid in targets:
        hide_client(wid)
    return targets


def client_is_visible(wid: str) -> bool:
    """Mapped and not minimized. Iconic and withdrawn windows do not cover the desktop."""
    if shutil.which("xprop") is None:
        return True
    try:
        output = subprocess.check_output(
            ["xprop", "-id", wid, "WM_STATE", "_NET_WM_STATE"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, OSError):
        return False
    if "Iconic" in output or "Withdrawn" in output or "_NET_WM_STATE_HIDDEN" in output:
        return False
    return True


def parse_stacking_order(xprop_line: str) -> list[str]:
    """Parse `_NET_CLIENT_LIST_STACKING` from xprop. Bottom window first."""
    if ":" not in xprop_line:
        return []
    _, _, rhs = xprop_line.partition(":")
    rhs = rhs.strip()
    # Forms: "window id # 0x1, 0x2" or bare "0x1, 0x2"
    if "#" in rhs:
        rhs = rhs.split("#", 1)[1]
    ids: list[str] = []
    for part in rhs.split(","):
        token = part.strip().split()[0] if part.strip() else ""
        if token.lower().startswith("0x"):
            ids.append(token)
    return ids


def stacking_needs_app_raise(
    stacking: list[str],
    app_ids: list[str],
    wallpaper_ids: list[str],
) -> bool:
    """True when any wallpaper/desktop window sits above a visible app.

    Openbox can raise the Tk wallpaper (Focus/Raise on click, Map) even with
    `<layer>below</layer>`. ensure_full_frame used to no-op once Chromium was
    already 1280x800, so Control UI 「电脑」kept showing only the wallpaper.
    """
    last_app = -1
    last_wall = -1
    for index, wid in enumerate(stacking):
        if any(same_window(wid, app) for app in app_ids):
            last_app = index
        if any(same_window(wid, wall) for wall in wallpaper_ids):
            last_wall = index
    return last_app >= 0 and last_wall > last_app


def list_stacking_order() -> list[str]:
    if shutil.which("xprop") is None:
        return []
    try:
        output = subprocess.check_output(
            ["xprop", "-root", "_NET_CLIENT_LIST_STACKING"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, OSError):
        return []
    for line in output.splitlines():
        if "_NET_CLIENT_LIST_STACKING" in line:
            return parse_stacking_order(line)
    return []


def wallpaper_window_ids(
    rows: list[tuple[str, str, str, tuple[int, int, int, int] | None]] | None = None,
) -> list[str]:
    """Tk wallpaper + dock shelf. Not app windows."""
    chosen: list[str] = []
    for wid, _wm_class, title, _geom in rows if rows is not None else list_client_rows():
        if title in {"OpenBot Desktop", "OpenBot Dock"}:
            chosen.append(wid)
    return chosen


def ensure_wallpaper_below(wid: str) -> None:
    """Re-assert Openbox below so a raised wallpaper cannot cover Chromium."""
    if shutil.which("wmctrl") is None or not wid:
        return
    subprocess.call(
        ["wmctrl", "-i", "-r", wid, "-b", "add,below"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def raise_client(wid: str) -> None:
    if shutil.which("wmctrl") is None or not wid:
        return
    subprocess.call(
        ["wmctrl", "-i", "-a", wid],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def ensure_full_frame(
    wid: str,
    geom: tuple[int, int, int, int] | None,
    width: int,
    height: int,
    *,
    force: bool = False,
    raise_window: bool = True,
) -> None:
    """Pin one app to the framebuffer and optionally raise it above wallpaper."""
    if shutil.which("wmctrl") is None:
        return
    geom_ok = not force and geom == (0, 0, width, height)
    if not geom_ok:
        # While maximized/fullscreen is set, -e is ignored. Clear it, place the
        # window, then maximize so Openbox keeps new Chromium windows full screen.
        subprocess.call(
            ["wmctrl", "-i", "-r", wid, "-b", "remove,hidden,fullscreen,maximized_vert,maximized_horz"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        subprocess.call(
            ["wmctrl", "-i", "-r", wid, "-e", f"0,0,0,{width},{height}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        subprocess.call(
            ["wmctrl", "-i", "-r", wid, "-b", "add,maximized_vert,maximized_horz"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    if raise_window or not geom_ok:
        raise_client(wid)


def apply_dock_action(action: str, wid: str | None, width: int, height: int) -> None:
    if action != "raise" or not wid:
        return
    ensure_full_frame(wid, None, width, height, force=True)


def raise_matching(name: str, width: int, height: int) -> bool:
    matched = [wid for wid, wm_class, title in list_clients() if client_matches(name, wm_class, title)]
    if not matched:
        return False
    apply_dock_action("raise", matched[0], width, height)
    return True


def hide_shelf(root) -> None:
    dock = getattr(root, "dock", None)
    if dock is None:
        return
    try:
        dock.withdraw()
    except Exception:
        pass


def show_shelf(root) -> None:
    dock = getattr(root, "dock", None)
    if dock is None:
        return
    try:
        if dock.winfo_ismapped():
            return
        dock.deiconify()
        dock.lift()
    except Exception:
        pass


def sync_desktop(root, width: int, height: int) -> None:
    """Unmap the shelf while any app is on screen, maximize, and keep apps above wallpaper.

    Polls wmctrl so Chromium windows opened through CDP (not the Dock) are
    covered too. A minimized app does not count, and the icons come back.
    Geometry no longer gates raise: once Chromium is full-frame, stacking is
    still corrected when Openbox lifts the wallpaper over it.
    """
    try:
        rows = list_client_rows()
        visible: list[tuple[str, tuple[int, int, int, int] | None]] = []
        for wid, wm_class, title, geom in rows:
            if not client_is_app(wm_class, title):
                continue
            if not client_is_visible(wid):
                continue
            visible.append((wid, geom))
        if visible:
            hide_shelf(root)
            try:
                root.lower()
            except Exception:
                pass
            wall_ids = wallpaper_window_ids(rows)
            for wall_id in wall_ids:
                ensure_wallpaper_below(wall_id)
            app_ids = [wid for wid, _geom in visible]
            need_raise = stacking_needs_app_raise(list_stacking_order(), app_ids, wall_ids)
            for wid, geom in visible:
                ensure_full_frame(wid, geom, width, height, raise_window=need_raise)
        else:
            show_shelf(root)
    except Exception as exc:
        print(f"desktop sync failed: {exc}", file=sys.stderr, flush=True)
    try:
        root.after(200, lambda: sync_desktop(root, width, height))
    except Exception:
        pass


_recent_launch: dict[str, float] = {}
_screen_size = (1280, 800)


def launch_named(root, name: str, action) -> None:
    """Run one launcher. Press and release both bind here so a window manager
    that consumes ButtonPress still activates on ButtonRelease, and a second
    event for the same click does not open two windows.

    An icon launches the app, or raises it if it is already open (including
    minimized). The shelf unmaps as soon as that app is on screen.
    """
    now = time.monotonic()
    if now - _recent_launch.get(name, 0.0) < 0.4:
        return
    _recent_launch[name] = now
    width, height = _screen_size
    try:
        width = root.winfo_screenwidth()
        height = root.winfo_screenheight()
    except Exception:
        pass
    verb, wid = dock_click_action(name, list_clients())
    hide_shelf(root)
    if verb == "launch":
        action()
        schedule_maximize(root, name, width, height, 0)
    else:
        apply_dock_action(verb, wid, width, height)
    # Openbox raises the desktop client on button press. Keep the wallpaper under the app.
    try:
        root.lower()
        root.after(150, root.lower)
    except Exception:
        pass


def schedule_maximize(root, name: str, width: int, height: int, attempt: int) -> None:
    if raise_matching(name, width, height):
        return
    if attempt >= 10:
        return
    try:
        root.after(200, lambda: schedule_maximize(root, name, width, height, attempt + 1))
    except Exception:
        pass


def launch_at(root, width: int, height: int, x: int, y: int) -> None:
    name = hit_launcher(width, height, x, y)
    if name == "chrome":
        launch_named(root, name, open_chrome)
    elif name == "files":
        launch_named(root, name, open_files)
    elif name == "terminal":
        launch_named(root, name, open_terminal)


def mount_launcher(root, canvas, rect: dict[str, int], draw, name: str, action) -> None:
    """Own X window per icon, wallpaper behind the glyph, no dock tray.

    Canvas polygons do not get their own event window. Openbox's default
    client mousebind consumes ButtonPress for Focus/Raise, so a canvas
    `<Button-1>` can miss a noVNC click while the glyph still looks live.
    The embedded window takes the click itself. Press and release both launch;
    `launch_named` collapses the pair.
    """
    tk, _tkfont = load_tk()
    span_w = rect["x2"] - rect["x1"]
    span_h = rect["y2"] - rect["y1"]
    # The glyph window has to share the shelf toplevel. A child of the
    # wallpaper root cannot be embedded in the dock canvas.
    holder = tk.Canvas(
        canvas.master,
        width=span_w,
        height=span_h,
        highlightthickness=0,
        bd=0,
        bg=WALLPAPER,
        cursor="hand2",
    )
    draw(holder, span_w // 2, span_h // 2, ICON_GLYPH)
    canvas.create_window(rect["cx"], rect["cy"], window=holder, width=span_w, height=span_h)

    def fire(_event=None) -> None:
        try:
            launch_named(root, name, action)
        except Exception as exc:
            print(f"desktop launch failed: {exc}", file=sys.stderr, flush=True)

    holder.bind("<Button-1>", fire)
    holder.bind("<ButtonRelease-1>", fire)
    holders = getattr(canvas, "launchers", [])
    holders.append(holder)
    setattr(canvas, "launchers", holders)


def remember_screen(width: int, height: int) -> None:
    global _screen_size
    _screen_size = (width, height)


def local_hotspot(rect: dict[str, int], origin_x: int, origin_y: int) -> dict[str, int]:
    return {
        "x1": rect["x1"] - origin_x,
        "y1": rect["y1"] - origin_y,
        "x2": rect["x2"] - origin_x,
        "y2": rect["y2"] - origin_y,
        "cx": rect["cx"] - origin_x,
        "cy": rect["cy"] - origin_y,
    }


def run_desktop() -> None:
    tk, _tkfont = load_tk()
    wait_for_wm()
    root = tk.Tk()
    root.title("OpenBot Desktop")
    root.configure(bg=WALLPAPER)
    root.update_idletasks()
    width = root.winfo_screenwidth()
    height = root.winfo_screenheight()
    remember_screen(width, height)
    root.geometry(f"{width}x{height}+0+0")
    canvas = tk.Canvas(root, width=width, height=height, highlightthickness=0, bg=WALLPAPER, bd=0)
    canvas.pack(fill="both", expand=True)

    # Edges stay WALLPAPER so the Control UI letterbox (#e7e7eb) stays seamless.
    logo_x, logo_y = logo_point(width, height)
    place_logo(root, canvas, logo_x, logo_y)

    shelf_x, shelf_y, shelf_x2, shelf_y2 = dock_shelf_bounds(width, height)
    shelf_w = shelf_x2 - shelf_x
    shelf_h = shelf_y2 - shelf_y
    dock = tk.Toplevel(root)
    dock.withdraw()
    dock.title("OpenBot Dock")
    dock.configure(bg=WALLPAPER)
    # Unmanaged so the shelf can be unmapped without Openbox restacking it
    # above a maximized app. It is only mapped on an empty desktop.
    dock.overrideredirect(True)
    dock.geometry(f"{shelf_w}x{shelf_h}+{shelf_x}+{shelf_y}")
    dock.resizable(False, False)
    setattr(root, "dock", dock)
    shelf = tk.Canvas(dock, width=shelf_w, height=shelf_h, highlightthickness=0, bg=WALLPAPER, bd=0)
    shelf.pack(fill="both", expand=True)

    hotspots = desktop_hotspots(width, height)
    mount_launcher(
        root,
        shelf,
        local_hotspot(hotspots["chrome"], shelf_x, shelf_y),
        draw_chrome,
        "chrome",
        open_chrome,
    )
    mount_launcher(
        root,
        shelf,
        local_hotspot(hotspots["files"], shelf_x, shelf_y),
        draw_files,
        "files",
        open_files,
    )
    mount_launcher(
        root,
        shelf,
        local_hotspot(hotspots["terminal"], shelf_x, shelf_y),
        draw_terminal,
        "terminal",
        open_terminal,
    )

    def on_click(event) -> None:
        try:
            launch_at(root, width, height, event.x + shelf_x, event.y + shelf_y)
        except Exception as exc:
            print(f"desktop launch failed: {exc}", file=sys.stderr, flush=True)

    def place_shelf(_event=None) -> None:
        dock.geometry(f"{shelf_w}x{shelf_h}+{shelf_x}+{shelf_y}")
        try:
            if dock.winfo_ismapped():
                dock.lift()
        except Exception:
            pass

    # Backup for clicks that land on the shelf but miss the glyph window.
    shelf.bind("<Button-1>", on_click)
    shelf.bind("<ButtonRelease-1>", on_click)
    dock.bind("<Map>", place_shelf)
    root.bind("<Map>", lambda _event: root.lower())
    dock.deiconify()
    root.after(200, lambda: sync_desktop(root, width, height))
    root.lower()
    root.mainloop()


def main(argv: list[str] | None = None) -> None:
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] == ["--print-hotspots"]:
        width = int(args[1]) if len(args) > 1 else 1280
        height = int(args[2]) if len(args) > 2 else 800
        json.dump(desktop_hotspots(width, height), sys.stdout)
        sys.stdout.write("\n")
        return
    if args[:1] == ["--print-layout"]:
        width = int(args[1]) if len(args) > 1 else 1280
        height = int(args[2]) if len(args) > 2 else 800
        shelf = dock_shelf_bounds(width, height)
        work = app_work_area(width, height)
        json.dump({"shelf": list(shelf), "work": list(work)}, sys.stdout)
        sys.stdout.write("\n")
        return
    if args[:1] == ["--dock-action"]:
        # name active-id class title wid ...
        # active-id is accepted and ignored. Clicks raise; they do not minimize.
        name = args[1]
        rest = args[3:]
        clients: list[tuple[str, str, str]] = []
        for index in range(0, len(rest), 3):
            wm_class, title, wid = rest[index : index + 3]
            clients.append((wid, wm_class, title))
        verb, wid = dock_click_action(name, clients)
        sys.stdout.write(f"{verb} {wid or '-'}\n")
        return
    if args[:1] == ["--shelf-visible"]:
        # [hidden:id,id] class title wid ...
        rest = args[1:]
        hidden: set[str] = set()
        if rest and rest[0].startswith("hidden:"):
            hidden = {part for part in rest[0].split(":", 1)[1].split(",") if part}
            rest = rest[1:]
        clients = []
        for index in range(0, len(rest), 3):
            chunk = rest[index : index + 3]
            if len(chunk) < 3:
                break
            wm_class, title, wid = chunk
            clients.append((wid, wm_class, title))
        sys.stdout.write("show\n" if shelf_should_show(clients, hidden) else "hide\n")
        return
    if args[:1] == ["--show-desktop-plan"]:
        # [hidden:id,id] class title wid ...
        rest = args[1:]
        hidden: set[str] = set()
        if rest and rest[0].startswith("hidden:"):
            hidden = {part for part in rest[0].split(":", 1)[1].split(",") if part}
            rest = rest[1:]
        clients = []
        for index in range(0, len(rest), 3):
            chunk = rest[index : index + 3]
            if len(chunk) < 3:
                break
            wm_class, title, wid = chunk
            clients.append((wid, wm_class, title))
        for wid in windows_to_hide(clients, hidden):
            sys.stdout.write(f"{wid}\n")
        return
    if args[:1] == ["--show-desktop"]:
        found = show_desktop()
        sys.stdout.write(f"{len(found)}\n")
        return
    if args[:1] == ["--stacking-needs-raise"]:
        # stacking:id,id wallpaper:id,id app:id,id  -> yes|no
        stacking: list[str] = []
        wallpaper_ids: list[str] = []
        app_ids: list[str] = []
        for token in args[1:]:
            if token.startswith("stacking:"):
                stacking = [part for part in token.split(":", 1)[1].split(",") if part]
            elif token.startswith("wallpaper:"):
                wallpaper_ids = [part for part in token.split(":", 1)[1].split(",") if part]
            elif token.startswith("app:"):
                app_ids = [part for part in token.split(":", 1)[1].split(",") if part]
        sys.stdout.write(
            "yes\n" if stacking_needs_app_raise(stacking, app_ids, wallpaper_ids) else "no\n"
        )
        return
    if args[:1] == ["--hit"]:
        width, height, x, y = (int(args[i]) for i in range(1, 5))
        print(hit_launcher(width, height, x, y) or "none")
        return
    run_desktop()


if __name__ == "__main__":
    main()
