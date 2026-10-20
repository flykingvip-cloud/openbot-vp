#!/usr/bin/env python3
"""Allocate a collision-safe run directory for a confirmed URL. No network."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

RUN_RE = re.compile(r"^run-(\d+)$")


def validate_url(url: str) -> str | None:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return "url must be http(s) with a host"
    return None


def next_run_dir(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    highest = 0
    for item in root.iterdir():
        match = RUN_RE.match(item.name)
        if match:
            highest = max(highest, int(match.group(1)))
    return root / f"run-{highest + 1}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reserve a known-link asset run directory")
    parser.add_argument("--url")
    parser.add_argument("--confirmed", action="store_true")
    parser.add_argument("--out-root")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return 0 if _self_test() else 1
    if not args.url or not args.out_root:
        parser.error("--url and --out-root required unless --self-test")
    if not args.confirmed:
        print("REJECT: refuse to archive an unconfirmed URL")
        return 1
    error = validate_url(args.url)
    if error:
        print(f"REJECT: {error}")
        return 1
    dest = next_run_dir(Path(args.out_root))
    dest.mkdir(parents=False)
    (dest / "source-url.txt").write_text(args.url.strip() + "\n", encoding="utf-8")
    print(dest)
    return 0


def _self_test() -> bool:
    if validate_url("not-a-url") is None:
        print("accepted bad url", file=sys.stderr)
        return False
    if validate_url("https://x.com/a/status/1"):
        print("rejected good url", file=sys.stderr)
        return False
    import tempfile

    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        first = next_run_dir(root)
        first.mkdir()
        second = next_run_dir(root)
        if first.name != "run-1" or second.name != "run-2":
            print("run allocation", first, second, file=sys.stderr)
            return False
    print("self-test ok")
    return True


if __name__ == "__main__":
    raise SystemExit(main())
