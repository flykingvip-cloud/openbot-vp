#!/usr/bin/env python3
"""B5 / B8 重放验收（只读，可复现）

    python3 docs/design/convergence-evidence/2026-07-27/verify-replay-b5-b8.py

忠实性判据（前两批踩过坑后的定版）：
  - 新增型文件：结果 blob 必须与源逐字相同
  - 修改型文件：**不能比 blob** —— cherry-pick 应用的是 delta，基线动过时结果必然
    不同。改为核「源提交的每一行新增是否都出现在结果里」
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

GIT = "/usr/bin/git"
REPO = Path(__file__).resolve().parents[4]
B5 = ("origin/replay/b3-b4-import-ia-and-convergence-ledger", "origin/replay/b5-nginx-hsts-https-redirect")
B8 = ("origin/replay/b5-nginx-hsts-https-redirect", "origin/replay/b8-enterprise-channels")
LEDGER = "deploy/production/BASELINE_RECOVERY_20260725.md"
NGINX = [f"deploy/production/proxy/nginx/{h}.openbot.love.conf" for h in ("apex", "gw", "admin", "biz")]
res: list[tuple[str, str, str]] = []


def git(*a: str) -> str:
    return subprocess.run([GIT, *a], cwd=REPO, capture_output=True, text=True).stdout


def blob(rev: str, path: str) -> str:
    r = subprocess.run([GIT, "rev-parse", "--verify", "--quiet", f"{rev}:{path}"],
                       cwd=REPO, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def rec(cid: str, ok: bool | None, ev: str) -> None:
    res.append((cid, "INFO" if ok is None else ("PASS" if ok else "FAIL"), ev))


def fidelity(src: str, landed: str) -> list[str]:
    """返回不满足忠实性的说明列表（空 = 通过）。"""
    bad = []
    for line in git("diff-tree", "--no-commit-id", "-r", "--name-status", src).split("\n"):
        if not line.strip():
            continue
        st, _, f = line.partition("\t")
        if st.startswith("A"):
            if blob(landed, f) != blob(src, f):
                bad.append(f"{f}(新增型 blob 不符)")
        elif st.startswith("M"):
            added = [ln[1:] for ln in git("diff", f"{src}^", src, "--", f).split("\n")
                     if ln.startswith("+") and not ln.startswith("+++") and ln[1:].strip()]
            got = git("show", f"{landed}:{f}")
            miss = [ln for ln in added if ln not in got]
            if miss:
                bad.append(f"{f}(缺 {len(miss)}/{len(added)} 新增行)")
    return bad


def landed_for(base: str, br: str, subject_fragment: str) -> str:
    for line in git("log", "--format=%H %s", f"{base}..{br}").split("\n"):
        if subject_fragment in line:
            return line.split()[0]
    return ""


def main() -> int:
    # ── B5 ──
    b5_pairs = [("00006f8360", "ops(nginx): enable HSTS"), ("2a5d974531", "change-window")]
    bad, pairs5 = [], []
    for src, frag in b5_pairs:
        landed = landed_for(*B5, frag)
        if not landed:
            bad.append(f"{src} 未找到落地提交")
            continue
        pairs5.append((src, landed))
        bad += [f"{src}->{landed[:10]}: {x}" for x in fidelity(src, landed)]
    rec("V1", not bad, f"B5 两个重放的忠实性；问题={bad or '无'}")

    hs = {h: (git("show", f"{B5[1]}:{p}").count("Strict-Transport-Security"),
              git("show", f"{B5[1]}:{p}").count("return 308"))
          for h, p in zip(("apex", "gw", "admin", "biz"), NGINX)}
    rec("V2", all(v[0] >= 1 and v[1] >= 1 for v in hs.values()),
        f"四个 vhost 的 HSTS/308 状态：{hs}")

    trunk_hs = {h: (git("show", f"{B5[0]}:{p}").count("return 308")) for h, p in zip(("apex", "gw", "admin", "biz"), NGINX)}
    rec("V3", all(v == 0 for v in trunk_hs.values()),
        f"重放前主干四个 vhost 的 308 计数={trunk_hs}（全 0 → 这是真缺口，不是重复落地）")

    # ── B8 ──
    b8_pairs = [("880095ea0f", "Config: restore redacted SecretRef"),
                ("f5cd300911", "Proxy: canonicalize enterprise routes"),
                ("b763bc858f", "UI: style archive action groups"),
                ("5a625138cb", "UI: style create-seat email field hints"),
                ("7f6a642e8d", "Test: cover enterprise channel configuration")]
    bad8, pairs8 = [], []
    for src, frag in b8_pairs:
        landed = landed_for(*B8, frag)
        if not landed:
            bad8.append(f"{src} 未找到落地提交")
            continue
        pairs8.append((src, landed))
        bad8 += [f"{src}->{landed[:10]}: {x}" for x in fidelity(src, landed)]
    rec("V4", not bad8, f"B8 五个重放的忠实性；问题={bad8 or '无'}")

    # 作者 / provenance / trailer
    issues = []
    for src, landed in pairs5 + pairs8:
        body = git("log", "-1", "--format=%B", landed)
        if git("log", "-1", "--format=%an", landed).strip() != git("log", "-1", "--format=%an", src).strip():
            issues.append(f"{landed[:10]} 作者不符")
        if f"cherry picked from commit {git('rev-parse', src).strip()}" not in body:
            issues.append(f"{landed[:10]} 缺 provenance")
        if "Agent:" not in body or "Task:" not in body:
            issues.append(f"{landed[:10]} 缺 trailer")
    rec("V5", not issues, f"7 个重放的作者/provenance/trailer；问题={issues or '无'}")

    # 无夹带：两批 PR 的改动文件都应落在「源文件并集 + 台账」内
    for tag, (base, br), pairs in (("B5", B5, pairs5), ("B8", B8, pairs8)):
        srcf = set()
        for src, _ in pairs:
            srcf |= {x for x in git("diff-tree", "--no-commit-id", "--name-only", "-r", src).split("\n") if x}
        prf = {x for x in git("diff", "--name-only", f"{base}..{br}").split("\n") if x}
        extra = sorted(prf - srcf - {LEDGER})
        rec(f"V6-{tag}", not extra, f"{tag} PR {len(prf)} 文件；夹带={extra or '无'}")
        rec(f"V7-{tag}", not any(x.startswith(".tmp/") for x in prf), f"{tag} 无 .tmp/ 夹带")

    # 门禁脚本 v91 发现是否已写入台账
    led = git("show", f"{B8[1]}:{LEDGER}")
    rec("V8", "rc-amd64-v91" in led and "v120" in led,
        "台账已记录门禁脚本默认镜像停在 v91 而生产在 v120 的发现")

    # PR 状态
    st = []
    for n in (113, 117):
        r = subprocess.run(["gh", "api", f"repos/gmood2008/openbot/pulls/{n}"], cwd=REPO,
                           capture_output=True, text=True)
        if r.returncode == 0:
            d = json.loads(r.stdout)
            st.append(f"#{n} base={d['base']['ref'].split('/')[-1]} merged={d['merged']}")
    rec("V9", all("merged=False" in s for s in st) and len(st) == 2,
        f"PR 状态：{st}（未合并 → 主干未被直推）")

    print(f"{'编号':8} {'判定':6} 证据")
    print("-" * 110)
    for cid, s, ev in res:
        print(f"{cid:8} {s:6} {ev}")
    f = [x for x in res if x[1] == "FAIL"]
    real = [x for x in res if x[1] in ("PASS", "FAIL")]
    print("\n" + "=" * 110)
    print(f"VERDICT: {'FAIL' if f else 'PASS'}   (可失败断言 {len(real)}：PASS={len(real)-len(f)}, FAIL={len(f)})")
    for cid, _s, ev in f:
        print(f"  FAIL {cid}: {ev}")
    return 1 if f else 0


if __name__ == "__main__":
    raise SystemExit(main())
