#!/usr/bin/env python3
"""护栏验收（只读，可复现）

    python3 docs/design/convergence-evidence/2026-07-27/verify-guardrails.py

验证 2026-07-27 装上的主干护栏仍然有效。任何人（或任何 agent）都可重跑；
退出码非 0 表示有护栏失效。

只读：只做 GET（`gh api`）与本地文件/git 读取。不改 ruleset、不推送、不改文件。
唯一的写操作风险为零 —— 全程没有 POST/PUT/DELETE，也没有 git push。

为什么需要它：ruleset 可以被人在网页上关掉、hook 可以被删掉或改成非可执行。
护栏必须可被持续核验，否则「装过」不等于「还在」。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO_SLUG = "gmood2008/openbot"
REPO = Path(__file__).resolve().parents[4]
GIT = "/usr/bin/git"

EXPECTED = {
    "protect-trunk-no-force-push": {
        "rules": {"non_fast_forward", "deletion"},
        "include": {"refs/heads/main", "refs/heads/release/**", "refs/heads/backup/**"},
    },
    "protect-deploy-no-deletion": {
        "rules": {"deletion"},
        "include": {"refs/heads/deploy/**"},
    },
}

results: list[tuple[str, str, str]] = []


def record(cid: str, passed: bool | None, ev: str) -> None:
    results.append((cid, "INFO" if passed is None else ("PASS" if passed else "FAIL"), ev))


def gh(*args: str) -> tuple[int, str]:
    r = subprocess.run(["gh", *args], cwd=REPO, capture_output=True, text=True)
    return r.returncode, r.stdout


def git(*args: str) -> str:
    return subprocess.run([GIT, *args], cwd=REPO, capture_output=True, text=True).stdout


def main() -> int:
    # ── G1/G2: 服务端 ruleset 仍处于 active 且规则未被削弱 ──
    code, out = gh("api", f"repos/{REPO_SLUG}/rulesets")
    if code != 0:
        record("G1", False, f"无法读取 rulesets（gh api 失败）：{out[:120]}")
        record("G2", False, "跳过：ruleset 列表不可读")
    else:
        listing = json.loads(out or "[]")
        by_name = {r["name"]: r for r in listing}
        missing = [n for n in EXPECTED if n not in by_name]
        record("G1", not missing,
               f"预期 {len(EXPECTED)} 个 ruleset，实际找到 {len(by_name)}；缺失={missing or '无'}")

        problems = []
        for name, want in EXPECTED.items():
            r = by_name.get(name)
            if not r:
                continue
            c2, detail = gh("api", f"repos/{REPO_SLUG}/rulesets/{r['id']}")
            if c2 != 0:
                problems.append(f"{name}: 详情不可读")
                continue
            d = json.loads(detail)
            got_rules = {x["type"] for x in d.get("rules", [])}
            got_inc = set(d.get("conditions", {}).get("ref_name", {}).get("include", []))
            if d.get("enforcement") != "active":
                problems.append(f"{name}: enforcement={d.get('enforcement')}（应为 active）")
            if not want["rules"] <= got_rules:
                problems.append(f"{name}: 规则缺失 {sorted(want['rules'] - got_rules)}")
            if not want["include"] <= got_inc:
                problems.append(f"{name}: 覆盖缺失 {sorted(want['include'] - got_inc)}")
            if d.get("bypass_actors"):
                problems.append(f"{name}: 出现 bypass_actors {len(d['bypass_actors'])} 个"
                                f"（应为空，否则 owner 可绕过）")
        record("G2", not problems, f"ruleset 完整性：{problems or '全部 active、规则与覆盖齐全、无 bypass'}")

    # ── G3: 客户端 hook 存在、可执行、且 git 记录为 755 ──
    hooks_path = git("config", "core.hooksPath").strip()
    issues = []
    if hooks_path != "git-hooks":
        issues.append(f"core.hooksPath={hooks_path or '(未设置)'}（应为 git-hooks）")
    for h in ("pre-push", "commit-msg", "pre-commit"):
        p = REPO / "git-hooks" / h
        if not p.exists():
            issues.append(f"{h} 缺失")
            continue
        if not os.access(p, os.X_OK):
            issues.append(f"{h} 无执行权限")
        mode = git("ls-files", "-s", f"git-hooks/{h}").split()
        if mode and mode[0] != "100755":
            issues.append(f"{h} 在 git 中记录为 {mode[0]}（应为 100755）")
    record("G3", not issues, f"客户端 hook：{issues or 'pre-push / commit-msg / pre-commit 均在位且 755'}")

    # ── G4: hook 语法可解析（防止提交了会崩溃的 hook 而拦住所有人）──
    broken = [h for h in ("pre-push", "commit-msg")
              if subprocess.run(["bash", "-n", str(REPO / "git-hooks" / h)],
                                capture_output=True).returncode != 0]
    record("G4", not broken, f"hook 语法检查（bash -n）：{broken or '通过'}")

    # ── G5: 无「变量名紧跟多字节字符」写法（bash 3.2 会吞字节导致 hook 崩溃）──
    pat = re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*(?=[^\x00-\x7f])")
    risky = []
    for h in ("pre-push", "commit-msg"):
        for i, line in enumerate((REPO / "git-hooks" / h).read_text().split("\n"), 1):
            for m in pat.finditer(line):
                risky.append(f"{h}:{i} {m.group(0)}")
    record("G5", not risky,
           f"多字节紧邻变量写法：{risky or '无'}（有则 macOS bash 3.2 下 hook 会崩溃并拦住所有 push）")

    # ── G6: .tmp/ 已被忽略，且已跟踪文件未受影响 ──
    ignored = subprocess.run([GIT, "check-ignore", "-q", ".tmp/probe/x"],
                             cwd=REPO, capture_output=True).returncode == 0
    tracked = len([x for x in git("ls-files", ".tmp/").split("\n") if x])
    record("G6", ignored, f".tmp/ 被忽略={ignored}；其中仍被跟踪的文件={tracked} 个（gitignore 不影响已跟踪文件）")

    # ── G7: 强推备份 ref 仍在远端 ──
    old_main = "0536504b9e"
    carriers = [ln.split()[-1] for ln in
                git("ls-remote", "origin", "refs/heads/backup/*").split("\n") if ln.strip()]
    has_backup = any("main-pre-forcepush-20260727" in c for c in carriers)
    record("G7", has_backup,
           f"强推备份 backup/main-pre-forcepush-20260727 在远端={has_backup}"
           f"（承载旧 main tip {old_main}）")

    # ── G8: RELEASE_RECORD 已记录主干与强推事件 ──
    rr = (REPO / "deploy/production/RELEASE_RECORD.md").read_text(errors="replace")
    need = ["Single trunk", "0536504b9e", "protect-trunk-no-force-push"]
    absent = [n for n in need if n not in rr]
    record("G8", not absent, f"RELEASE_RECORD.md 缺失关键记录：{absent or '无（主干声明 + 强推 SHA + 护栏均已记录）'}")

    print(f"{'编号':6} {'判定':6} 证据")
    print("-" * 104)
    for cid, state, ev in results:
        print(f"{cid:6} {state:6} {ev}")
    fails = [r for r in results if r[1] == "FAIL"]
    real = [r for r in results if r[1] in ("PASS", "FAIL")]
    print("\n" + "=" * 104)
    print(f"VERDICT: {'FAIL' if fails else 'PASS'}   "
          f"(可失败断言 {len(real)}：PASS={len(real) - len(fails)}, FAIL={len(fails)})")
    for cid, _s, ev in fails:
        print(f"  FAIL {cid}: {ev}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
