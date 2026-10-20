#!/usr/bin/env python3
"""Independent acceptance for the 7-layer replay stack landing on `main` (2026-07-28).

Read-only. Creates no refs and mutates no index. Written as a fresh checker rather than a reuse of
the replay tooling, so a failure here is not shared-cause with a bug in the tools that produced the
merges.

Checks
  A. every replay PR is MERGED (not CLOSED), each merge commit has two parents, and the replay tip is
     the second parent (so the recorded landing SHAs stay reachable)
  B. main's cumulative delta equals the union of the per-PR predictions
  C. no Import IA regression: main still exposes the sync-method selector, the Vault form, the
     local_index/managed_push radios, the watcher checkbox, and the create-space guard + its test
  D. the gap this stack was supposed to close is actually closed: system-authorization.ts now has
     importers other than its own test
  E. server-side rulesets are still active and the backup refs still resolve
  F. the replay branches are still reachable and are ancestors of main

Usage: python3 docs/design/convergence-evidence/2026-07-28/verify-phase2-landing.py [--json]
"""

from __future__ import annotations

import json
import subprocess
import sys

GIT = "/usr/bin/git"
REPO = "gmood2008/openbot"

# pr -> (branch, expected paths touched on main by that merge)
LANDINGS: list[tuple[int, str, set[str]]] = [
    (
        109,
        "replay/b3-b4-import-ia-and-convergence-ledger",
        {
            "deploy/production/BASELINE_RECOVERY_20260725.md",
            "docs/design/convergence-evidence/2026-07-28/b3-b4-main-reconciliation.md",
            "ui/src/ui/app-view-state-shell-slices.ts",
            "ui/src/ui/app.ts",
            "ui/src/ui/ports/employee/render-model.node.test.ts",
            "ui/src/ui/ports/employee/render-model.ts",
            "ui/src/ui/ports/employee/views/workbench-stage-contracts.ts",
            "ui/src/ui/ports/employee/views/workbench-stage-module.ts",
            "ui/src/ui/ports/employee/views/workbench-stage.node.test.ts",
            "ui/src/ui/ports/employee/views/workbench-types.ts",
            "ui/src/ui/ports/employee/views/workbench.ts",
        },
    ),
    (
        113,
        "replay/b5-nginx-hsts-https-redirect",
        {
            "deploy/production/BASELINE_RECOVERY_20260725.md",
            "deploy/production/proxy/nginx/admin.openbot.love.conf",
            "deploy/production/proxy/nginx/apex.openbot.love.conf",
            "deploy/production/proxy/nginx/biz.openbot.love.conf",
            "deploy/production/proxy/nginx/gw.openbot.love.conf",
            "docs/design/nginx-hsts-https-redirect-change-window-2026-07-20.md",
        },
    ),
    (
        117,
        "replay/b8-enterprise-channels",
        {
            "deploy/production/BASELINE_RECOVERY_20260725.md",
            "deploy/production/proxy/nginx/apex.openbot.love.conf",
            "src/config/redact-snapshot.test.ts",
            "src/config/redact-snapshot.ts",
            "ui/src/styles/components.css",
            "ui/src/ui/ports/enterprise/views/enterprise-message-channels-surface.browser.test.ts",
        },
    ),
    (
        119,
        "replay/b7-deliverable-preview-partial",
        {
            ".loom/registry.yaml",
            "deploy/production/BASELINE_RECOVERY_20260725.md",
            "ui/src/ui/app.ts",
            "ui/src/ui/views/artifact-sidebar.ts",
        },
    ),
    (
        127,
        "replay/b7-subset-security",
        {
            "deploy/production/BASELINE_RECOVERY_20260725.md",
            "src/auto-reply/reply/agent-runner-execution.ts",
            "src/gateway/server-methods/config.ts",
            "src/gateway/server-methods/cross-tenant-task-memory.test.ts",
            "src/gateway/server-methods/nodes.ts",
            "src/gateway/server-methods/rpc-tenant-scope.test.ts",
            "src/gateway/server-methods/sessions.ts",
            "src/memory/query-atoms-acl.test.ts",
        },
    ),
    (
        131,
        "replay/b7-subset-retention-and-export",
        {
            "deploy/production/BASELINE_RECOVERY_20260725.md",
            "src/conversations/conversation-export.test.ts",
            "src/conversations/conversation-export.ts",
            "src/conversations/retention-policy.ts",
            "src/conversations/tenant-retention-config.ts",
            "src/gateway/method-scopes.ts",
            "src/gateway/server-methods-list.ts",
            "src/gateway/server-methods/conversations.ts",
            "src/gateway/server-methods/enterprise-memory-governance.ts",
        },
    ),
]

