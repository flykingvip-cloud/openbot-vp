#!/usr/bin/env python3
"""Phase 2 重放可行性实测 + 独立验收断言（v2，只读）

    python3 docs/design/convergence-evidence/2026-07-27/phase2-replay-audit.py

v2 按第三方验收（`acceptance-phase2-2026-07-27.md`）的 7 条意见重写。v1 的四个
实质缺陷及修法：

1. **分类按内容判据，不按路径前缀。** v1 把整个 `deploy/production/` 与
   `.loom/` 当"记录类不重放"，会丢掉生产 nginx HSTS/308 跳转、门禁脚本
   `verify-{delivery-alignment,forward-only}.sh`、以及 registry 治理数据。
   v2 只有「全部文件都是 `*.md`/`*.mdx` 且位于 docs/.kiro/deploy-production/
   CHANGELOG」才算记录类；`deploy/production/{proxy,scripts,*.yml,*.json5,
   Dockerfile*,env.*}` 与 `.loom/registry.yaml` 一律按运行时/治理数据重放。
2. **区分 NO-OP 与真干净。** merge-tree 退出码 0 只说明可合并；若结果树等于
   基线树，则该 cherry-pick 是空操作（真实 cherry-pick 会报 empty）。
3. **区分 SUPERSEDED 与真冲突。** 退出码非 0 但提交内所有文件 blob 已等于
   SoT，说明内容已在，属已被取代，不是待办工作。
4. **冲突数用顺序模拟。** 逐条独立模拟只能给上界；前序提交落地后，后续冲突
   常自动消失。v2 用 merge-tree + commit-tree 链式推进出真实数。

另加悬空引用检查：若某提交只是**修改**一个文件，而该文件在 SoT 不存在、
且创建它的提交不在重放集合里，则重放后会产生悬空引用。

只读边界：不建 worktree、不 cherry-pick、不 commit、不 push、不改任何文件与 ref。
顺序模拟会写入 loose object（merge-tree/commit-tree 的产物），不挂任何 ref，
可被 gc 回收。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

GIT = "/usr/bin/git"
REPO = Path(__file__).resolve().parents[4]
SOT = "origin/release/baseline-recovery-20260725"

BRANCHES = [
    "kiro/enterprise-ai-model-governance",
    "codex-favicon/web-favicon-branding",
    "convergence/2026-07-20",
    "kiro-web-ui/knowledge-workbench-import-ia",
    "wip/ops-nginx-hsts-https-redirect",
    "cursor-composer/collaboration-deliverable-v95",
    "codex-delivery-guard/delivery-alignment-guard",
    "codex/openbot-enterprise-channels-release",
]

# 被排除、需单独排期的大分支（v1 未量化，导致工作量数量级低估）
EXCLUDED = ["main", "deploy/user-modeling-v92", "origin/deploy/user-modeling-v92",
            "release/candidate-20260712"]

PROSE_ROOTS = ("docs/", ".kiro/", "deploy/production/")
results: list[tuple[str, str, str]] = []


def git(*a: str) -> str:
    return subprocess.run([GIT, *a], cwd=REPO, capture_output=True, text=True).stdout


def run(*a: str) -> tuple[int, str]:
    r = subprocess.run([GIT, *a], cwd=REPO, capture_output=True, text=True)
    return r.returncode, r.stdout


def record(cid: str, passed: bool | None, ev: str) -> None:
    state = "INFO" if passed is None else ("PASS" if passed else "FAIL")
    results.append((cid, state, ev))


def is_prose(path: str) -> bool:
    """只有 prose 文档才算记录类。运行时/配置/脚本/治理数据都不算。"""
    if path == "CHANGELOG.md":
        return True
    if not (path.endswith(".md") or path.endswith(".mdx")):
        return False
    return path.startswith(PROSE_ROOTS)


def files_of(c: str) -> list[str]:
    return [f for f in git("diff-tree", "--no-commit-id", "--name-only", "-r", c).split("\n") if f]


def is_superseded(c: str) -> bool:
    """提交内每个文件的最终 blob 是否都已等于 SoT（含删除：SoT 也无）。"""
    fs = files_of(c)
    if not fs:
        return False
    for f in fs:
        _, a = run("rev-parse", f"{c}:{f}")
        _, b = run("rev-parse", f"{SOT}:{f}")
        if a.strip() != b.strip():
            return False
    return True


def main() -> int:
    sot_tree = git("rev-parse", f"{SOT}^{{tree}}").strip()
    print(f"SoT = {git('rev-parse', '--short', SOT).strip()}  "
          f"{git('log', '-1', '--format=%cd %s', '--date=format:%m-%d %H:%M', SOT).strip()[:66]}")
    print(f"repo = {REPO}\n")

    tot = dict(commits=0, ledger=0, merge=0, code=0,
               replay_clean=0, noop=0, superseded=0, real_conflict=0)
    dangling: list[str] = []
    tmpdump: list[str] = []
    orphan_local: list[str] = []      # 无主 + 内容只在本地 → 真风险
    inflight_local: list[str] = []    # 有活跃 owner 的在途提交 → 监视，不代推
    created_in_set: set[str] = set()

    registry = (REPO / ".loom/registry.yaml").read_text(errors="replace")
    remote_refs = [r for r in git("for-each-ref", "--format=%(refname)",
                                  "refs/remotes/origin").split() if "dependabot" not in r]

    def unique_content(c: str) -> list[str]:
        """该提交里有哪些文件内容在所有远端 ref 中都找不到。"""
        out = []
        for f in files_of(c):
            h = git("rev-parse", f"{c}:{f}").strip()
            if not h:
                continue
            if not any(git("rev-parse", f"{r}:{f}").strip() == h for r in remote_refs):
                out.append(f)
        return out

    for b in BRANCHES:
        commits = git("rev-list", "--reverse", f"{SOT}..{b}").split()
        # 本地独有提交（不在任何远端 ref）里，真正带来唯一内容的部分
        for c in git("rev-list", b, "--not", "--remotes").split():
            uc = unique_content(c)
            if not uc:
                continue   # 合并提交或内容已在别处 → 非风险
            # 有活跃 registry 会话的分支 = 在途工作，由 owner 自行推送
            active = f"branch: {b}" in registry
            entry = f"{b}@{c[:10]} 唯一内容 {uc}"
            (inflight_local if active else orphan_local).append(entry)

        print(f"## {b}  独有={len(commits)}")
        if not commits:
            print("   ahead=0 → 已完全包含，可直接回收\n")
            continue


        virtual = git("rev-parse", SOT).strip()   # 顺序模拟的虚拟 tip
        vtree = sot_tree
        rows = []
        for c in commits:
            parents = git("rev-parse", f"{c}^@").split()
            fs = files_of(c)
            ledger = bool(fs) and all(is_prose(f) for f in fs)
            merge = len(parents) > 1
            kind = "记录" if ledger else ("合并" if merge else "代码")

            if any(f.startswith(".tmp/") for f in fs):
                tmpdump.append(f"{c[:10]} {sum(1 for f in fs if f.startswith('.tmp/'))} 个 .tmp/ 文件")

            if is_superseded(c):
                verdict = "已取代"
                tot["superseded"] += 1
            elif merge:
                verdict = "合并跳过"
            elif not parents:
                verdict = "无父跳过"
            else:
                code, out = run("merge-tree", "--write-tree", f"--merge-base={parents[0]}",
                                virtual, c)
                newtree = out.strip().split("\n")[0] if out.strip() else ""
                if code == 0 and newtree == vtree:
                    verdict = "空操作"
                    tot["noop"] += 1
                elif code == 0:
                    verdict = "可重放"
                    tot["replay_clean"] += 1
                    _, nv = run("commit-tree", newtree, "-p", virtual, "-m", f"sim {c[:10]}")
                    if nv.strip():
                        virtual, vtree = nv.strip(), newtree
                else:
                    verdict = "真冲突"
                    tot["real_conflict"] += 1

            # 悬空引用：只改不建的文件，SoT 无、且集合内也没人建
            if verdict in ("可重放", "真冲突"):
                for f in fs:
                    st = git("diff-tree", "--no-commit-id", "-r", "--name-status", c, "--", f)
                    if st.startswith("A"):
                        created_in_set.add(f)
            rows.append((c, kind, verdict, fs))
            tot["commits"] += 1
            tot["ledger" if ledger else ("merge" if merge else "code")] += 1

        for c, kind, verdict, fs in rows:
            print(f"     {verdict:6} {kind} {c[:10]} {git('log', '-1', '--format=%s', c).strip()[:58]}")
        print()

        # 该分支内：记录类提交若创建了非 prose 文件则本不该被排除（v1 的 BLOCKER）
        for c, kind, verdict, fs in rows:
            if kind == "记录":
                continue
            for f in fs:
                st = git("diff-tree", "--no-commit-id", "-r", "--name-status", c, "--", f)
                if st.startswith("M") and not git("rev-parse", f"{SOT}:{f}").strip() \
                        and f not in created_in_set:
                    dangling.append(f"{c[:10]} 修改了 SoT 不存在且集合内无人创建的 {f}")

    print("=" * 104)
    print(f"合计 {tot['commits']} 个独有提交")
    print(f"  分类：记录类 {tot['ledger']}（prose-only，只入台账） / "
          f"合并 {tot['merge']}（不 cherry-pick） / 代码+配置 {tot['code']}")
    print(f"  顺序模拟：可重放 {tot['replay_clean']} / 真冲突 {tot['real_conflict']} / "
          f"空操作 {tot['noop']} / 已取代 {tot['superseded']}")
    print()

    # ─────────── 断言（P4/P5 明确标为 INFO，不计入 PASS 数） ───────────
    # P1 只对「无主且内容只在本地」判 FAIL。活跃 owner 的在途提交由 owner 推送，
    # 代推会干扰其 amend/rebase；这类只作 INFO 监视（P1B）。
    record("P1", not orphan_local, f"无主且内容仅存本地：{orphan_local or '无'}")
    record("P1B", None, f"信息项 — 活跃 owner 在途未推送：{inflight_local or '无'}（监视，不代推）")

    old_main = "0536504b9e"
    carriers = [r for r in git("for-each-ref", "--format=%(refname)",
                              "refs/remotes/origin").split()
                if "dependabot" not in r
                and subprocess.run([GIT, "merge-base", "--is-ancestor", old_main, r],
                                   cwd=REPO, capture_output=True).returncode == 0]
    ff = subprocess.run([GIT, "merge-base", "--is-ancestor", old_main, "origin/main"],
                        cwd=REPO, capture_output=True).returncode == 0
    record("P2", len(carriers) >= 2,
           f"origin/main 强推后旧 tip {old_main} 是否仍为 origin/main 祖先={ff}；"
           f"远端承载 ref={len(carriers)} 个 → {[c.split('origin/')[-1] for c in carriers]}"
           f"（≥2 才算有冗余备份）")

    fs = git("rev-list", "--count", f"{SOT}..fix-scoped-package-templates").strip()
    record("P3", fs == "0", f"fix-scoped-package-templates ahead(SoT)={fs}（0 → 可回收）")

    record("P4", None,
           f"信息项 — 可重放 {tot['replay_clean']} / 真冲突 {tot['real_conflict']} / "
           f"空操作 {tot['noop']} / 已取代 {tot['superseded']}")

    ex = {}
    for b in EXCLUDED:
        n = git("rev-list", "--count", f"{SOT}..{b}").strip() or "0"
        code_n = sum(1 for c in git("rev-list", f"{SOT}..{b}").split()
                     if not all(is_prose(f) for f in files_of(c) or ["x"]))
        ex[b] = (n, code_n)
    record("P5", None,
           "信息项 — 被排除分支规模：" + "；".join(
               f"{b} ahead={v[0]}(非 prose {v[1]})" for b, v in ex.items()))

    record("P6", not dangling, f"悬空引用检查：{dangling or '无'}")
    record("P7", not tmpdump,
           f"重放集合是否夹带 .tmp/ 临时产物：{tmpdump or '无'}"
           f"（有则必须拆分提交，不得原样进 SoT）")

    print(f"{'编号':6} {'判定':13} 证据")
    print("-" * 104)
    for cid, state, ev in results:
        print(f"{cid:6} {state:13} {ev}")
    fails = [r for r in results if r[1] == "FAIL"]
    real = [r for r in results if r[1] in ("PASS", "FAIL")]
    print("\n" + "=" * 104)
    print(f"VERDICT: {'FAIL' if fails else 'PASS'}   "
          f"(可失败断言 {len(real)} 条：PASS={len(real) - len(fails)}, FAIL={len(fails)}；"
          f"另有 {len(results) - len(real)} 条信息项不计入)")
    for cid, _s, ev in fails:
        print(f"  FAIL {cid}: {ev}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
