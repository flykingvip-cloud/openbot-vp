#!/usr/bin/env python3
"""Validate the web-extract-html-pdf skill package and its delivery contract.

Zero third-party dependencies. Exits 0 with {"ok": true} when the package passes.
"""

import argparse
import json
import re
from pathlib import Path

REQUIRED = [
    "SKILL.md",
    "manifest.json",
    "scripts/render.js",
    "references/environment.md",
    "references/pipeline.md",
    "references/pitfalls.md",
    "evals/trigger_cases.json",
]

ALLOWED_FRONTMATTER = {
    "name", "description", "version", "license", "metadata",
}

# Terms the SKILL.md body must keep (contract surface).
SKILL_CONTRACT = [
    "web_fetch",
    "pdftotext",
    "Chrome",
    "--print-to-pdf",
    "Noto Sans CJK SC",
    "output/pdf/",
    "不臆造",
    "LibreOffice",
    "pagebreak",
    "lineChart",
]

SKILL_NAME = "web-extract-html-pdf"

# Patterns that indicate a credential leaked into the package.
SECRET_PATTERNS = [
    re.compile(r"""(?:password|passwd|pwd|secret|token|api[_-]?key|otp)\s*[:=]\s*['"][^'"]{3,}['"]""", re.I),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
]


def parse_frontmatter(text: str):
    if not text.startswith("---\n"):
        return None, None, "SKILL.md missing leading frontmatter fence"
    end = text.find("\n---\n", 4)
    if end == -1:
        return None, None, "SKILL.md frontmatter not closed"
    block = text[4:end]
    keys = []
    for line in block.splitlines():
        if not line.strip() or line.startswith((" ", "\t", "#")):
            continue
        m = re.match(r"^([A-Za-z0-9_.-]+)\s*:", line)
        if m:
            keys.append(m.group(1))
    return keys, block, None


def scalar(block: str, key: str):
    """Return the scalar value of a top-level key (supports folded block scalars)."""
    lines = block.splitlines()
    for i, line in enumerate(lines):
        m = re.match(rf"^{key}:\s*(.*)$", line)
        if not m:
            continue
        value = m.group(1).strip()
        if value in (">-", ">", "|", "|-", ""):
            rest = []
            for nxt in lines[i + 1:]:
                if nxt[:1] not in (" ", "\t"):
                    break
                rest.append(nxt.strip())
            return " ".join(rest).strip()
        return value.strip("'\"")
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill_dir", nargs="?", default=".")
    args = parser.parse_args()
    root = Path(args.skill_dir).resolve()
    failures = []

    for rel in REQUIRED:
        if not (root / rel).is_file():
            failures.append(f"missing: {rel}")

    skill_path = root / "SKILL.md"
    skill = skill_path.read_text(encoding="utf-8") if skill_path.exists() else ""

    # --- frontmatter -----------------------------------------------------
    keys, block, err = parse_frontmatter(skill)
    if err:
        failures.append(err)
    else:
        if "name" not in keys or "description" not in keys:
            failures.append("frontmatter must define name and description")
        extra = [k for k in keys if k not in ALLOWED_FRONTMATTER]
        if extra:
            failures.append(f"non-standard frontmatter keys: {extra}")
        if scalar(block, "name") != SKILL_NAME:
            failures.append(f"frontmatter name must be {SKILL_NAME}")
        desc = scalar(block, "description") or ""
        if len(desc) < 40:
            failures.append(f"description too short ({len(desc)} chars)")

    # --- contract terms --------------------------------------------------
    for term in SKILL_CONTRACT:
        if term not in skill:
            failures.append(f"SKILL.md missing contract term: {term}")

    # --- referenced files resolve ---------------------------------------
    for ref in re.findall(r"`(references/[^`]+\.md)`", skill):
        if not (root / ref).is_file():
            failures.append(f"SKILL.md references missing file: {ref}")

    # --- secret scan over the whole package ------------------------------
    for path in root.rglob("*"):
        if not path.is_file() or "__pycache__" in path.parts:
            continue
        if path.suffix in {".png", ".jpg", ".jpeg", ".pdf"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for pat in SECRET_PATTERNS:
            if pat.search(text):
                failures.append(f"possible credential in {path.relative_to(root)}: {pat.pattern}")

    # --- manifest identity + trigger cases -------------------------------
    manifest = {}
    if (root / "manifest.json").is_file():
        try:
            manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            failures.append(f"manifest.json invalid JSON: {exc}")
    if manifest.get("id") != SKILL_NAME:
        failures.append("manifest id mismatch")
    if manifest.get("version") != "1.0.0":
        failures.append("manifest version mismatch")

    cases = {}
    if (root / "evals/trigger_cases.json").is_file():
        try:
            cases = json.loads((root / "evals/trigger_cases.json").read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            failures.append(f"trigger_cases.json invalid JSON: {exc}")
    if len(cases.get("should_trigger", [])) < 5:
        failures.append("need at least 5 should_trigger cases")
    if len(cases.get("should_not_trigger", [])) < 5:
        failures.append("need at least 5 should_not_trigger cases")

    # --- generated artifacts ---------------------------------------------
    junk = [
        str(p.relative_to(root))
        for p in root.rglob("*")
        if p.is_file() and p.suffix in {".pyc", ".part", ".tmp"}
    ]
    if junk:
        failures.append(f"generated artifacts present: {junk}")

    print(json.dumps({"ok": not failures, "root": str(root), "failures": failures},
                     ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