# The pre-stack tip of main, i.e. main immediately after PR #106 landed.
MAIN_BEFORE_STACK = "812c6ec49eb10c7db7d60692afa71e7c801cd3b6"
# The tip right after #131 landed. Pinned on purpose: this checker makes a statement about the stack,
# so it must not go red when unrelated commits land on main afterwards. It only requires that this
# commit is still an ancestor of main.
STACK_HEAD = "24a966b62194c5e206729ad0a3b3eb63c6e34d1b"

# Import IA markers that must still be present on main (regression tripwire).
IMPORT_IA_TRIPWIRES = [
    ("ui/src/ui/views/knowledge-universe-space-import.ts", "renderFolderSyncPanel"),
    ("ui/src/ui/views/knowledge-universe-space-import.ts", "renderVaultSyncImportForm"),
    ("ui/src/ui/views/knowledge-universe-space-import.ts", "FOLDER_SYNC_METHODS"),
    ("ui/src/ui/views/knowledge-universe-space-import.ts", "openKnowledgeSpaceCreatePage"),
    (
        "ui/src/ui/views/knowledge-universe-space-import.node.test.ts",
        "never auto-materializes when no private space",
    ),
    (
        "ui/src/ui/views/knowledge-universe-space-import-local-folder.ts",
        "ku-space-import-local-folder-mode",
    ),
    (
        "ui/src/ui/views/knowledge-universe-space-import-local-folder.ts",
        "ku-space-import-local-folder-watcher",
    ),
    (
        "ui/src/ui/views/knowledge-universe-space-import-local-folder.ts",
        "ku-space-import-local-folder-scan",
    ),
    ("ui/src/ui/ports/employee/views/home-page-contracts.ts", "vaultSync"),
]

EXPECTED_RULESETS = {
    "protect-trunk-no-force-push",
    "protect-deploy-no-deletion",
}

BACKUP_REFS = [
    "origin/backup/main-pre-forcepush-20260727",
    "origin/backup/enterprise-ai-model-gov-20260727",
]


def git(*args: str) -> str:
    r = subprocess.run([GIT, *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} -> {r.returncode}: {r.stderr.strip()}")
    return r.stdout


def git_ok(*args: str) -> bool:
    return subprocess.run([GIT, *args], capture_output=True, text=True).returncode == 0


def gh_json(*args: str):
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)} -> {r.returncode}: {r.stderr.strip()}")
    return json.loads(r.stdout)


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def add(self, check: str, ok: bool | None, detail: str) -> None:
        verdict = "PASS" if ok is True else ("FAIL" if ok is False else "SKIP")
        self.rows.append((verdict, check, detail))

    @property
    def failed(self) -> bool:
        return any(v == "FAIL" for v, _, _ in self.rows)

    def emit(self) -> None:
        width = max(len(c) for _, c, _ in self.rows)
        for verdict, check, detail in self.rows:
            print(f"[{verdict}] {check.ljust(width)}  {detail}")
        counts: dict[str, int] = {}
        for v, _, _ in self.rows:
            counts[v] = counts.get(v, 0) + 1
        print()
        print("  ".join(f"{k}={v}" for k, v in sorted(counts.items())))


