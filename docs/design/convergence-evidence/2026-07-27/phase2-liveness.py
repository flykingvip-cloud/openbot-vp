#!/usr/bin/env python3
"""重放前的活跃度判定（只读）。每批开工前必跑。

    python3 docs/design/convergence-evidence/2026-07-27/phase2-liveness.py

为什么需要：`phase2-replay-sheet.md` 首版假设这些分支的 owner 都已收工。实测发现
B1 在 90 分钟前还在提交（且缺口从 1 涨到 10），B6 的 owner 已自行把缺口从 23 降到 1。
代为 cherry-pick 在途分支会与 owner 的后续提交重复落地，并剥夺其整合审查权
（`AGENTS.md` §2「contributors signal, they do not land」）。

判定：满足任一条即 owner-led，收敛方不得代为重放
  - `.loom/registry.yaml` 中有绑定该分支的 active 会话
  - 最近一次提交在 24 小时内
"""

from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

GIT = "/usr/bin/git"
REPO = Path(__file__).resolve().parents[4]
SOT = "origin/release/baseline-recovery-20260725"
FRESH_HOURS = 24

BRANCHES = [
    ("B1", "kiro/enterprise-ai-model-governance"),
    ("B2", "codex-favicon/web-favicon-branding"),
    ("B3", "convergence/2026-07-20"),
    ("B4", "kiro-web-ui/knowledge-workbench-import-ia"),
    ("B5", "wip/ops-nginx-hsts-https-redirect"),
    ("B6", "codex-delivery-guard/delivery-alignment-guard"),
    ("B7", "cursor-composer/collaboration-deliverable-v95"),
    ("B8", "codex/openbot-enterprise-channels-release"),
]


def git(*a: str) -> str:
    return subprocess.run([GIT, *a], cwd=REPO, capture_output=True, text=True).stdout


def main() -> int:
    reg = (REPO / ".loom/registry.yaml").read_text(errors="replace")
    now = time.time()
    print(f"SoT = {git('rev-parse', '--short', SOT).strip()}  "
          f"{git('log', '-1', '--format=%cd', '--date=format:%m-%d %H:%M', SOT).strip()}\n")
    print(f"{'批':4} {'分支':50} {'ahead':>5} {'最后提交':>12} {'小时前':>7} {'session':>8}  判定")
    print("-" * 122)
    live, dormant, done = [], [], []
    for tag, b in BRANCHES:
        if not git("rev-parse", "--verify", b).strip():
            print(f"{tag:4} {b:50} {'—':>5} {'(不存在)':>12}")
            continue
        ahead = int(git("rev-list", "--count", f"{SOT}..{b}").strip() or 0)
        ct = git("log", "-1", "--format=%ct", b).strip()
        age = (now - int(ct)) / 3600 if ct else 1e9
        date = git("log", "-1", "--format=%cd", "--date=format:%m-%d %H:%M", b).strip()
        active = any(
            ("status: active" in reg[max(0, m.start() - 1200):m.end() + 400]
             or "state: active" in reg[max(0, m.start() - 1200):m.end() + 400])
            for m in re.finditer(r"branch:\s*" + re.escape(b) + r"\s*$", reg, re.M)
        )
        if ahead == 0:
            verdict, bucket = "已完全并入 → 可回收目录", done
        elif active or age < FRESH_HOURS:
            verdict, bucket = "OWNER 在途 → 不代为重放", live
        else:
            verdict, bucket = "休眠 → 可重放", dormant
        bucket.append(tag)
        print(f"{tag:4} {b:50} {ahead:5} {date:>12} {age:7.1f} "
              f"{'active' if active else '-':>8}  {verdict}")

    print("\n" + "=" * 122)
    print(f"可重放（休眠）: {dormant or '无'}")
    print(f"owner 在途，跳过: {live or '无'}")
    print(f"已并入，可回收目录: {done or '无'}")
    print("\n提醒：本判定是时点快照。owner 随时可能重新开工 —— 每批开工前重跑，不要沿用旧结论。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
