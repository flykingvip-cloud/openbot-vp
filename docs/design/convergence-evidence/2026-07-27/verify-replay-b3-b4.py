#!/usr/bin/env python3
"""B3/B4 重放验收（只读，可复现）

    python3 docs/design/convergence-evidence/2026-07-27/verify-replay-b3-b4.py

验收 PR #109（B4 的 8 个重放提交 + B3/B4 的台账登记）。

方法论纠正（首轮此脚本判 FAIL，是脚本自己错了）：
S2 最初对源提交的**所有**文件比对 blob 全等，结果 10 个文件报不同。这是错的判据 ——
cherry-pick 应用的是同一个 **delta**，落在不同基线上，**修改型**文件的结果 blob
必然与源不同。blob 全等只对**新增型**文件成立（B2 全是新增，所以那批过了）。
现改为：新增型比 blob，修改型交由 S1 的 delta `patch-id` 覆盖。
"""
import json
import subprocess
from pathlib import Path

GIT = "/usr/bin/git"
REPO = Path("/Users/daniel/AI项目/openbot")
BASE = "origin/replay/b2-web-favicon-branding"
BR = "origin/replay/b3-b4-import-ia-and-convergence-ledger"
LEDGER = "deploy/production/BASELINE_RECOVERY_20260725.md"
PAIRS = [("6c15798995", "63c07d0f34"), ("4e658062f4", "82b201dd7e"), ("a9e8fcfda0", "c0e62d0d01"),
         ("650682e1b7", "c521cbcdd0"), ("1605c6e141", "9558b30426"), ("7fcd19bfd9", "20e368c687"),
         ("2d38ad817c", "99390c3554"), ("f619316a74", "e3c7ab3dce")]
res = []


def git(*a):
    return subprocess.run([GIT, *a], cwd=REPO, capture_output=True, text=True).stdout


def sh(c):
    return subprocess.run(["bash", "-c", c], cwd=REPO, capture_output=True, text=True).stdout


def rec(cid, ok, ev):
    res.append((cid, "INFO" if ok is None else ("PASS" if ok else "FAIL"), ev))


# S1 每对 patch-id 等价
bad = []
for src, landed in PAIRS:
    a = sh(f"{GIT} diff {landed}^ {landed} | {GIT} patch-id --stable").split()
    b = sh(f"{GIT} diff {src}^ {src} | {GIT} patch-id --stable").split()
    if not (a and b and a[0] == b[0]):
        bad.append(f"{src}->{landed}")
rec("S1", not bad, f"8 对提交 patch-id 等价性；不等={bad or '无'}")

# S2 仅对「源提交新增的文件」比对 blob 全等。
# 修改型文件的结果 blob 必然与源不同 —— cherry-pick 应用的是同一个 delta，
# 落在不同基线上必然产出不同结果；那部分由 S1 的 delta patch-id 覆盖。
mism, added_n, mod_n = [], 0, 0
for src, landed in PAIRS:
    for line in git("diff-tree", "--no-commit-id", "-r", "--name-status", src).split("\n"):
        if not line.strip():
            continue
        st, _, f = line.partition("\t")
        if st.startswith("A"):
            added_n += 1
            if git("rev-parse", f"{landed}:{f}").strip() != git("rev-parse", f"{src}:{f}").strip():
                mism.append(f"{landed[:10]}:{f}")
        else:
            mod_n += 1
rec("S2", not mism,
    f"新增型文件 {added_n} 个 blob 全等；不同={mism or '无'}"
    f"（另有 {mod_n} 个修改型文件，其结果 blob 本应不同，由 S1 覆盖）")

# S3 无夹带：PR 改动文件 = 8 个源提交文件并集 + 台账
src_files = set()
for src, _ in PAIRS:
    src_files |= {x for x in git("diff-tree", "--no-commit-id", "--name-only", "-r", src).split("\n") if x}
pr_files = {x for x in git("diff", "--name-only", f"{BASE}..{BR}").split("\n") if x}
extra = sorted(pr_files - src_files - {LEDGER})
rec("S3", not extra, f"PR {len(pr_files)} 文件；夹带={extra or '无'}")

# S4 无 .tmp/
rec("S4", not any(f.startswith(".tmp/") for f in pr_files), "无 .tmp/ 夹带")

# S5 作者与 provenance 保留
issues = []
for src, landed in PAIRS:
    body = git("log", "-1", "--format=%B", landed)
    if git("log", "-1", "--format=%an", landed).strip() != git("log", "-1", "--format=%an", src).strip():
        issues.append(f"{landed[:10]} 作者不符")
    if f"cherry picked from commit {git('rev-parse', src).strip()}" not in body:
        issues.append(f"{landed[:10]} 缺 provenance")
    if "Agent:" not in body or "Task:" not in body:
        issues.append(f"{landed[:10]} 缺 trailer")
rec("S5", not issues, f"作者/provenance/trailer；问题={issues or '无'}")

# S6 台账行数与判定分布
led = git("show", f"{BR}:{LEDGER}")
rows = [l for l in led.split("\n") if l.startswith("| B3 |") or l.startswith("| B4 |")]
rep = sum(1 for r in rows if "**REPLAY**" in r)
sup = sum(1 for r in rows if "**SUPERSEDED**" in r)
ldo = sum(1 for r in rows if "LEDGER-ONLY" in r)
rec("S6", (rep, sup, ldo) == (8, 1, 4), f"台账行 {len(rows)}：REPLAY={rep} SUPERSEDED={sup} LEDGER-ONLY={ldo}（期望 8/1/4）")

# S7 台账里每个 REPLAY 行的落地 SHA 确实在本分支上
missing = [s for s, l in PAIRS if f"`{l}`" not in led]
rec("S7", not missing, f"台账落地 SHA 齐全；缺={missing or '无'}")

# S8 PR 状态：堆叠且未合并
r = subprocess.run(["gh", "api", "repos/gmood2008/openbot/pulls/109"], cwd=REPO,
                   capture_output=True, text=True)
if r.returncode == 0:
    d = json.loads(r.stdout)
    rec("S8", d["base"]["ref"] == "replay/b2-web-favicon-branding" and not d["merged"],
        f"PR #109 base={d['base']['ref']} merged={d['merged']}（堆叠于 #106，主干未直推）")
else:
    rec("S8", None, "PR 不可读")

print(f"{'编号':6} {'判定':6} 证据")
print("-" * 104)
for cid, st, ev in res:
    print(f"{cid:6} {st:6} {ev}")
f = [x for x in res if x[1] == "FAIL"]
real = [x for x in res if x[1] in ("PASS", "FAIL")]
print("\n" + "=" * 104)
print(f"VERDICT: {'FAIL' if f else 'PASS'}   (可失败断言 {len(real)}：PASS={len(real)-len(f)}, FAIL={len(f)})")
for cid, _s, ev in f:
    print(f"  FAIL {cid}: {ev}")
