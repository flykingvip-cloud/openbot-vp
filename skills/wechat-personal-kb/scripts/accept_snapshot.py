#!/usr/bin/env python3
"""Reject WeChat client libraries and live SQLite sidecars before KB bind."""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

FORBIDDEN_PATH_PARTS = (
    "xwechat_files",
    "wechat app data",
    "com.tencent.xinwechat",
    "message/msg",
)
FORBIDDEN_NAMES = {
    "msg.db",
    "msg0.db",
    "session.db",
    "sns.db",
    "favorite.db",
    "micromsg.db",
}
SIDECAR_SUFFIXES = (".db-wal", ".db-shm", "-journal", ".wal", ".shm")
PLAINTEXT_SUFFIXES = {".txt", ".html", ".htm", ".csv", ".json", ".md"}


def _lower(path: Path) -> str:
    return str(path).replace("\\", "/").lower()


def inspect(root: Path) -> list[str]:
    errors: list[str] = []
    if not root.exists():
        return [f"path does not exist: {root}"]
    if not root.is_dir():
        return [f"not a directory (use personal.upload for a single file): {root}"]

    lowered = _lower(root)
    for part in FORBIDDEN_PATH_PARTS:
        if part in lowered:
            errors.append(f"client data root is not an export: matched {part!r}")

    has_plaintext = False
    for item in root.rglob("*"):
        if not item.is_file():
            continue
        name = item.name.lower()
        if name in FORBIDDEN_NAMES:
            errors.append(f"client database is not an export: {item.relative_to(root)}")
        if name.endswith(SIDECAR_SUFFIXES):
            errors.append(f"live sqlite sidecar is not a static snapshot: {item.relative_to(root)}")
        if item.suffix.lower() in PLAINTEXT_SUFFIXES:
            has_plaintext = True

    if not has_plaintext:
        errors.append("no plaintext export files (.txt/.html/.csv/.json/.md)")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Accept a WeChat plaintext export snapshot")
    parser.add_argument("path", nargs="?")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return 0 if _self_test() else 1
    if not args.path:
        parser.error("path required unless --self-test")
    errors = inspect(Path(args.path).expanduser())
    if errors:
        print("REJECT")
        for error in errors:
            print(f"- {error}")
        return 1
    print("OK: static plaintext export")
    return 0


def _self_test() -> bool:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        good = root / "export"
        good.mkdir()
        (good / "chat.txt").write_text("hello", encoding="utf-8")
        if inspect(good):
            print("false reject good export", inspect(good), file=sys.stderr)
            return False

        client = root / "xwechat_files" / "dump"
        client.mkdir(parents=True)
        (client / "chat.txt").write_text("hello", encoding="utf-8")
        if not any("client data root" in item for item in inspect(client)):
            print("missed client root", inspect(client), file=sys.stderr)
            return False

        live = root / "live"
        live.mkdir()
        (live / "chat.txt").write_text("hello", encoding="utf-8")
        (live / "MSG.db-wal").write_text("x", encoding="utf-8")
        if not any("sidecar" in item for item in inspect(live)):
            print("missed sidecar", inspect(live), file=sys.stderr)
            return False

        dbdir = root / "dbonly"
        dbdir.mkdir()
        (dbdir / "MSG.db").write_bytes(b"x")
        if not any("client database" in item for item in inspect(dbdir)):
            print("missed db", inspect(dbdir), file=sys.stderr)
            return False

    print("self-test ok")
    return True


if __name__ == "__main__":
    raise SystemExit(main())
