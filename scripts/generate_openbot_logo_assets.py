#!/usr/bin/env python3
"""Regenerate OpenBot logo assets from the canonical transparent mark (ui/public/openbot-logo.png)."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TRANSPARENT_LOGO = ROOT / "ui/public/openbot-logo.png"
ICON_MASTER = ROOT / "apps/macos/Icon.icon/Assets/openbot-mac.png"
AUTH_LOGO = ROOT / "apps/macos/Sources/OpenBot/Resources/OpenBotAuthLogo.png"
ICNS = ROOT / "apps/macos/Sources/OpenBot/Resources/OpenBot.icns"
ICONSET = ROOT / "apps/macos/Icon.icon/openbot.iconset"
BUILD_ICONSET = ROOT / "apps/macos/build/icon/OpenBot.iconset"

APP_ICON_FILL = 0.94
ANDROID_FOREGROUND_FILL = 0.92
HEAD_MARK_HEIGHT_RATIO = 0.68
BLACK = (0, 0, 0, 255)

ANDROID_DENSITIES = {
    "mipmap-mdpi": (48, 108),
    "mipmap-hdpi": (72, 162),
    "mipmap-xhdpi": (96, 216),
    "mipmap-xxhdpi": (144, 324),
    "mipmap-xxxhdpi": (192, 432),
}

ICONSET_SIZES = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}

TRANSPARENT = (0, 0, 0, 0)


def load_logo() -> Image.Image:
    if not TRANSPARENT_LOGO.exists():
        raise SystemExit(f"Missing transparent logo: {TRANSPARENT_LOGO}")
    return trim_to_content(Image.open(TRANSPARENT_LOGO).convert("RGBA"))


def trim_to_content(img: Image.Image) -> Image.Image:
    arr = np.array(img)
    alpha = arr[:, :, 3]
    lum = arr[:, :, :3].max(axis=2)
    mask = (alpha > 8) & (lum > 12)
    if not mask.any():
        return img
    ys, xs = np.where(mask)
    pad = max(2, int(max(xs.max() - xs.min(), ys.max() - ys.min()) * 0.04))
    x0 = max(0, int(xs.min()) - pad)
    y0 = max(0, int(ys.min()) - pad)
    x1 = min(img.width - 1, int(xs.max()) + pad)
    y1 = min(img.height - 1, int(ys.max()) + pad)
    return img.crop((x0, y0, x1 + 1, y1 + 1))


def head_mark_only(img: Image.Image) -> Image.Image:
    trimmed = trim_to_content(img)
    arr = np.array(trimmed)
    alpha = arr[:, :, 3]
    lum = arr[:, :, :3].max(axis=2)
    mask = (alpha > 8) & (lum > 12)
    ys, _xs = np.where(mask)
    y0, y1 = int(ys.min()), int(ys.max())
    content_h = y1 - y0 + 1
    head_bottom = min(trimmed.height - 1, y0 + int(content_h * HEAD_MARK_HEIGHT_RATIO))
    return trim_to_content(trimmed.crop((0, y0, trimmed.width, head_bottom + 1)))


def paste_centered(
    content: Image.Image,
    canvas_size: int,
    fill: tuple[int, int, int, int],
    content_fill: float,
) -> Image.Image:
    target = max(1, int(round(canvas_size * content_fill)))
    scale = min(target / content.width, target / content.height)
    nw = max(1, int(round(content.width * scale)))
    nh = max(1, int(round(content.height * scale)))
    scaled = content.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), fill)
    ox = (canvas_size - nw) // 2
    oy = (canvas_size - nh) // 2
    canvas.paste(scaled, (ox, oy), scaled)
    return canvas


def flatten_opaque_black(img: Image.Image) -> Image.Image:
    """Full-bleed #000 plate: no transparent or semi-transparent fringe (avoids macOS tint)."""
    arr = np.array(img.convert("RGBA"), copy=True)
    rgb_max = arr[:, :, :3].max(axis=2)
    alpha = arr[:, :, 3]
    bg = (rgb_max <= 48) | (alpha < 250)
    arr[bg] = (0, 0, 0, 255)
    arr[:, :, 3] = 255
    return Image.fromarray(arr, mode="RGBA")


