#!/usr/bin/env python3
"""文件级子集重放（默认只读；--write 才建 ref）

    python3 docs/design/convergence-evidence/2026-07-27/subset-replay.py [--write <branch>]

与整提交重放的区别：B7 的取舍是**按功能挑文件**。本工具对每个选集做两件事：

  1. **加文件**：把主干缺失的文件从来源分支取 blob 原样加入（纯新增，无冲突面）
  2. **接线**：对主干已有、且来源改动过的文件做**按文件三方合并**
     （base = 源提交的父版本，ours = 主干版本，theirs = 源版本）

只有两者都成立，功能才真正接上 —— 只加文件会得到无人引用的死代码。
接线出现冲突的选集会被跳过并报出，绝不写半成品。

只读边界：只往对象库写 blob/tree/commit；不碰工作树与索引；只有 --write 动一个新 ref。
"""

from __future__ import annotations

import argparse
import os
import subprocess
import tempfile
from pathlib import Path

GIT = "/usr/bin/git"
REPO = Path(__file__).resolve().parents[4]
TRUNK = "origin/replay/b7-deliverable-preview-partial"
SRC = "cursor-composer/collaboration-deliverable-v95"

# name -> (来源提交, 新增文件, 接线文件[(源提交, 路径)])
SELECTIONS: list[tuple[str, str, list[str], list[tuple[str, str]]]] = [
    # 接线源不一定是落模块的那个提交。实测：功能提交只落了模块，接线当时还在未提交的
    # WIP 里，后来被抢救提交 a038f5c113 一起扫走。所以接线要按「谁真正引入了引用」定源。
    ("S1-response-dlp", "43a03037d1",
     ["src/gateway/response-dlp.ts", "src/gateway/response-dlp.test.ts"],
     [("a038f5c113", "src/auto-reply/reply/agent-runner-execution.ts")]),
    ("S4-actor-scope", "43a03037d1",
     ["src/gateway/actor-scope.ts", "src/gateway/actor-scope.test.ts",
      "src/gateway/server-methods/cross-tenant-task-memory.test.ts",
      "src/gateway/server-methods/rpc-tenant-scope.test.ts",
      "src/memory/query-atoms-acl.test.ts"],
     [("43a03037d1", "src/gateway/server-methods/config.ts"),
      ("43a03037d1", "src/gateway/server-methods/sessions.ts"),
      ("43a03037d1", "src/gateway/server-methods/nodes.ts")]),
    ("S3-group-deliverable", "1b339687bc",
     ["src/gateway/knowledge/deliverables/save-and-archive.ts",
      "src/gateway/knowledge/deliverables/save-and-archive.test.ts",
      "src/gateway/knowledge/deliverables/group-manifest.ts",
      "src/gateway/server-methods/group-workspace-file.ts",
      "src/gateway/server-methods/group-workspace-file.pack.ts",
      "ui/src/ui/collaboration/resolve-group-scope.ts",
      "ui/src/ui/controllers/group-workspace-file.ts",
      "ui/src/ui/controllers/group-deliverable-manifest.ts",
      "ui/src/ui/wiring/group-workspace-file.ts",
      "ui/src/ui/wiring/deliverable-save.ts",
      "ui/src/ui/wiring/deliverable-save.test.ts",
      "ui/src/ui/wiring/group-deliverable-preview-flow.ts",
      "ui/src/ui/views/artifact-sidebar-deliverable.test.ts",
      "ui/src/ui/app.group-deliverable-preview.node.test.ts"],
     [("f15ee5de34", "src/gateway/server-methods-list.ts"),
      ("a038f5c113", "src/gateway/server-methods/knowledge.ts"),
      ("a038f5c113", "ui/src/ui/app.ts")]),
]

MESSAGES = {
    "S1-response-dlp": (
        "Gateway: add response DLP redaction for assistant output",
        "Strips architecture and deployment path leakage from assistant replies:\n"
        "state directories under /root/.openbot and deploy/production paths become\n"
        "[redacted-path]. The trunk had no equivalent; its payload-redaction.ts only\n"
        "scrubs base64 image data out of diagnostics, which is a different surface.\n\n"
        "File subset of 43a03037d1 (Security P1.1); the rest of that commit is\n"
        "deferred separately."),
    "S4-actor-scope": (
        "Gateway: add actor scope isolation and cross-tenant isolation tests",
        "Splits gateway requests into platform and employee actor modes and resolves\n"
        "the agent, space, group-bot-session and archived-group sets each actor may\n"
        "see, on top of the employee-workbench-scope helpers the trunk already has.\n"
        "Adds the cross-tenant task memory, RPC tenant scope and queryAtoms ACL tests\n"
        "that the trunk lacked.\n\n"
        "File subset of 43a03037d1 (Security P1.1)."),
    "S3-group-deliverable": (
        "Knowledge: add group deliverable preview, save and archive",
        "Lands the whole feature the trunk had no equivalent of: save a group\n"
        "workspace file as an archived deliverable, read group workspace files and\n"
        "manifests over RPC with path-traversal rejection, and the UI wiring for the\n"
        "artifact sidebar preview and save flow.\n\n"
        "File subset spanning 7ba978c4ed, f15ee5de34 and 1b339687bc, plus the five\n"
        "transitive dependencies a closure analysis found (group-manifest,\n"
        "resolve-group-scope, and the group workspace file controller/wiring)."),
}