def check_a(rep: Report) -> dict[int, str]:
    """PR merged, merge commit shape, replay tip preserved as second parent."""
    merges: dict[int, str] = {}
    for pr, branch, _ in LANDINGS:
        try:
            d = gh_json(
                "pr",
                "view",
                str(pr),
                "--repo",
                REPO,
                "--json",
                "state,mergeCommit,baseRefName,headRefName",
            )
        except RuntimeError as exc:
            rep.add(f"A/#{pr} state", False, f"gh failed: {exc}")
            continue
        state = d["state"]
        sha = (d.get("mergeCommit") or {}).get("oid") or ""
        if state != "MERGED":
            rep.add(f"A/#{pr} state", False, f"state={state} (must be MERGED, never CLOSED)")
            continue
        if d["baseRefName"] != "main":
            rep.add(f"A/#{pr} base", False, f"base={d['baseRefName']} (expected main)")
            continue
        merges[pr] = sha
        parents = git("rev-list", "--parents", "-1", sha).split()[1:]
        tip = git("rev-parse", f"origin/{branch}").strip()
        if len(parents) != 2:
            rep.add(
                f"A/#{pr} merge shape",
                False,
                f"{sha[:10]} has {len(parents)} parent(s); --merge should give 2 "
                "(squash/rebase would rewrite the recorded landing SHAs)",
            )
        elif parents[1] != tip:
            rep.add(
                f"A/#{pr} merge shape",
                False,
                f"second parent {parents[1][:10]} != branch tip {tip[:10]}",
            )
        else:
            rep.add(
                f"A/#{pr} merge shape",
                True,
                f"MERGED {sha[:10]}, 2 parents, tip {tip[:10]} preserved",
            )
    return merges


def check_b(rep: Report, merges: dict[int, str]) -> None:
    """Per-merge first-parent delta equals the prediction; cumulative delta is the union."""
    union: set[str] = set()
    for pr, _, expected in LANDINGS:
        sha = merges.get(pr)
        if not sha:
            rep.add(f"B/#{pr} delta", None, "no merge commit (see A)")
            continue
        first_parent = git("rev-list", "--parents", "-1", sha).split()[1]
        got = set(git("diff", "--name-only", first_parent, sha).split("\n")) - {""}
        union |= expected
        if got == expected:
            rep.add(f"B/#{pr} delta", True, f"{len(got)} paths, exactly as predicted")
        else:
            extra = sorted(got - expected)
            missing = sorted(expected - got)
            rep.add(
                f"B/#{pr} delta",
                False,
                f"unexpected={extra} missing={missing}",
            )
    if not git_ok("merge-base", "--is-ancestor", STACK_HEAD, "origin/main"):
        rep.add(
            "B/cumulative",
            False,
            f"stack head {STACK_HEAD[:10]} is no longer an ancestor of main "
            "(history was rewritten)",
        )
        return
    cumulative = set(git("diff", "--name-only", MAIN_BEFORE_STACK, STACK_HEAD).split("\n")) - {""}
    if cumulative == union:
        rep.add("B/cumulative", True, f"{len(cumulative)} paths == union of predictions")
    else:
        rep.add(
            "B/cumulative",
            False,
            f"unexpected={sorted(cumulative - union)} missing={sorted(union - cumulative)}",
        )


def check_c(rep: Report) -> None:
    """The dropped Import IA content must still be intact on main."""
    bad: list[str] = []
    for path, marker in IMPORT_IA_TRIPWIRES:
        try:
            body = git("show", f"origin/main:{path}")
        except RuntimeError:
            bad.append(f"{path} (missing)")
            continue
        if marker not in body:
            bad.append(f"{path} lost '{marker}'")
    if bad:
        rep.add("C/import-IA intact", False, "; ".join(bad))
    else:
        rep.add(
            "C/import-IA intact",
            True,
            f"all {len(IMPORT_IA_TRIPWIRES)} tripwires present on main",
        )

    # The four files dropped from the replay must not have appeared on main.
    dropped = [
        ".kiro/specs/knowledge-workbench-import-ia/tasks.md",
        "docs/design/knowledge-workbench-renamed-mockup.html",
        "ui/src/ui/controllers/knowledge-universe-local-folder.node.test.ts",
        "ui/src/ui/controllers/knowledge-universe-personal-space.node.test.ts",
    ]
    leaked = [p for p in dropped if git_ok("rev-parse", "--verify", "--quiet", f"origin/main:{p}")]
    if leaked:
        rep.add("C/dropped stayed out", False, f"leaked onto main: {leaked}")
    else:
        rep.add("C/dropped stayed out", True, f"all {len(dropped)} dropped paths absent from main")

    # And the auto-materialize hook must not have been wired.
    render_model = git("show", "origin/main:ui/src/ui/ports/employee/render-model.ts")
    if "onEnsurePersonalSpaceForImport" in render_model:
        rep.add("C/no auto-materialize", False, "render-model.ts wires onEnsurePersonalSpaceForImport")
    else:
        rep.add("C/no auto-materialize", True, "render-model.ts has no auto-materialize handler")


