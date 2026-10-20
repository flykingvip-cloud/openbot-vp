#!/usr/bin/env python3
"""Bucket the tsgo debt files into kiro / cursor / codex.

Two signals, in priority order:
  1. loom registry `paths:` globs -> owner id -> vendor prefix
  2. the branch name of the merge commit that last brought the file's state in

Deliberately coarse: the request is vendor-level buckets, not individual owners.
"""

from __future__ import annotations

import fnmatch
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

REPO = "/Users/daniel/AI项目/openbot"
VENDORS = ("kiro", "cursor", "codex")


def vendor_of(name: str) -> str | None:
    low = name.lower()
    for v in VENDORS:
        if low.startswith(v) or f"/{v}" in low or f"-{v}" in low:
            return v
    return None


def load_registry_claims() -> list[tuple[str, str]]:
    """Return (glob, owner) pairs from .loom/registry.yaml, parsed line-wise.

    The registry is large YAML; a full parse is unnecessary for path->owner and would
    add a dependency. Structure is stable: `- id:` / `owner:` / `paths:` / `- <glob>`.
    """
    claims: list[tuple[str, str]] = []
    owner = None
    in_paths = False
    text = Path(REPO, ".loom/registry.yaml").read_text(encoding="utf-8")
    for raw in text.splitlines():
        if re.match(r"^  - id: ", raw):
            owner, in_paths = None, False
            continue
        m = re.match(r"^    owner: (\S+)", raw)
        if m:
            owner = m.group(1)
            continue
        if re.match(r"^    paths:", raw):
            in_paths = True
            continue
        if re.match(r"^    \w+:", raw):
            in_paths = False
            continue
        m = re.match(r"^      - (\S+)", raw)
        if m and in_paths and owner:
            claims.append((m.group(1), owner))
    return claims


def registry_vendor(path: str, claims: list[tuple[str, str]]) -> tuple[str, str] | None:
    for glob, owner in claims:
        pat = glob.rstrip("/")
        hit = (
            fnmatch.fnmatch(path, pat)
            or fnmatch.fnmatch(path, pat + "/*")
            or path.startswith(pat + "/")
            or (pat.endswith("**") and path.startswith(pat[:-2]))
        )
        if hit:
            v = vendor_of(owner)
            if v:
                return v, owner
    return None


def git(args: list[str]) -> str:
    return subprocess.run(
        ["git", "-C", REPO, *args], capture_output=True, text=True
    ).stdout.strip()


BRANCH_RE = re.compile(r"Merge pull request #\d+ from [^/]+/(\S+)")


def history_vendor(path: str) -> tuple[str, str] | None:
    """Walk recent commits touching the file; take the first vendor signal found.

    Signals: an `Agent:` trailer, or the branch name in an enclosing merge commit
    subject. Git author is a single shared identity here, so it carries no signal.
    """
    shas = git(["log", "--format=%H", "-n", "12", "origin/main", "--", path]).splitlines()
    for sha in shas:
        body = git(["log", "-1", "--format=%B", sha])
        subject = body.splitlines()[0] if body else ""
        # A formatting sweep touches hundreds of files it did not author. Reading its
        # trailer would credit every one of them to whoever ran oxfmt. Same for this
        # governance task, which wrote no product code at all.
        if subject.startswith("Format:") or "Agent: kiro-baseline-governance" in body:
            continue
        m = re.search(r"^Agent: (\S+)", body, re.M)
        if m:
            v = vendor_of(m.group(1))
            if v:
                return v, f"trailer:{m.group(1)}"
        # merge commits that contain this commit and name a branch
        for line in git(
            ["log", "--merges", "--format=%s", "-n", "40", f"{sha}..origin/main"]
        ).splitlines():
            bm = BRANCH_RE.search(line)
            if bm:
                branch = bm.group(1)
                v = vendor_of(branch)
                if v:
                    # Fold-forward, rescue and replay branches re-land other agents'
                    # work, so the branch vendor is the lander, not the author.
                    weak = any(
                        k in branch
                        for k in ("fold-forward", "rescue", "recovery", "replay", "consolidation")
                    )
                    return v, ("branch?:" if weak else "branch:") + branch
    return None


def main() -> int:
    rows: list[tuple[int, str]] = []
    for line in Path("/tmp/tsdebt-files.txt").read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        count, path = line.split(None, 1)
        rows.append((int(count), path))

    claims = load_registry_claims()
    print(f"registry path claims parsed: {len(claims)}", file=sys.stderr)

    buckets: dict[str, list[tuple[int, str, str]]] = defaultdict(list)
    for count, path in rows:
        hit = registry_vendor(path, claims)
        if hit:
            buckets[hit[0]].append((count, path, f"loom:{hit[1]}"))
            continue
        hit = history_vendor(path)
        if hit:
            buckets[hit[0]].append((count, path, hit[1]))
            continue
        buckets["unattributed"].append((count, path, "-"))

    for vendor in (*VENDORS, "unattributed"):
        items = sorted(buckets.get(vendor, []), reverse=True)
        errs = sum(i[0] for i in items)
        print(f"\n## {vendor}  files={len(items)} errors={errs}")
        for count, path, why in items:
            print(f"  {count:>3}  {path}  [{why}]")

    total_files = sum(len(v) for v in buckets.values())
    total_errs = sum(i[0] for v in buckets.values() for i in v)
    print(f"\ntotal files={total_files} errors={total_errs}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
