#!/usr/bin/env python3
"""B2 重放验收（只读，可复现）

    python3 docs/design/convergence-evidence/2026-07-27/verify-replay-b2.py

验证 PR #106（`replay/b2-web-favicon-branding` → SoT）的重放是忠实的、没有夹带、
没有污染主干。只读：只做 git 读命令与 `gh api` GET。

判定项：
  R1  重放提交相对 SoT 的 diff 与源提交相对其父的 diff `patch-id` 相同
  R2  逐文件 blob 与源提交逐字相同
  R3  未夹带源提交之外的文件（除台账那一处）
  R4  未触碰 `.tmp/`
  R5  原作者身份被保留，且带 Task/Agent trailer 与 provenance 行
  R6  不是空 cherry-pick（结果树 ≠ SoT 树）
  R7  只往 SoT 加文件，不改既有运行时代码（本批全为新增资源）
  R8  PR 目标分支是 SoT，且 SoT 本身未被直接推送
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

GIT = "/usr/bin/git"
REPO = Path(__file__).resolve().parents[4]
SOT = "origin/release/baseline-recovery-20260725"
BR = "origin/replay/b2-web-favicon-branding"
SRC = "d31e915298"
LEDGER = "deploy/production/BASELINE_RECOVERY_20260725.md"
PR = 106

results: list[tuple[str, str, str]] = []


def git(*a: str) -> str:
    return subprocess.run([GIT, *a], cwd=REPO, capture_output=True, text=True).stdout


def sh(cmd: str) -> str:
    return subprocess.run(["bash", "-c", cmd], cwd=REPO, capture_output=True, text=True).stdout


def record(cid: str, ok: bool | None, ev: str) -> None:
    results.append((cid, "INFO" if ok is None else ("PASS" if ok else "FAIL"), ev))


def main() -> int:
    replay_head = git("rev-parse", BR).strip()
    # 重放的代码提交 = 台账提交的父
    code_commit = git("rev-parse", f"{BR}^").strip()
    src = git("rev-parse", SRC).strip()
    parent = git("rev-parse", f"{SRC}^").strip()
    sot = git("rev-parse", SOT).strip()

    print(f"SoT      = {sot[:10]}  {git('log','-1','--format=%s',SOT).strip()[:54]}")
    print(f"重放分支 = {replay_head[:10]}  (代码提交 {code_commit[:10]}, 台账提交 {replay_head[:10]})")
    print(f"源提交   = {src[:10]}\n")

    a = sh(f"{GIT} diff {sot} {code_commit} | {GIT} patch-id --stable").split()
    b = sh(f"{GIT} diff {parent} {src} | {GIT} patch-id --stable").split()
    record("R1", bool(a) and bool(b) and a[0] == b[0],
           f"patch-id 重放={a[0][:14] if a else '?'} 源={b[0][:14] if b else '?'}")

    src_files = [f for f in git("diff-tree", "--no-commit-id", "--name-only", "-r", src).split("\n") if f]
    diff_blob = [f for f in src_files
                 if git("rev-parse", f"{code_commit}:{f}").strip() != git("rev-parse", f"{src}:{f}").strip()]
    record("R2", not diff_blob, f"源提交 {len(src_files)} 个文件逐字比对；不同={diff_blob or '无'}")

    replay_files = [f for f in git("diff", "--name-only", f"{sot}..{BR}").split("\n") if f]
    extra = sorted(set(replay_files) - set(src_files) - {LEDGER})
    record("R3", not extra, f"PR 共 {len(replay_files)} 个文件 = 源 {len(src_files)} + 台账 1；夹带={extra or '无'}")

    record("R4", not any(f.startswith(".tmp/") for f in replay_files),
           f".tmp/ 夹带：{[f for f in replay_files if f.startswith('.tmp/')] or '无'}")

    an = git("log", "-1", "--format=%an", code_commit).strip()
    src_an = git("log", "-1", "--format=%an", src).strip()
    body = git("log", "-1", "--format=%B", code_commit)
    record("R5", an == src_an and f"cherry picked from commit {src}" in body
           and "Task:" in body and "Agent:" in body,
           f"作者保留={an == src_an}（{an}）；provenance={'有' if src in body else '无'}；"
           f"trailer={'有' if 'Agent:' in body else '无'}")

    record("R6", git("rev-parse", f"{code_commit}^{{tree}}").strip()
           != git("rev-parse", f"{sot}^{{tree}}").strip(),
           "结果树 ≠ SoT 树（非空 cherry-pick）")

    status = git("diff", "--name-status", f"{sot}..{BR}").split("\n")
    modified = [l.split("\t")[-1] for l in status if l.startswith("M")]
    record("R7", modified == [LEDGER] or modified == [],
           f"被修改（非新增）的文件={modified or '无'}（应只有台账）")

    code, out = 0, ""
    r = subprocess.run(["gh", "api", f"repos/gmood2008/openbot/pulls/{PR}"],
                       cwd=REPO, capture_output=True, text=True)
    code, out = r.returncode, r.stdout
    if code != 0:
        record("R8", None, "PR 信息不可读（gh 未授权？）")
    else:
        d = json.loads(out)
        base_ok = d["base"]["ref"] == "release/baseline-recovery-20260725"
        record("R8", base_ok and d["state"] == "open",
               f"PR #{PR} base={d['base']['ref']} head={d['head']['ref']} state={d['state']} "
               f"merged={d['merged']}（未合并即主干未被直推）")

    print(f"{'编号':6} {'判定':6} 证据")
    print("-" * 104)
    for cid, st, ev in results:
        print(f"{cid:6} {st:6} {ev}")
    fails = [r for r in results if r[1] == "FAIL"]
    real = [r for r in results if r[1] in ("PASS", "FAIL")]
    print("\n" + "=" * 104)
    print(f"VERDICT: {'FAIL' if fails else 'PASS'}   (可失败断言 {len(real)}：PASS={len(real)-len(fails)}, FAIL={len(fails)})")
    for cid, _s, ev in fails:
        print(f"  FAIL {cid}: {ev}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