def check_d(rep: Report) -> None:
    """The dead module the stack was meant to wire must now have real importers."""
    out = subprocess.run(
        [GIT, "grep", "-l", "system-authorization", "origin/main", "--", "ui/src", "src"],
        capture_output=True,
        text=True,
    ).stdout
    files = {line.split(":", 1)[1] for line in out.split("\n") if ":" in line}
    non_test = sorted(f for f in files if not f.endswith(".test.ts"))
    wired = [
        f
        for f in non_test
        if f != "ui/src/ui/ports/employee/system-authorization.ts"
    ]
    if wired:
        rep.add("D/system-auth wired", True, f"importers on main: {wired}")
    else:
        rep.add(
            "D/system-auth wired",
            False,
            "system-authorization.ts still has no importer other than its own test",
        )


def check_e(rep: Report) -> None:
    try:
        rulesets = gh_json("api", f"/repos/{REPO}/rulesets")
    except RuntimeError as exc:
        rep.add("E/rulesets", None, f"could not read rulesets: {exc}")
    else:
        active = {r["name"] for r in rulesets if r.get("enforcement") == "active"}
        missing = EXPECTED_RULESETS - active
        if missing:
            rep.add("E/rulesets", False, f"not active: {sorted(missing)}")
        else:
            rep.add("E/rulesets", True, f"active: {sorted(EXPECTED_RULESETS)}")

    bad = [r for r in BACKUP_REFS if not git_ok("rev-parse", "--verify", "--quiet", r)]
    if bad:
        rep.add("E/backup refs", False, f"unresolvable: {bad}")
    else:
        rep.add("E/backup refs", True, f"{len(BACKUP_REFS)} backup refs resolve")


def check_f(rep: Report) -> None:
    not_ancestor = []
    for _, branch, _ in LANDINGS:
        ref = f"origin/{branch}"
        if not git_ok("rev-parse", "--verify", "--quiet", ref):
            not_ancestor.append(f"{branch} (ref gone)")
        elif not git_ok("merge-base", "--is-ancestor", ref, "origin/main"):
            not_ancestor.append(f"{branch} (not in main)")
    if not_ancestor:
        rep.add("F/branches in main", False, "; ".join(not_ancestor))
    else:
        rep.add(
            "F/branches in main",
            True,
            f"all {len(LANDINGS)} replay branches reachable and merged into main",
        )


def main() -> int:
    rep = Report()
    merges = check_a(rep)
    check_b(rep, merges)
    check_c(rep)
    check_d(rep)
    check_e(rep)
    check_f(rep)

    if "--json" in sys.argv:
        print(
            json.dumps(
                [{"verdict": v, "check": c, "detail": d} for v, c, d in rep.rows],
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(f"main = {git('rev-parse', '--short', 'origin/main').strip()}")
        print(f"stack base = {MAIN_BEFORE_STACK[:10]} (main right after PR #106)")
        print(f"stack head = {STACK_HEAD[:10]} (main right after PR #131)")
        after = git("rev-list", "--count", f"{STACK_HEAD}..origin/main").strip()
        print(f"commits on main after the stack: {after}")
        print()
        rep.emit()
    return 1 if rep.failed else 0


if __name__ == "__main__":
    sys.exit(main())
