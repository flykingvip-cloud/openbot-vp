#!/usr/bin/env python3
"""Local WeChat-safe HTML wrap for wechat-article.

Produces a compliant body fragment from Markdown or plain text.
This is a fallback typesetter, not a theme library.
"""

from __future__ import annotations

import argparse
import html
import re
import sys
from pathlib import Path

SECTION = (
    "max-width:677px;margin:0 auto;padding:0;"
    "font-size:16px;color:#333333;line-height:1.75;background:#ffffff;"
)
HEADING = "margin:1.4em 0 0.7em;font-weight:600;color:#111111;line-height:1.4;"
PARAGRAPH = "margin:0.85em 0;font-size:16px;color:#333333;line-height:1.75;"
QUOTE = (
    "margin:1em 0;padding:0.6em 0 0.6em 0.9em;"
    "border-left:3px solid #d1d5db;color:#4b5563;"
)
LIST = "margin:0.6em 0 0.6em 1.2em;padding:0;"
ITEM = "margin:0.35em 0;font-size:16px;line-height:1.75;"
IMAGE = "max-width:100%;height:auto;display:block;margin:0.8em auto;"


def escape_text(text: str) -> str:
    return html.escape(text, quote=False)


def span(text: str) -> str:
    return f"<span>{escape_text(text)}</span>"


def inline_md(text: str) -> str:
    parts: list[str] = []
    cursor = 0
    pattern = re.compile(r"\*\*(.+?)\*\*|`([^`]+)`|!\[([^\]]*)\]\(([^)]+)\)")
    for match in pattern.finditer(text):
        if match.start() > cursor:
            parts.append(span(text[cursor : match.start()]))
        if match.group(1) is not None:
            parts.append(f"<strong>{span(match.group(1))}</strong>")
        elif match.group(2) is not None:
            parts.append(
                '<code style="font-size:14px;background:#f3f4f6;padding:0 0.25em;">'
                f"{span(match.group(2))}</code>"
            )
        else:
            alt = match.group(3) or ""
            url = match.group(4) or ""
            parts.append(f'<img src="{html.escape(url, quote=True)}" alt="{html.escape(alt, quote=True)}" style="{IMAGE}" />')
        cursor = match.end()
    if cursor < len(text):
        parts.append(span(text[cursor:]))
    return "".join(parts) if parts else span(text)


def wrap_markdown(source: str) -> str:
    blocks: list[str] = []
    paragraph: list[str] = []
    list_kind: str | None = None
    in_code = False
    code_lines: list[str] = []

    def close_paragraph() -> None:
        nonlocal paragraph
        if paragraph:
            text = " ".join(paragraph).strip()
            blocks.append(f'<p style="{PARAGRAPH}">{inline_md(text)}</p>')
            paragraph = []

    def close_list() -> None:
        nonlocal list_kind
        if list_kind:
            blocks.append(f"</{list_kind}>")
            list_kind = None

    def open_list(kind: str) -> None:
        nonlocal list_kind
        if list_kind != kind:
            close_list()
            blocks.append(f'<{kind} style="{LIST}">')
            list_kind = kind

    for raw in source.splitlines():
        line = raw.rstrip()
        if line.strip().startswith("```"):
            if in_code:
                body = "<br />".join(span(item) if item else "<span></span>" for item in code_lines)
                blocks.append(
                    '<pre style="margin:1em 0;padding:0.8em 1em;background:#111827;'
                    f'color:#f9fafb;font-size:13px;line-height:1.6;overflow:auto;">{body}</pre>'
                )
                code_lines = []
                in_code = False
            else:
                close_paragraph()
                close_list()
                in_code = True
            continue
        if in_code:
            code_lines.append(line)
            continue
        if not line.strip():
            close_paragraph()
            close_list()
            continue
        heading = re.match(r"^(#{1,3})\s+(.*)$", line)
        if heading:
            close_paragraph()
            close_list()
            level = min(len(heading.group(1)) + 1, 4)
            size = {2: "22px", 3: "18px", 4: "16px"}[level]
            blocks.append(
                f'<h{level} style="{HEADING}font-size:{size};">{inline_md(heading.group(2).strip())}</h{level}>'
            )
            continue
        unordered = re.match(r"^[-*]\s+(.*)$", line)
        if unordered:
            close_paragraph()
            open_list("ul")
            blocks.append(f'<li style="{ITEM}">{inline_md(unordered.group(1).strip())}</li>')
            continue
        ordered = re.match(r"^\d+[.)]\s+(.*)$", line)
        if ordered:
            close_paragraph()
            open_list("ol")
            blocks.append(f'<li style="{ITEM}">{inline_md(ordered.group(1).strip())}</li>')
            continue
        quote = re.match(r"^>\s?(.*)$", line)
        if quote:
            close_paragraph()
            close_list()
            blocks.append(f'<blockquote style="{QUOTE}"><p style="{PARAGRAPH}">{inline_md(quote.group(1).strip())}</p></blockquote>')
            continue
        close_list()
        paragraph.append(line.strip())

    close_paragraph()
    close_list()
    if in_code:
        body = "<br />".join(span(item) if item else "<span></span>" for item in code_lines)
        blocks.append(
            f'<pre style="margin:1em 0;padding:0.8em 1em;background:#111827;color:#f9fafb;">{body}</pre>'
        )
    inner = "\n".join(blocks)
    return f'<section style="{SECTION}">\n{inner}\n</section>\n'


def wrap_existing_html(source: str) -> str:
    stripped = source.strip()
    if re.search(r"<html\b|<body\b", stripped, flags=re.IGNORECASE):
        match = re.search(r"<body\b[^>]*>(.*)</body>", stripped, flags=re.IGNORECASE | re.DOTALL)
        stripped = match.group(1).strip() if match else stripped
    if 'style="' not in stripped and "style='" not in stripped:
        stripped = f'<section style="{SECTION}">\n{stripped}\n</section>'
    return stripped if stripped.endswith("\n") else stripped + "\n"


def convert(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    suffix = path.suffix.lower()
    if suffix in {".html", ".htm"}:
        return wrap_existing_html(text)
    return wrap_markdown(text)


def self_test() -> int:
    html_out = wrap_markdown("# 标题\n\n这是**重点**。\n\n- 一项\n")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from validate_wechat_html import lint

    errors = lint(html_out)
    if errors:
        print("self-test failed:", errors, file=sys.stderr)
        return 1
    if "<h2" not in html_out or "<strong>" not in html_out:
        print("self-test failed: missing heading or bold", file=sys.stderr)
        return 1
    print("self-test passed")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Wrap Markdown as WeChat-safe HTML")
    parser.add_argument("source", nargs="?", help="markdown, text, or html path")
    parser.add_argument("-o", "--output", help="output html path")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if not args.source:
        parser.error("source is required unless --self-test")
    source = Path(args.source)
    html_out = convert(source)
    if args.output:
        out = Path(args.output)
        out.write_text(html_out, encoding="utf-8")
        print(str(out))
    else:
        sys.stdout.write(html_out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
