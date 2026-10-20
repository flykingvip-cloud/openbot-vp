#!/usr/bin/env python3
"""Emit one task-instruction document per vendor bucket, with verbatim tsgo errors."""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

RUN_ID = "30333105158"
MAIN_SHA = "cc1bf25d38"

# file -> vendor, and file -> attribution note, from the published bucket report
vendor_of: dict[str, str] = {}
note_of: dict[str, str] = {}
count_of: dict[str, int] = {}
vendor = None
for line in Path("/tmp/tsdebt-report.txt").read_text().splitlines():
    m = re.match(r"^## (\w+)", line)
    if m:
        vendor = m.group(1)
        continue
    m = re.match(r"^\s+(\d+)\s+(\S+)\s+\[([^\]]+)\]", line)
    if m and vendor in ("kiro", "cursor", "codex"):
        count_of[m.group(2)] = int(m.group(1))
        vendor_of[m.group(2)] = vendor
        note_of[m.group(2)] = m.group(3)

# file -> verbatim error lines
errors: dict[str, list[str]] = defaultdict(list)
for line in Path("/tmp/main-gate.txt").read_text(errors="replace").splitlines():
    m = re.search(r"##\[error\](\S+?)\((\d+),(\d+)\): (error TS\d+: .*)$", line)
    if not m:
        continue
    path = m.group(1)
    if path not in vendor_of:
        continue
    errors[path].append(f"{path}({m.group(2)},{m.group(3)}): {m.group(4)}")

BUCKET_LEAD = {
    "codex": """### Start here: one edit clears 23 of your 59 errors

`ui/src/ui/app-view-state-shell-slices.ts` accounts for 23 errors and they are **a single defect**.
Nine `enterprise-operational-identity` members are declared twice inside the same interface, at
roughly lines 1006-1063 and again 1107-1120. That is 18 `TS2300` duplicate-identifier plus 5 `TS2717`
redeclaration. The shape is a merge that applied the same hunk twice.

Delete the **second** block, keep the first, and confirm the two declarations were identical before
deleting - if they diverged, the newer field types have to be reconciled rather than dropped.

**This file is under active edit in the shared worktree.** Coordinate before touching it; do not land
a drive-by fix on top of someone's WIP.

After that, 8 of your remaining errors are `TS7006` (parameter implicitly `any`), which are
annotation work, not redesign.""",
    "cursor": """### Expect this to be the slowest bucket

31 files, 69 errors, **no cluster**. There is no single high-leverage edit here: the debt is
assignability and property-existence drift spread across enterprise-data, knowledge sources, billing
and operational identity. Budget per-file, not per-cluster.

Largest single file is `src/gateway/server-methods/enterprise-data-m1.ts` at 9 errors; next is
`src/conversations/conversation-lifecycle.archive-cw-retry.test.ts` at 8.

**Nine of your files are low-confidence attributions** (marked `branch?:` below). They resolved via
`cursor-main-recovery/fold-forward-tier2`, a fold-forward branch that re-lands other agents' work, so
the vendor there is the lander and not necessarily the author. If you open one and it is clearly not
cursor's code, say so in the tracking issue and hand it back rather than guessing.""",
    "kiro": """### Your debt is concentrated in one surface

18 of your 22 errors sit in four files on the knowledge-space-import surface. Five of them are
`TS2678` ("case type not comparable to switch type") plus two `TS2551` and one `TS2367`, which
together read as **a union type that lost members**: `SpaceImportKind` and/or
`KnowledgeUniversePageTab` no longer contain values the switch statements and comparisons still use.

Check that first. If the union is the root cause, fixing the type definition may clear most of the
four files at once. If the union is correct and the call sites are stale, the call sites move instead
- decide which side is right rather than casting to make the error disappear.

Two `TS2307` "cannot find module" also appear in your set; confirm they are not build-output paths
before treating them as missing source.""",
}