def git(*a: str, env: dict | None = None) -> str:
    e = {**os.environ, **(env or {})}
    return subprocess.run([GIT, *a], cwd=REPO, capture_output=True, text=True, env=e).stdout


def blob(rev: str, path: str) -> str:
    r = subprocess.run([GIT, "rev-parse", "--verify", "--quiet", f"{rev}:{path}"],
                       cwd=REPO, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def cat(b: str) -> bytes:
    return subprocess.run([GIT, "cat-file", "blob", b], cwd=REPO, capture_output=True).stdout


def merge_file(base: str, ours: str, theirs: str) -> tuple[bool, bytes]:
    with tempfile.TemporaryDirectory() as td:
        t = Path(td)
        for n, b in (("base", base), ("ours", ours), ("theirs", theirs)):
            (t / n).write_bytes(cat(b))
        r = subprocess.run([GIT, "merge-file", "-p", str(t / "ours"), str(t / "base"),
                            str(t / "theirs")], cwd=REPO, capture_output=True)
        return r.returncode == 0, r.stdout


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", default=None)
    args = ap.parse_args()

    head = git("rev-parse", TRUNK).strip()
    print(f"trunk = {head[:10]}  {git('log', '-1', '--format=%s', TRUNK).strip()[:50]}\n")
    landed = []

    for name, src_commit, adds, wirings in SELECTIONS:
        print("=" * 100)
        print(f"## {name}   新增 {len(adds)} 个 / 接线 {len(wirings)} 个")
        entries: list[tuple[str, str]] = []   # (path, blob)
        problems: list[str] = []

        for f in adds:
            b = blob(src_commit, f) or blob(SRC, f)
            if not b:
                problems.append(f"{f} 来源取不到")
                continue
            if blob(head, f):
                problems.append(f"{f} 主干已存在，不能当纯新增")
                continue
            entries.append((f, b))

        for wsrc, f in wirings:
            base, ours, theirs = blob(f"{wsrc}^", f), blob(head, f), blob(wsrc, f)
            if not (base and ours and theirs):
                problems.append(f"{f} 三方缺边（base={bool(base)} ours={bool(ours)} theirs={bool(theirs)}）")
                continue
            if ours == theirs:
                print(f"   接线已相同，跳过: {f}")
                continue
            ok, out = merge_file(base, ours, theirs)
            if not ok:
                problems.append(f"{f} 接线冲突 {out.count(b'<<<<<<<')} 处")
                continue
            nb = subprocess.run([GIT, "hash-object", "-w", "--stdin"], cwd=REPO,
                                input=out, capture_output=True).stdout.decode().strip()
            entries.append((f, nb))
            print(f"   接线干净: {f}")

        # 关键断言：接线合并「干净」并不等于「接上了」。首版就踩了这个坑 ——
        # 用功能提交当接线源，merge-file 干净通过，但那个提交根本没改接线文件，
        # 于是新增模块仍然无人引用（死代码）。必须核合并结果里真的出现了引用。
        wired_text = "\n".join(cat(b).decode(errors="replace")
                               for p, b in entries if any(p == w for _s, w in wirings))
        for f in adds:
            if ".test." in f:
                continue
            mod = Path(f).stem
            referenced = (mod in wired_text
                          or any(mod in cat(b).decode(errors="replace")
                                 for p, b in entries if p != f))
            if not referenced:
                problems.append(f"{f} 合并后仍无人引用（死代码）")

        if problems:
            print("   **跳过该选集** —— 不写半成品：")
            for p in problems:
                print(f"      {p}")
            print()
            continue

        with tempfile.TemporaryDirectory() as td:
            idx = f"{td}/index"
            env = {"GIT_INDEX_FILE": idx}
            subprocess.run([GIT, "read-tree", head], cwd=REPO,
                           env={**os.environ, **env}, capture_output=True)
            for p, b in entries:
                subprocess.run([GIT, "update-index", "--add", "--cacheinfo", f"100644,{b},{p}"],
                               cwd=REPO, env={**os.environ, **env}, capture_output=True)
            tree = git("write-tree", env=env).strip()

        subj, body = MESSAGES[name]
        msg = (f"{subj}\n\n{body}\n\n(file subset replay; sources: "
               f"{', '.join(sorted({s for s, _ in wirings} | {src_commit}))})\n\n"
               "Task: local-worktree-consolidation\nAgent: kiro-consolidation")
        new = git("commit-tree", tree, "-p", head, "-m", msg).strip()
        if not new:
            print("   FAIL: commit-tree 失败\n")
            continue
        print(f"   → 提交 {new[:10]}，改动 {len(entries)} 个文件")
        landed.append((name, new, len(entries)))
        head = new
        print()

    print("=" * 100)
    for name, sha, n in landed:
        print(f"  {sha[:10]}  {n:>3} 文件  {name}")
    if args.write and landed:
        subprocess.run([GIT, "update-ref", f"refs/heads/{args.write}", head],
                       cwd=REPO, capture_output=True)
        print(f"\n已写入 refs/heads/{args.write} → {head[:10]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
