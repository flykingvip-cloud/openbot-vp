#!/usr/bin/env python3
"""可复用的批次重放工具（默认只读；只有 --write 才创建 ref）

    # 只看计划
    python3 .../replay-batch.py kiro-web-ui/knowledge-workbench-import-ia
    # 落到指定 ref 之上并写出新分支
    python3 .../replay-batch.py <branch> --onto origin/replay/b2-... --write replay/b4-...

为什么用 plumbing 而不是 `git cherry-pick`：共享主树上跑 cherry-pick 需要切分支、
动索引与工作树，会撞上其他 agent 的在途改动。本工具全程 `merge-tree` + `commit-tree`，
只往对象库写对象，不碰任何工作树、索引；只有 `--write` 会动一个新建的 ref。

每个提交的判定：
  LEDGER      全部文件都是 prose（`*.md`/`*.mdx` 位于 docs/ .kiro/ deploy/production/，
              或 CHANGELOG.md）→ 不重放，只记台账
  MERGE       合并提交 → 不 cherry-pick
  SUPERSEDED  提交内所有文件 blob 已等于目标 → 内容已在
  NOOP        merge-tree 结果树等于当前虚拟树 → 空 cherry-pick
  CONFLICT    merge-tree 冲突 → 需人工对账，跳过
  REPLAY      已落到虚拟链上；并逐条校验 patch-id 与源等价
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

GIT = "/usr/bin/git"
REPO = Path(__file__).resolve().parents[4]
DEFAULT_BASE = "origin/release/baseline-recovery-20260725"
PROSE_ROOTS = ("docs/", ".kiro/", "deploy/production/")


def git(*a: str, env: dict | None = None) -> str:
    e = {**os.environ, **(env or {})}
    return subprocess.run([GIT, *a], cwd=REPO, capture_output=True, text=True, env=e).stdout


def run(*a: str) -> tuple[int, str]:
    r = subprocess.run([GIT, *a], cwd=REPO, capture_output=True, text=True)
    return r.returncode, r.stdout


def sh(cmd: str) -> str:
    return subprocess.run(["bash", "-c", cmd], cwd=REPO, capture_output=True, text=True).stdout


def is_prose(p: str) -> bool:
    if p == "CHANGELOG.md":
        return True
    return (p.endswith((".md", ".mdx"))) and p.startswith(PROSE_ROOTS)


# 纯记录类路径：进度标记与 cutover 记录，其价值在台账，不重放
RECORD_HINTS = ("deploy/production/RELEASE_RECORD.md",
                "deploy/production/cutover-README.md",
                "deploy/production/cutover-history.log")


def is_record(p: str) -> bool:
    """RECORD 与 DOC 的区分：进度标记/cutover 记录属 RECORD，其余 prose 是真文档。

    B5 暴露了「prose-only 一律只入台账」的问题：
    `docs/design/nginx-hsts-https-redirect-change-window-2026-07-20.md` 是配合生产
    HSTS 变更的操作清单，主干里根本没有这个文件。把它当记录丢掉，等于让配置变更
    落地却没有对应的变更窗口清单。
    """
    return p in RECORD_HINTS or p.endswith("/tasks.md")


def files_of(c: str) -> list[str]:
    return [f for f in git("diff-tree", "--no-commit-id", "--name-only", "-r", c).split("\n") if f]


def blob(rev: str, path: str) -> str:
    """取 <rev>:<path> 的 blob 哈希；路径不存在时返回空串。

    坑：`git rev-parse <rev>:<missing>` 会把参数**原样回显到 stdout** 再向 stderr 报错。
    只看 stdout 会把"不存在"误判成"存在"（回显的字符串非空）。必须用
    `--verify --quiet` 并检查退出码。
    """
    r = subprocess.run([GIT, "rev-parse", "--verify", "--quiet", f"{rev}:{path}"],
                       cwd=REPO, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("branch")
    ap.add_argument("--base", default=DEFAULT_BASE, help="计算独有提交的基线")
    ap.add_argument("--onto", default=None, help="重放落在哪个 ref 之上（默认同 --base）")
    ap.add_argument("--write", default=None, help="写出的新分支名（不给则纯预演）")
    ap.add_argument("--exclude", action="append", default=[],
                    help="从重放结果中剔除的路径前缀，可重复。"
                         "只剔除本次新增的路径，目标已跟踪的同前缀文件不动。"
                         "用于 D10：a038f5c113 夹带 300 个 .tmp/ 审计 dump")
    args = ap.parse_args()

    onto = args.onto or args.base
    head = git("rev-parse", onto).strip()
    if not head:
        print(f"FAIL: 无法解析 --onto {onto}")
        return 1
    htree = git("rev-parse", f"{head}^{{tree}}").strip()

    commits = git("rev-list", "--reverse", f"{args.base}..{args.branch}").split()
    print(f"branch = {args.branch}   独有提交 {len(commits)}（相对 {args.base}）")
    print(f"onto   = {onto} @ {head[:10]}  {git('log','-1','--format=%s',head).strip()[:48]}")
    print(f"模式   = {'写入 ' + args.write if args.write else '预演（不写 ref）'}\n")

    rows, replayed, problems = [], [], []
    for c in commits:
        subj = git("log", "-1", "--format=%s", c).strip()
        fs = files_of(c)
        parents = git("rev-parse", f"{c}^@").split()

        if len(parents) > 1:
            rows.append(("MERGE", c, subj, ""))
            continue
        if fs and all(is_prose(f) for f in fs):
            if all(is_record(f) for f in fs):
                rows.append(("LEDGER", c, subj, f"{len(fs)} 记录类"))
                continue
            absent = [f for f in fs if not blob(head, f)]
            if not absent:
                rows.append(("LEDGER", c, subj, f"{len(fs)} prose，目标已有该文件"))
                continue
            # 主干缺这些文档 → 是真内容，落下去（不 continue，走下面的重放路径）
            rows_note = f"新文档 {len(absent)}/{len(fs)}"
        else:
            rows_note = ""
        if fs and all(blob(c, f) == blob(head, f) for f in fs):
            rows.append(("SUPERSEDED", c, subj, ""))
            continue
        if not parents:
            rows.append(("SKIP", c, subj, "无父提交"))
            continue

        code, out = run("merge-tree", "--write-tree", f"--merge-base={parents[0]}", head, c)
        tree = out.strip().split("\n")[0] if out.strip() else ""
        if code != 0:
            rows.append(("CONFLICT", c, subj, "需人工对账"))
            continue
        dropped: list[str] = []
        if args.exclude:
            # 只剔除「本次新增」的受排除路径；目标已跟踪的同前缀文件保持不动
            # （SoT 本来就跟踪着 2 个 .tmp/openbot-live-acceptance*.mjs）
            for pre in args.exclude:
                in_new = set(git("ls-tree", "-r", "--name-only", tree, "--", pre).split("\n")) - {""}
                in_old = set(git("ls-tree", "-r", "--name-only", head, "--", pre).split("\n")) - {""}
                dropped += sorted(in_new - in_old)
            if dropped:
                import tempfile
                with tempfile.TemporaryDirectory() as td:
                    idx = f"{td}/index"
                    subprocess.run([GIT, "read-tree", tree], cwd=REPO,
                                   env={**os.environ, "GIT_INDEX_FILE": idx}, capture_output=True)
                    for p in dropped:
                        subprocess.run([GIT, "update-index", "--force-remove", "--", p], cwd=REPO,
                                       env={**os.environ, "GIT_INDEX_FILE": idx}, capture_output=True)
                    r = subprocess.run([GIT, "write-tree"], cwd=REPO,
                                       env={**os.environ, "GIT_INDEX_FILE": idx},
                                       capture_output=True, text=True)
                    tree = r.stdout.strip() or tree

        if tree == htree:
            rows.append(("NOOP", c, subj, "结果树未变"))
            continue

        body = git("log", "-1", "--format=%B", c).rstrip()
        excl = (f"\n({len(dropped)} path(s) under {', '.join(args.exclude)} excluded)"
                if dropped else "")
        msg = (f"{body}\n\n(cherry picked from commit {c}){excl}\n\n"
               "Task: local-worktree-consolidation\nAgent: kiro-consolidation")
        new = git("commit-tree", tree, "-p", head, "-m", msg, env={
            "GIT_AUTHOR_NAME": git("log", "-1", "--format=%an", c).strip(),
            "GIT_AUTHOR_EMAIL": git("log", "-1", "--format=%ae", c).strip(),
            "GIT_AUTHOR_DATE": git("log", "-1", "--format=%aI", c).strip(),
        }).strip()
        if not new:
            problems.append(f"{c[:10]} commit-tree 失败")
            rows.append(("ERROR", c, subj, "commit-tree 失败"))
            continue

        # 忠实性：新提交相对前一个虚拟 tip 的 diff 应与源提交相对其父等价
        pa = sh(f"{GIT} diff {head} {new} | {GIT} patch-id --stable").split()
        pb = sh(f"{GIT} diff {parents[0]} {c} | {GIT} patch-id --stable").split()
        if pa and pb and pa[0] == pb[0]:
            note = "patch-id 等价"
        else:
            # patch-id 不等 ≠ 重放失真。基线动过时，三方合并的结果与源提交的结果
            # 必然不同（应用的是同一个 delta，不是同一个结果）。此处按文件类型分别核：
            #   新增型：blob 必须与源逐字相同
            #   修改型：不能比 blob，改为核「源提交新增的行是否都出现在重放结果里」
            bad = []
            for line in git("diff-tree", "--no-commit-id", "-r", "--name-status", c).split("\n"):
                if not line.strip():
                    continue
                st, _, f = line.partition("\t")
                if st.startswith("A"):
                    if blob(new, f) != blob(c, f):
                        bad.append(f"{f}(新增型 blob 不符)")
                elif st.startswith("M"):
                    added = [ln[1:] for ln in git("diff", f"{parents[0]}", c, "--", f).split("\n")
                             if ln.startswith("+") and not ln.startswith("+++") and ln[1:].strip()]
                    got = git("show", f"{new}:{f}")
                    miss = [ln for ln in added if ln not in got]
                    if miss:
                        bad.append(f"{f}(缺 {len(miss)}/{len(added)} 新增行)")
            if bad:
                problems.append(f"{c[:10]} 重放结果不含源变更: {bad}")
                note = f"变更缺失 {bad[:2]}"
            else:
                note = "三方合并（基线已前进），源变更全部保留"
        rows.append(("REPLAY", c, subj, f"{rows_note} {note}".strip()))
        replayed.append((c, new))
        head, htree = new, tree

    print(f"{'判定':11} {'源':11} {'说明':34} 主题")
    print("-" * 116)
    for kind, c, subj, note in rows:
        print(f"{kind:11} {c[:10]:11} {note[:34]:34} {subj[:44]}")

    from collections import Counter
    cnt = Counter(k for k, *_ in rows)
    print("\n" + "=" * 116)
    print("  ".join(f"{k}={v}" for k, v in sorted(cnt.items())))
    print(f"重放链 tip = {head[:10]}（{len(replayed)} 个提交）")
    if problems:
        print("\n问题：")
        for p in problems:
            print(f"  - {p}")
        return 1

    if args.write and replayed:
        run("update-ref", f"refs/heads/{args.write}", head)
        print(f"\n已写入 refs/heads/{args.write} → {head[:10]}")
    elif args.write:
        print("\n无可重放提交，未写 ref")
    return 0


if __name__ == "__main__":
    sys.exit(main())