def auth_logo_for_login(logo: Image.Image) -> Image.Image:
    """Keep native size from ui/public — login UI scales in SwiftUI."""
    return logo.copy()


def write_iconset(master: Image.Image, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    rgb_master = master.convert("RGB")
    for name, px in ICONSET_SIZES.items():
        rgb_master.resize((px, px), Image.Resampling.LANCZOS).save(out_dir / name, "PNG")


def write_android(logo: Image.Image, app_master: Image.Image) -> None:
    res = ROOT / "apps/android/app/src/main/res"
    for folder, (launcher_px, fg_px) in ANDROID_DENSITIES.items():
        out_dir = res / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        app_master.convert("RGB").resize((launcher_px, launcher_px), Image.Resampling.LANCZOS).save(
            out_dir / "ic_launcher.png", "PNG"
        )
        paste_centered(logo, fg_px, TRANSPARENT, ANDROID_FOREGROUND_FILL).save(
            out_dir / "ic_launcher_foreground.png", "PNG"
        )

    colors = res / "values" / "colors.xml"
    colors.write_text(
        """<?xml version=\"1.0\" encoding=\"utf-8\"?>
<resources>
    <color name=\"ic_launcher_background\">#FF000000</color>
</resources>
""",
        encoding="utf-8",
    )


def write_ios_appicon(app_master: Image.Image) -> None:
    ios_dir = ROOT / "apps/ios/Sources/Assets.xcassets/AppIcon.appiconset"
    contents = json.loads((ios_dir / "Contents.json").read_text())
    rgb_master = app_master.convert("RGB")
    for entry in contents["images"]:
        fn = entry.get("filename")
        if not fn:
            continue
        px = entry.get("expected-size")
        if px is None:
            w = float(entry["size"].split("x")[0])
            scale = int(str(entry.get("scale", "1x")).replace("x", "") or "1")
            px = int(w * scale)
        rgb_master.resize((int(px), int(px)), Image.Resampling.LANCZOS).save(ios_dir / fn, "PNG")


def main() -> None:
    logo = load_logo()

    auth = auth_logo_for_login(logo)
    AUTH_LOGO.parent.mkdir(parents=True, exist_ok=True)
    auth.save(AUTH_LOGO, "PNG", optimize=True)

    icon_mark = head_mark_only(logo)
    app_master = flatten_opaque_black(paste_centered(icon_mark, 1024, BLACK, APP_ICON_FILL))
    ICON_MASTER.parent.mkdir(parents=True, exist_ok=True)
    app_master.save(ICON_MASTER, "PNG")
    write_iconset(app_master, ICONSET)
    write_iconset(app_master, BUILD_ICONSET)
    app_master.save(ICNS, format="ICNS")

    write_android(icon_mark, app_master)
    write_ios_appicon(app_master)

    preview = ROOT / "dist/mobile-test/auth-logo-preview.png"
    preview.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(AUTH_LOGO, preview)

    arr = np.array(app_master)
    opaque_black = ((arr[:, :, 3] == 255) & (arr[:, :, :3].max(axis=2) <= 48)).sum()
    print(f"source: {TRANSPARENT_LOGO}")
    print(f"auth:   {AUTH_LOGO} ({auth.size[0]}x{auth.size[1]})")
    print(f"app:    {ICON_MASTER} black_pixels={opaque_black}/{arr.shape[0]*arr.shape[1]} fill={APP_ICON_FILL}")
    print("Done.")
  # Keep Harmony launcher assets in sync with Mac master.
  sync = ROOT / "scripts/sync_harmony_icons.py"
  if sync.exists():
    import runpy
    runpy.run_path(str(sync), run_name="__main__")


if __name__ == "__main__":
    main()
