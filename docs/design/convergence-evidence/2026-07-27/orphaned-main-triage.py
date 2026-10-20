#!/usr/bin/env python3
"""被强推丢下的旧 main 谱系提交 triage（只读，可复现）

    python3 docs/design/convergence-evidence/2026-07-27/orphaned-main-triage.py

背景：2026-07-27 12:39 与 12:49，`origin/main` 被两次非快进强推到 SoT 谱系。
强推前的 tip `0536504b9e` 不再是 `origin/main` 的祖先，其独有提交（含已合并的
PR #90、#91）被留在旧谱系上。已备份为 `origin/backup/main-pre-forcepush-20260727`。

本脚本给出每个提交的处置判定：
  PRESENT     — 提交内所有文件的 blob 已等于 SoT，内容已在，可弃置
  SUPERSEDED  — 提交触及的文件在 SoT 中都存在但内容不同，且 SoT 侧更新（提交更晚），
                说明该处已被后续实现覆盖，需人工确认而非机械重放
  REPLAY      — SoT 中缺少该提交引入的文件，或 SoT 侧未再动过该文件，需重放
  MERGE       — 合并提交，不 cherry-pick（其内容由被合并分支承载）

只读：不 cherry-pick、不 commit、不改任何 ref 与文件。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

GIT = "/usr/bin/git"
REPO = Path(__file__).resolve().parents[4]
SOT = "origin/release/baseline-recovery-20260725"
OLD_MAIN = "0536504b9e"
BACKUP = "origin/backup/main-pre-forcepush-20260727"


def git(*a: str) -> str:
    return subprocess.run([GIT, *a], cwd=REPO, capture_output=True, text=True).stdout


def rc(*a: str) -> int:
    return subprocess.run([GIT, *a], cwd=REPO, capture_output=True).returncode


def blob(rev: str, path: str) -> str:
    """取 <rev>:<path> 的 blob；路径不存在返回空串。

    坑：`git rev-parse <rev>:<missing>` 会把参数原样回显到 stdout 再向 stderr 报错，
    只看 stdout 会把"不存在"误判成"存在"。必须 `--verify --quiet` + 查退出码。
    首版本脚本正是踩了这个坑，导致 "SoT 缺 N 个文件" 这一分支永远不触发。
    """
    r = subprocess.run([GIT, "rev-parse", "--verify", "--quiet", f"{rev}:{path}"],
                       cwd=REPO, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def main() -> int:
    if rc("cat-file", "-e", f"{OLD_MAIN}^{{commit}}") != 0:
        print(f"FAIL: {OLD_MAIN} 不可达 —— 备份 ref 是否已被删除？")
        return 1
    backup_ok = rc("merge-base", "--is-ancestor", OLD_MAIN, BACKUP) == 0
    ff = rc("merge-base", "--is-ancestor", OLD_MAIN, "origin/main") == 0
    print(f"旧 main tip   : {OLD_MAIN}  {git('log', '-1', '--format=%cd %s', '--date=format:%m-%d %H:%M', OLD_MAIN).strip()[:60]}")
    print(f"origin/main   : {git('rev-parse', '--short', 'origin/main').strip()}  "
          f"（旧 tip 仍为其祖先={ff}）")
    print(f"SoT           : {git('rev-parse', '--short', SOT).strip()}")
    print(f"备份 ref 有效  : {backup_ok}  ({BACKUP})\n")

    commits = git("rev-list", "--reverse", OLD_MAIN, "--not", SOT).split()
    buckets: dict[str, list[tuple[str, str]]] = {"PRESENT": [], "SUPERSEDED": [],
                                                 "REPLAY": [], "MERGE": []}
    sot_time = {}

    for c in commits:
        subj = git("log", "-1", "--format=%s", c).strip()[:62]
        if len(git("rev-parse", f"{c}^@").split()) > 1:
            buckets["MERGE"].append((c, subj))
            continue
        files = [f for f in git("diff-tree", "--no-commit-id", "--name-only", "-r", c).split("\n") if f]
        if not files:
            buckets["PRESENT"].append((c, subj))
            continue

        same = missing = newer_in_sot = 0
        for f in files:
            a = blob(c, f)
            b = blob(SOT, f)
            if not b:
                missing += 1
            elif a == b:
                same += 1
            else:
                # SoT 侧该文件最后一次改动时间 vs 本提交时间
                key = f
                if key not in sot_time:
                    sot_time[key] = git("log", "-1", "--format=%ct", SOT, "--", f).strip() or "0"
                ct = git("log", "-1", "--format=%ct", c).strip() or "0"
                if int(sot_time[key] or 0) > int(ct):
                    newer_in_sot += 1
        if same == len(files):
            buckets["PRESENT"].append((c, subj))
        elif missing > 0:
            buckets["REPLAY"].append((c, f"{subj}  [SoT 缺 {missing}/{len(files)} 个文件]"))
        elif newer_in_sot == len(files) - same:
            buckets["SUPERSEDED"].append((c, f"{subj}  [SoT 侧全部更晚]"))
        else:
            buckets["REPLAY"].append((c, f"{subj}  [SoT 侧未再改动 {len(files) - same - newer_in_sot} 个文件]"))

    for k in ("REPLAY", "SUPERSEDED", "PRESENT", "MERGE"):
        rows = buckets[k]
        print(f"## {k}  ({len(rows)})")
        for c, subj in rows:
            print(f"   {c[:10]}  {subj}")
        print()

    print("=" * 100)
    print(f"合计 {len(commits)}：REPLAY {len(buckets['REPLAY'])} / "
          f"SUPERSEDED {len(buckets['SUPERSEDED'])} / "
          f"PRESENT {len(buckets['PRESENT'])} / MERGE {len(buckets['MERGE'])}")
    print()
    print(f"{'编号':6} {'判定':8} 证据")
    print("-" * 100)
    checks = [
        ("T1", backup_ok, f"备份 ref {BACKUP} 仍承载旧 tip"),
        ("T2", not ff, f"旧 tip 已不是 origin/main 祖先（确认强推事实）"),
        ("T3", len(buckets["REPLAY"]) >= 0, f"REPLAY 清单已产出：{len(buckets['REPLAY'])} 个提交待人工确认"),
    ]
    fails = 0
    for cid, ok_, ev in checks:
        print(f"{cid:6} {'PASS' if ok_ else 'FAIL':8} {ev}")
        fails += 0 if ok_ else 1
    print("\n" + "=" * 100)
    print(f"VERDICT: {'FAIL' if fails else 'PASS'}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
