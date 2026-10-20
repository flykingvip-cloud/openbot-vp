#!/usr/bin/env python3
"""B7 重放验收（只读，可复现）

    python3 docs/design/convergence-evidence/2026-07-27/verify-replay-b7.py

除常规忠实性外，本批额外验证两件事：
  - `--exclude '.tmp/'` 只剔除新增路径，主干原本跟踪的 `.tmp/` 文件必须保留
  - P7 的结论：`.tmp/` 不在 `a038f5c113` 的冲突面上（剔除它不解除阻塞）
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

GIT = "/usr/bin/git"
REPO = Path(__file__).resolve().parents[4]
BASE = "origin/replay/b8-enterprise-channels"
BR = "origin/replay/b7-deliverable-preview-partial"
LEDGER = "deploy/production/BASELINE_RECOVERY_20260725.md"
PAIRS = [("881ef8777d", "UI: artifact sidebar deliverable save chip"),
         ("94d5210766", "Loom: classify preview-artifact")]
res: list[tuple[str, str, str]] = []


def git(*a: str) -> str:
    return subprocess.run([GIT, *a], cwd=REPO, capture_output=True, text=True).stdout


def blob(rev: str, p: str) -> str:
    r = subprocess.run([GIT, "rev-parse", "--verify", "--quiet", f"{rev}:{p}"],
                       cwd=REPO, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def rec(cid: str, ok: bool | None, ev: str) -> None:
    res.append((cid, "INFO" if ok is None else ("PASS" if ok else "FAIL"), ev))


def landed(frag: str) -> str:
    for line in git("log", "--format=%H %s", f"{BASE}..{BR}").split("\n"):
        if frag in line:
            return line.split()[0]
    return ""


def main() -> int:
    bad, pairs = [], []
    for src, frag in PAIRS:
        l = landed(frag)
        if not l:
            bad.append(f"{src} 未找到落地提交")
            continue
        pairs.append((src, l))
        for line in git("diff-tree", "--no-commit-id", "-r", "--name-status", src).split("\n"):
            if not line.strip():
                continue
            st, _, f = line.partition("\t")
            if st.startswith("A"):
                if blob(l, f) != blob(src, f):
                    bad.append(f"{l[:10]}:{f} 新增型 blob 不符")
            elif st.startswith("M"):
                added = [x[1:] for x in git("diff", f"{src}^", src, "--", f).split("\n")
                         if x.startswith("+") and not x.startswith("+++") and x[1:].strip()]
                got = git("show", f"{l}:{f}")
                miss = [x for x in added if x not in got]
                if miss:
                    bad.append(f"{l[:10]}:{f} 缺 {len(miss)}/{len(added)} 新增行")
    rec("W1", not bad, f"2 个重放的忠实性；问题={bad or '无'}")

    issues = []
    for src, l in pairs:
        body = git("log", "-1", "--format=%B", l)
        if git("log", "-1", "--format=%an", l).strip() != git("log", "-1", "--format=%an", src).strip():
            issues.append(f"{l[:10]} 作者不符")
        if f"cherry picked from commit {git('rev-parse', src).strip()}" not in body:
            issues.append(f"{l[:10]} 缺 provenance")
        if "Agent:" not in body or "Task:" not in body:
            issues.append(f"{l[:10]} 缺 trailer")
    rec("W2", not issues, f"作者/provenance/trailer；问题={issues or '无'}")

    srcf = set()
    for src, _ in PAIRS:
        srcf |= {x for x in git("diff-tree", "--no-commit-id", "--name-only", "-r", src).split("\n") if x}
    prf = {x for x in git("diff", "--name-only", f"{BASE}..{BR}").split("\n") if x}
    rec("W3", not sorted(prf - srcf - {LEDGER}),
        f"PR {len(prf)} 文件；夹带={sorted(prf - srcf - {LEDGER}) or '无'}")

    # --exclude 不得误删主干已跟踪的 .tmp/ 文件
    old_tmp = {x for x in git("ls-tree", "-r", "--name-only", BASE, "--", ".tmp/").split("\n") if x}
    new_tmp = {x for x in git("ls-tree", "-r", "--name-only", BR, "--", ".tmp/").split("\n") if x}
    rec("W4", old_tmp == new_tmp and len(old_tmp) == 2,
        f"主干已跟踪的 .tmp/ 文件：重放前 {len(old_tmp)} 个 / 后 {len(new_tmp)} 个，集合相同={old_tmp == new_tmp}")
    rec("W5", not any(x.startswith(".tmp/workspace-audit") for x in new_tmp),
        f"未引入审计 dump：{[x for x in new_tmp if 'workspace-audit' in x] or '无'}")

    # P7 结论复核：.tmp/ 不在 a038f5c113 的冲突面上
    r = subprocess.run([GIT, "merge-tree", "--write-tree",
                        "--merge-base=a038f5c113^", BASE, "a038f5c113"],
                       cwd=REPO, capture_output=True, text=True)
    conflict_lines = [l for l in r.stdout.split("\n") if "\t" in l]
    tmp_conflicts = [l for l in conflict_lines if "\t.tmp/" in l]
    rec("W6", r.returncode != 0 and not tmp_conflicts,
        f"a038f5c113 仍冲突={r.returncode != 0}；冲突项中 .tmp/ 占 {len(tmp_conflicts)}/{len(conflict_lines)}"
        f"（0 → 剔除 .tmp/ 不解除阻塞，P7 是错问题）")

    led = git("show", f"{BR}:{LEDGER}")
    rec("W7", "reconciliation dossier" in led and "0e7e2fc7ee" in led and "43a03037d1" in led,
        "台账已载入 B7 对账档案（含 Context lifecycle P1 与 Security P1.1 的缺口数）")

    r2 = subprocess.run(["gh", "api", "repos/gmood2008/openbot/pulls/119"], cwd=REPO,
                        capture_output=True, text=True)
    if r2.returncode == 0:
        d = json.loads(r2.stdout)
        rec("W8", not d["merged"] and d["base"]["ref"] == "replay/b8-enterprise-channels",
            f"PR #119 base={d['base']['ref']} merged={d['merged']}")
    else:
        rec("W8", None, "PR 不可读")

    print(f"{'编号':6} {'判定':6} 证据")
    print("-" * 110)
    for cid, s, ev in res:
        print(f"{cid:6} {s:6} {ev}")
    f = [x for x in res if x[1] == "FAIL"]
    real = [x for x in res if x[1] in ("PASS", "FAIL")]
    print("\n" + "=" * 110)
    print(f"VERDICT: {'FAIL' if f else 'PASS'}   (可失败断言 {len(real)}：PASS={len(real)-len(f)}, FAIL={len(f)})")
    for cid, _s, ev in f:
        print(f"  FAIL {cid}: {ev}")
    return 1 if f else 0


if __name__ == "__main__":
    raise SystemExit(main())
