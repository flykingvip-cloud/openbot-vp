#!/usr/bin/env python3
"""WeChat Official Account HTML gate for wechat-article.

Original MIT helper. Checks the platform red lines in
references/typeset-handoff.md. Not a theme engine.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

FORBIDDEN_TAGS = (
    r"<script\b",
    r"<iframe\b",
    r"<object\b",
    r"<embed\b",
    r"<form\b",
    r"<link\b",
    r"<style\b",
    r"<html\b",
    r"<head\b",
    r"<body\b",
)
FORBIDDEN_ATTRS = (r"\sclass\s*=", r"\sid\s*=")
FORBIDDEN_CSS = (
    r"position\s*:\s*(fixed|absolute|sticky)",
    r"display\s*:\s*grid",
    r"float\s*:",
    r"@media\b",
    r"@keyframes\b",
    r"var\s*\(",
)


def lint(html: str) -> list[str]:
    errors: list[str] = []
    for pattern in FORBIDDEN_TAGS:
        if re.search(pattern, html, flags=re.IGNORECASE):
            errors.append(f"forbidden tag: {pattern}")
    for pattern in FORBIDDEN_ATTRS:
        if re.search(pattern, html, flags=re.IGNORECASE):
            errors.append(f"forbidden attribute: {pattern}")
    for pattern in FORBIDDEN_CSS:
        if re.search(pattern, html, flags=re.IGNORECASE):
            errors.append(f"forbidden css: {pattern}")
    if "<span" not in html.lower():
        errors.append("text nodes should be wrapped in span")
    if 'style="' not in html and "style='" not in html:
        errors.append("expected inline style attributes")
    return errors


def self_test() -> int:
    good = (
        '<section style="max-width:677px;margin:0 auto;">'
        '<p style="font-size:16px;"><span>你好</span></p>'
        "</section>"
    )
    bad = '<div class="x" id="y"><script>1</script><p style="position:fixed">hi</p></div>'
    good_errors = lint(good)
    bad_errors = lint(bad)
    if good_errors:
        print("self-test failed: good fragment was rejected:", good_errors, file=sys.stderr)
        return 1
    if not bad_errors:
        print("self-test failed: bad fragment was accepted", file=sys.stderr)
        return 1
    print("self-test passed")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate WeChat article HTML fragment")
    parser.add_argument("html_path", nargs="?", help="path to HTML fragment")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if not args.html_path:
        parser.error("html_path is required unless --self-test")
    path = Path(args.html_path)
    html = path.read_text(encoding="utf-8")
    errors = lint(html)
    if errors:
        print(f"ERROR {len(errors)} in {path}", file=sys.stderr)
        for item in errors:
            print(f"- {item}", file=sys.stderr)
        return 1
    print(f"OK {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
