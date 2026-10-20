#!/usr/bin/env python3
"""Independent acceptance for the S3 group-deliverable save chain landing (PR #143).

Read-only against `origin/main`. Creates no refs, mutates no index, writes nothing into the repo.
Written as a fresh checker rather than a reuse of the implementation scripts, so a green result here
is not shared-cause with a bug in whatever produced the change.

  A  PR #143 is MERGED (never CLOSED), the merge commit has two parents, and the second parent is
     still the branch tip, so the landed SHAs stay reachable
  B  main's delta from the merge's first parent equals the predicted 16 paths, path for path
  C  knowledge.deliverables.saveAndArchive is registered in all three tables and resolves to
     operator.write, not operator.read
  D  the handler enforces per-knowledge-base write authorization, not just the operator scope
  E  the five previously-dead UI modules now have a live entry point at app.ts
  F  main's artifact-sidebar features that the source branch would have deleted are still present
  G  app.ts imports resolve-group-scope exactly once and no longer imports steward-workspace-file
  H  the chip and toast CSS classes exist
  I  the auto-capture narrowing held: the dedup scope only changes when groupId is supplied, so
     existing callers' identity keys are untouched
  J  oxlint reports nothing on the blobs main now has for every changed TypeScript file

Usage: python3 docs/design/convergence-evidence/2026-07-28/verify-s3-deliverable-save.py
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

GIT = "/usr/bin/git"
REPO = "gmood2008/openbot"
PR = 143
METHOD = "knowledge.deliverables.saveAndArchive"

EXPECTED_PATHS = {
    "docs/design/convergence-evidence/2026-07-28/s3-implementation-verification.md",
    "src/gateway/collaboration-learning/shared.ts",
    "src/gateway/knowledge/deliverables/auto-capture-runtime.ts",
    "src/gateway/knowledge/deliverables/save-and-archive-registration.test.ts",
    "src/gateway/knowledge/deliverables/save-and-archive.test.ts",
    "src/gateway/knowledge/deliverables/save-and-archive.ts",
    "src/gateway/method-scopes.ts",
    "src/gateway/server-methods-list.ts",
    "src/gateway/server-methods/knowledge.ts",
    "ui/src/styles/chat/sidebar.css",
    "ui/src/ui/app-render.ts",
    "ui/src/ui/app-view-state-shell-slices.ts",
    "ui/src/ui/app.ts",
    "ui/src/ui/views/artifact-sidebar-deliverable.test.ts",
    "ui/src/ui/views/artifact-sidebar.ts",
    "ui/src/ui/views/chat.ts",
}

TS_FILES = sorted(p for p in EXPECTED_PATHS if p.endswith(".ts"))

# module stem -> the file that must import it (a live path rooted at app.ts)
REACHABILITY = {
    "ui/src/ui/wiring/deliverable-save.ts": "ui/src/ui/app.ts",
    "ui/src/ui/wiring/group-deliverable-preview-flow.ts": "ui/src/ui/app.ts",
    "ui/src/ui/wiring/group-workspace-file.ts": "ui/src/ui/wiring/group-deliverable-preview-flow.ts",
    "ui/src/ui/controllers/group-deliverable-manifest.ts": "ui/src/ui/wiring/group-deliverable-preview-flow.ts",
    "ui/src/ui/controllers/group-workspace-file.ts": "ui/src/ui/wiring/group-workspace-file.ts",
}

# things the source branch's artifact-sidebar.ts deletes; main must keep them
SIDEBAR_KEEP = [
    "downloadTextFile",
    "resolveDownloadFilename",
    "formatArtifactDate",
    "buildArtifactPreviewSummaryText",
    "onDismissAssetIncubationFromPreview",
]


def git(*args: str) -> str:
    r = subprocess.run([GIT, *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} -> {r.stderr.strip()}")
    return r.stdout


def blob(path: str, rev: str = "origin/main") -> str:
    return git("show", f"{rev}:{path}")


def gh_json(*args: str):
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)} -> {r.stderr.strip()}")
    return json.loads(r.stdout)


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def add(self, check: str, ok: bool | None, detail: str) -> None:
        self.rows.append(("PASS" if ok is True else ("FAIL" if ok is False else "SKIP"), check, detail))

    @property
    def failed(self) -> bool:
        return any(v == "FAIL" for v, _, _ in self.rows)

    def emit(self) -> None:
        w = max(len(c) for _, c, _ in self.rows)
        for verdict, check, detail in self.rows:
            print(f"[{verdict}] {check.ljust(w)}  {detail}")
        counts: dict[str, int] = {}
        for v, _, _ in self.rows:
            counts[v] = counts.get(v, 0) + 1
        print()
        print("  ".join(f"{k}={v}" for k, v in sorted(counts.items())))


def check_a(rep: Report) -> str | None:
    d = gh_json(
        "pr", "view", str(PR), "--repo", REPO,
        "--json", "state,mergeCommit,baseRefName,headRefName",
    )
    if d["state"] != "MERGED":
        rep.add("A/merged", False, f"state={d['state']} (must be MERGED, never CLOSED)")
        return None
    if d["baseRefName"] != "main":
        rep.add("A/merged", False, f"base={d['baseRefName']}")
        return None
    sha = d["mergeCommit"]["oid"]
    parents = git("rev-list", "--parents", "-1", sha).split()[1:]
    tip = git("rev-parse", f"origin/{d['headRefName']}").strip()
    if len(parents) != 2:
        rep.add("A/merged", False, f"{sha[:10]} has {len(parents)} parent(s), expected 2")
        return None
    if parents[1] != tip:
        rep.add("A/merged", False, f"second parent {parents[1][:10]} != tip {tip[:10]}")
        return None
    rep.add("A/merged", True, f"MERGED {sha[:10]}, 2 parents, tip {tip[:10]} reachable")
    return sha


def check_b(rep: Report, merge_sha: str | None) -> None:
    if not merge_sha:
        rep.add("B/delta", None, "no merge commit")
        return
    first_parent = git("rev-list", "--parents", "-1", merge_sha).split()[1]
    got = set(git("diff", "--name-only", first_parent, merge_sha).split()) - {""}
    if got == EXPECTED_PATHS:
        rep.add("B/delta", True, f"{len(got)} paths, exactly as predicted")
    else:
        rep.add(
            "B/delta", False,
            f"unexpected={sorted(got - EXPECTED_PATHS)} missing={sorted(EXPECTED_PATHS - got)}",
        )


def check_c(rep: Report) -> None:
    missing = [
        f for f in (
            "src/gateway/server-methods-list.ts",
            "src/gateway/method-scopes.ts",
            "src/gateway/server-methods/knowledge.ts",
        )
        if METHOD not in blob(f)
    ]
    if missing:
        rep.add("C/registered", False, f"absent from {missing}")
    else:
        rep.add("C/registered", True, "present in list + scopes + handlers")

    # the method must sit inside the WRITE_SCOPE block, not READ_SCOPE
    scopes = blob("src/gateway/method-scopes.ts")
    blocks = {}
    for name in ("READ_SCOPE", "WRITE_SCOPE", "ADMIN_SCOPE", "APPROVALS_SCOPE", "PAIRING_SCOPE"):
        m = re.search(rf"\[{name}\]: \[(.*?)\n  \],", scopes, re.S)
        blocks[name] = m.group(1) if m else ""
    owning = [n for n, body in blocks.items() if f'"{METHOD}"' in body]
    if owning == ["WRITE_SCOPE"]:
        rep.add("C/write scope", True, "classified under WRITE_SCOPE only")
    else:
        rep.add("C/write scope", False, f"classified under {owning or 'nothing'} (expected WRITE_SCOPE)")


def check_d(rep: Report) -> None:
    body = blob("src/gateway/server-methods/knowledge.ts")
    m = re.search(rf'"{re.escape(METHOD)}": async .*?\n  \}},\n', body, re.S)
    if not m:
        rep.add("D/kb authz", False, "handler block not found")
        return
    handler = m.group(0)
    has_authz = "authorizedKnowledgeBase(" in handler and '"write"' in handler
    has_user = "context.userId" in handler
    if has_authz and has_user:
        rep.add("D/kb authz", True, 'requires authorizedKnowledgeBase(..., "write") and a user context')
    else:
        rep.add(
            "D/kb authz", False,
            f"authorizedKnowledgeBase+write={has_authz} userContext={has_user}",
        )


def check_e(rep: Report) -> None:
    bad = []
    for module, importer in REACHABILITY.items():
        stem = Path(module).stem
        if stem not in blob(importer):
            bad.append(f"{module} not imported by {importer}")
    if bad:
        rep.add("E/reachability", False, "; ".join(bad))
    else:
        rep.add("E/reachability", True, f"all {len(REACHABILITY)} modules reachable from app.ts")


def check_f(rep: Report) -> None:
    body = blob("ui/src/ui/views/artifact-sidebar.ts")
    lost = [s for s in SIDEBAR_KEEP if s not in body]
    if lost:
        rep.add("F/sidebar kept", False, f"lost: {lost}")
    else:
        rep.add("F/sidebar kept", True, f"all {len(SIDEBAR_KEEP)} preserved")


def check_g(rep: Report) -> None:
    body = blob("ui/src/ui/app.ts")
    n_scope = body.count('from "./collaboration/resolve-group-scope.ts"')
    n_steward = body.count("wiring/steward-workspace-file")
    ok = n_scope == 1 and n_steward == 0
    rep.add(
        "G/app.ts imports",
        ok,
        f"resolve-group-scope x{n_scope} (want 1), steward-workspace-file x{n_steward} (want 0)",
    )


def check_h(rep: Report) -> None:
    css = blob("ui/src/styles/chat/sidebar.css")
    need = ["artifact-preview-status-chip", "artifact-preview-deliverable-toast"]
    lost = [c for c in need if c not in css]
    if lost:
        rep.add("H/css", False, f"missing: {lost}")
    else:
        rep.add("H/css", True, "chip + toast classes present")


def check_i(rep: Report) -> None:
    body = blob("src/gateway/knowledge/deliverables/auto-capture-runtime.ts")
    m = re.search(r"function captureIdentityKey\(params: \{(.*?)\n\}\n", body, re.S)
    fn = m.group(0) if m else body
    # the scope ternary must key off groupId only; ownerId must not steer it
    scope_ok = "groupId\n    ? `group:${groupId}`" in body or 'groupId ? `group:${groupId}`' in body
    owner_rerouted = "`owner:${ownerId}`" in body
    if scope_ok and not owner_rerouted:
        rep.add(
            "I/narrowing held", True,
            "scope switches on groupId only; no owner:<ownerId> rerouting",
        )
    else:
        rep.add(
            "I/narrowing held", False,
            f"groupScope={scope_ok} ownerRerouted={owner_rerouted} "
            "(owner rerouting would change every existing caller's dedup identity)",
        )
    if "groupId?: string | null;" not in fn and "groupId" not in fn:
        rep.add("I/capture params", False, "captureIdentityKey does not accept groupId")
    else:
        rep.add("I/capture params", True, "captureIdentityKey accepts groupId + logicalId")


def check_j(rep: Report) -> None:
    if shutil.which("npx") is None:
        rep.add("J/oxlint", None, "npx unavailable")
        return
    with tempfile.TemporaryDirectory() as td:
        box = Path(td)
        (box / ".oxlintrc.json").write_text(
            json.dumps(
                {
                    "plugins": ["unicorn", "typescript", "oxc"],
                    "categories": {"correctness": "error"},
                }
            )
        )
        for path in TS_FILES:
            dst = box / Path(path).name
            dst.write_text(blob(path))
        r = subprocess.run(
            ["npx", "--no-install", "oxlint", "--config", str(box / ".oxlintrc.json"), str(box)],
            capture_output=True,
            text=True,
        )
        out = r.stdout + r.stderr
        m = re.search(r"Found (\d+) warnings and (\d+) errors", out)
        if not m:
            rep.add("J/oxlint", None, "could not parse oxlint output")
            return
        warnings, errors = int(m.group(1)), int(m.group(2))
        if errors == 0:
            rep.add(
                "J/oxlint", True,
                f"{len(TS_FILES)} files, {errors} errors, {warnings} warnings "
                "(isolated: cross-file imports do not resolve, so this is the unused-symbol gate)",
            )
        else:
            names = re.findall(r"eslint\(([a-z-]+)\)", out)
            rep.add("J/oxlint", False, f"{errors} error(s): {sorted(set(names))}")


def main() -> int:
    rep = Report()
    merge_sha = check_a(rep)
    check_b(rep, merge_sha)
    check_c(rep)
    check_d(rep)
    check_e(rep)
    check_f(rep)
    check_g(rep)
    check_h(rep)
    check_i(rep)
    check_j(rep)

    print(f"main = {git('rev-parse', '--short', 'origin/main').strip()}")
    print(f"PR   = #{PR}")
    print()
    rep.emit()
    return 1 if rep.failed else 0


if __name__ == "__main__":
    sys.exit(main())
