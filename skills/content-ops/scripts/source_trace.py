#!/usr/bin/env python3
"""Check derived copy still contains source facts (numbers, proper names, dates)."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

TOKEN_RE = re.compile(
    r"""
    (?P<date>\b\d{4}-\d{2}-\d{2}\b)
    |(?P<num>\b\d+(?:\.\d+)?%)
    |(?P<int>\b\d{2,}\b)
    |(?P<name>\b[A-Z][A-Za-z0-9]{2,}\b)
    """,
    re.VERBOSE,
)
STOP = {
    "The",
    "This",
    "That",
    "And",
    "For",
    "With",
    "From",
    "Your",
    "Our",
    "Not",
    "You",
    "Source",
    "Truth",
}


def tokens(text: str) -> set[str]:
    found: set[str] = set()
    for match in TOKEN_RE.finditer(text):
        value = match.group(0)
        if match.group("name") and value in STOP:
            continue
        found.add(value)
    return found


def missing_tokens(source: str, derived: str) -> list[str]:
    return sorted(tokens(source) - tokens(derived))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Trace derived facts back to source")
    parser.add_argument("--source")
    parser.add_argument("--derived")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return 0 if _self_test() else 1
    if not args.source or not args.derived:
        parser.error("--source and --derived required unless --self-test")
    source = Path(args.source).read_text(encoding="utf-8")
    derived = Path(args.derived).read_text(encoding="utf-8")
    missing = missing_tokens(source, derived)
    if missing:
        print("MISSING from derived:", ", ".join(missing))
        return 1
    print("OK: source tokens present in derived")
    return 0


def _self_test() -> bool:
    source = "Acme grew 23% on 2026-04-01 after Project Titan launched."
    good = "Acme reported 23% growth on 2026-04-01 when Project Titan shipped."
    bad = "A company grew quickly after a big launch."
    if missing_tokens(source, good):
        print("false fail", missing_tokens(source, good), file=sys.stderr)
        return False
    missed = missing_tokens(source, bad)
    required = {"23%", "2026-04-01", "Acme", "Titan"}
    if not required <= set(missed):
        print("false pass", missed, file=sys.stderr)
        return False
    print("self-test ok")
    return True


if __name__ == "__main__":
    raise SystemExit(main())
