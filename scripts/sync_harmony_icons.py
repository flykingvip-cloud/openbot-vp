#!/usr/bin/env python3
"""Copy OpenBot Mac master icon into HarmonyOS layered launcher assets."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MAC_MASTER = ROOT / "apps/macos/Icon.icon/Assets/openbot-mac.png"
HARM_MEDIA = ROOT / "apps/harmony/AppScope/resources/base/media"
ENTRY_MEDIA = ROOT / "apps/harmony/entry/src/main/resources/base/media"


def main() -> None:
    if not MAC_MASTER.exists():
        raise SystemExit(f"Missing Mac icon master: {MAC_MASTER}")
    for d in (HARM_MEDIA, ENTRY_MEDIA):
        d.mkdir(parents=True, exist_ok=True)
    img = Image.open(MAC_MASTER).convert("RGBA")
    fg = img.resize((512, 512), Image.Resampling.LANCZOS)
    bg = Image.new("RGBA", (512, 512), (0, 0, 0, 255))
    fg.save(HARM_MEDIA / "foreground.png")
    bg.save(HARM_MEDIA / "background.png")
    img.resize((256, 256), Image.Resampling.LANCZOS).save(ENTRY_MEDIA / "startIcon.png")
    print(f"Harmony icons synced from {MAC_MASTER}")


if __name__ == "__main__":
    main()
