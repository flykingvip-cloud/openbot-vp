#!/usr/bin/env python3
"""Deterministic HTML/CSS design lint. No network. Fail closed on empty input."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HEADING_RE = re.compile(r"<h([1-6])\b", re.I)
BUTTON_RE = re.compile(r"<(button|a)\b([^>]*)>", re.I)
SIZE_RE = re.compile(r"(?:width|height|min-width|min-height)\s*:\s*(\d+)px", re.I)
HEX_RE = re.compile(r"#(?:[0-9a-f]{3}|[0-9a-f]{6})\b", re.I)
WEAK_HEX = {"#ccc", "#cccccc", "#ddd", "#dddddd", "#eee", "#eeeeee", "#999", "#999999"}
SPACE_RE = re.compile(r"(?:margin|padding)(?:-[a-z]+)?\s*:\s*([^;]+)", re.I)
MEDIA_RE = re.compile(r"@media\b", re.I)
MAX_W_RE = re.compile(r"max-width\s*:\s*(\d+)(?:px|ch)", re.I)


def _iter_files(root: Path) -> list[Path]:
    if root.is_file():
        return [root]
    files: list[Path] = []
    for ext in ("*.html", "*.htm", "*.css"):
        files.extend(root.rglob(ext))
    return sorted(files)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def audit_text(text: str, label: str) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    levels = [int(m.group(1)) for m in HEADING_RE.finditer(text)]
    prev = 0
    for level in levels:
        if prev and level > prev + 1:
            issues.append(
                {
                    "id": "heading-skip",
                    "severity": "P1",
                    "file": label,
                    "detail": f"heading jumps h{prev} → h{level}",
                }
            )
            break
        prev = level

    for match in BUTTON_RE.finditer(text):
        attrs = match.group(2)
        sizes = [int(n) for n in SIZE_RE.findall(attrs)]
        if sizes and max(sizes) < 44:
            issues.append(
                {
                    "id": "touch-target",
                    "severity": "P0",
                    "file": label,
                    "detail": f"interactive box {max(sizes)}px < 44px",
                }
            )

    hexes = {h.lower() for h in HEX_RE.findall(text)}
    if hexes & WEAK_HEX:
        issues.append(
            {
                "id": "weak-contrast",
                "severity": "P1",
                "file": label,
                "detail": f"weak gray tokens {sorted(hexes & WEAK_HEX)}",
            }
        )
    if len(hexes) >= 12:
        issues.append(
            {
                "id": "color-sprawl",
                "severity": "P2",
                "file": label,
                "detail": f"{len(hexes)} distinct hex colors",
            }
        )

    max_widths = MAX_W_RE.findall(text)
    for raw in max_widths:
        if int(raw) >= 900:
            issues.append(
                {
                    "id": "content-width",
                    "severity": "P2",
                    "file": label,
                    "detail": f"max-width {raw}px is too wide for reading",
                }
            )

    spaces = {re.sub(r"\s+", " ", s.strip().lower()) for s in SPACE_RE.findall(text)}
    if len(spaces) >= 10:
        issues.append(
            {
                "id": "spacing-drift",
                "severity": "P2",
                "file": label,
                "detail": f"{len(spaces)} distinct margin/padding values",
            }
        )

    if re.search(r"overflow\s*:\s*hidden", text, re.I) and re.search(
        r"width\s*:\s*100vw", text, re.I
    ):
        issues.append(
            {
                "id": "overflow",
                "severity": "P1",
                "file": label,
                "detail": "100vw + overflow:hidden often clips mobile UI",
            }
        )

    if label.endswith((".html", ".htm", ".css")) and not MEDIA_RE.search(text):
        if "width" in text.lower() or "<body" in text.lower():
            issues.append(
                {
                    "id": "no-breakpoint",
                    "severity": "P1",
                    "file": label,
                    "detail": "no @media breakpoint",
                }
            )

    return issues


def audit_path(root: Path) -> list[dict[str, str]]:
    files = _iter_files(root)
    if not files:
        return [
            {
                "id": "no-input",
                "severity": "P0",
                "file": str(root),
                "detail": "no HTML/CSS files",
            }
        ]
    issues: list[dict[str, str]] = []
    for path in files:
        issues.extend(audit_text(_read(path), str(path)))
    return issues


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic design audit")
    parser.add_argument("target", nargs="?", help="HTML/CSS file or directory")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return 0 if _self_test() else 1
    if not args.target:
        parser.error("target required unless --self-test")
    issues = audit_path(Path(args.target))
    if args.json:
        print(json.dumps(issues, ensure_ascii=False, indent=2))
    else:
        if not issues:
            print("OK: no deterministic issues")
        for item in issues:
            print(f"{item['severity']} {item['id']} {item['file']}: {item['detail']}")
    return 1 if any(i["severity"] in {"P0", "P1"} for i in issues) else 0


def _self_test() -> bool:
    dirty = """
    <h1>Title</h1><h3>Skip</h3>
    <button style="width:20px;height:20px">x</button>
    <style>body{color:#ccc;width:100vw;overflow:hidden;max-width:1200px}</style>
    """
    clean = """
    <h1>Title</h1><h2>Next</h2>
    <button style="min-width:44px;min-height:44px">ok</button>
    <style>@media (max-width: 640px){body{max-width:68ch;color:#111}}</style>
    """
    dirty_ids = {i["id"] for i in audit_text(dirty, "dirty.html")}
    clean_ids = {i["id"] for i in audit_text(clean, "clean.html")}
    needed = {"heading-skip", "touch-target", "weak-contrast", "no-breakpoint"}
    if not needed <= dirty_ids:
        print("self-test missing", needed - dirty_ids, file=sys.stderr)
        return False
    if clean_ids & needed:
        print("self-test false positive", clean_ids & needed, file=sys.stderr)
        return False
    print("self-test ok")
    return True


if __name__ == "__main__":
    raise SystemExit(main())