def render(vendor: str) -> str:
    files = sorted(
        [f for f, v in vendor_of.items() if v == vendor],
        key=lambda f: (-count_of[f], f),
    )
    total = sum(count_of[f] for f in files)
    out: list[str] = []
    a = out.append

    a(f"# Task: clear the {vendor} share of trunk type debt")
    a("")
    a(f"**Scope:** {len(files)} files, {total} `tsgo` errors on `origin/main`.")
    a(f"**Source of truth:** CI Gate run `{RUN_ID}`, job `check (types, lint, format)`, step `pnpm tsgo`, at `{MAIN_SHA}`.")
    a("**Full picture:** `docs/design/convergence-evidence/2026-07-27/tsgo-debt-buckets.md`")
    a("")
    a("## Why this matters now")
    a("")
    a("`pnpm check` is a serial chain of 20 gates. `tsgo` is gate 4, so **`lint` and the 16 lint gates behind")
    a("it have still never run on this trunk.** Every error in your bucket is blocking that, and blocking the")
    a("moment `check` can become a required status check.")
    a("")
    a("These errors are not new carelessness. The repository had **zero completed CI runs for about two")
    a("months** because 30 of its 34 job definitions target a runner provider it never subscribed to. The gate")
    a("that should have caught these at commit time did not exist in practice. No blame attaches; the work")
    a("still has to be done.")
    a("")
    a(BUCKET_LEAD[vendor])
    a("")
    a("## Rules")
    a("")
    a("1. **Fix root causes.** `@ts-nocheck` is forbidden. Do not disable `no-explicit-any`. Do not introduce")
    a("   `any`, and do not silence an error with a cast unless you can state why the cast is sound.")
    a("2. **Stay in your bucket.** If the root cause lives in a file belonging to another bucket, do **not**")
    a("   edit it. Record the cross-bucket dependency in the tracking issue and stop at your boundary.")
    a("3. **Work in an isolated worktree**, branched from `main`. Do not work in the shared main worktree - it")
    a("   currently carries ~200 dirty paths from other agents.")
    a("4. **Sign in before working:** `pnpm loom register --task <spec>:<owner> --owner <you> --session-id")
    a("   $(uuidgen) --ide <ide> --agent <you>`, with `paths:` covering the files you will touch.")
    a("5. **Sign every commit** with `Task:` and `Agent:` trailers. Commit with")
    a("   `scripts/committer \"<msg>\" <file...>`; never `git add .`.")
    a("6. **One PR against `main`.** `main` accepts changes only through a pull request - direct pushes return")
    a("   `GH013` and the `POST /merges` API returns `409`.")
    a("7. **Run `pnpm format:fix` before committing.** The trunk was just brought to a clean `oxfmt` state; do")
    a("   not reintroduce drift.")
    a("8. **No behaviour changes.** This is a type-correctness task. If a fix requires changing runtime")
    a("   behaviour, that is a separate PR with its own justification.")
    a("")
    a("## Reproduce locally")
    a("")
    a("```bash")
    a("pnpm build:collaboration:packages   # required first: skipping it invents 64 phantom TS2307 errors")
    a("pnpm tsgo 2>&1 | tee /tmp/tsgo.txt")
    a("```")
    a("")
    a("## Definition of done")
    a("")
    a("Your bucket's files produce **zero** `tsgo` errors. `pnpm check` may still fail on the other buckets;")
    a("that is expected and is not your gate.")
    a("")
    a(f"Save this list as `/tmp/{vendor}-files.txt`:")
    a("")
    a("```")
    for f in files:
        a(f)
    a("```")
    a("")
    a("Then:")
    a("")
    a("```bash")
    a("pnpm build:collaboration:packages && pnpm tsgo 2>&1 \\")
    a(f"  | grep -F -f /tmp/{vendor}-files.txt \\")
    a("  | grep -c 'error TS'   # must print 0")
    a("```")
    a("")
    a("Also required before opening the PR:")
    a("")
    a("- `pnpm format:check` clean")
    a("- tests covering the files you changed pass (`pnpm vitest run <paths>`; use")
    a("  `OPENBOT_TEST_PROFILE=low` if memory-constrained)")
    a("- the error count for the **other** buckets has not increased")
    a("")
    a("## Your files")
    a("")
    a("| errors | file | attribution |")
    a("| --- | --- | --- |")
    for f in files:
        a(f"| {count_of[f]} | `{f}` | `{note_of[f]}` |")
    a("")
    if any("branch?" in note_of[f] for f in files):
        a("Entries marked `branch?:` are **low-confidence** attributions: they resolved through a fold-forward")
        a("branch, which re-lands other agents' work, so the vendor is the lander rather than the author. If one")
        a("is clearly not yours, hand it back instead of guessing.")
        a("")
    a("## Errors, verbatim")
    a("")
    for f in files:
        a(f"### `{f}` - {count_of[f]}")
        a("")
        a("```")
        for e in errors[f]:
            a(e)
        a("```")
        a("")
    return "\n".join(out)


for v in ("codex", "cursor", "kiro"):
    text = render(v)
    Path(f"/tmp/task-{v}.md").write_text(text, encoding="utf-8")
    n_files = sum(1 for f, vv in vendor_of.items() if vv == v)
    n_err = sum(len(errors[f]) for f, vv in vendor_of.items() if vv == v)
    print(f"{v}: files={n_files} verbatim_errors={n_err} bytes={len(text)}")
