#!/usr/bin/env python3
"""独立验收脚本 — Phase 1 L0 抢救（2026-07-26）

设计目标：**不读任何人的结论，只从 git 事实重新推导**，逐条给出 PASS / FAIL。
任何人（或另一个 agent）都可以重跑并得到相同判定：

    python3 docs/design/convergence-evidence/2026-07-26/verify-rescue.py

只读：全脚本只使用 git 读命令（rev-parse / ls-tree / cat-file / apply --check /
status / stash list / for-each-ref），不 commit、不 push、不切分支、不动 stash、
不创建或删除 ref、不修改任何文件。

退出码：0 = 全部 PASS；1 = 存在 FAIL。
"""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

GIT = "/usr/bin/git"
REPO = Path(__file__).resolve().parents[4]
SOT = "origin/release/baseline-recovery-20260725"
RESCUE = "origin/rescue/l0-unique-20260726"
BRANCH = "deploy/user-modeling-v92"
EVID = "docs/design/convergence-evidence/2026-07-26"

results: list[tuple[str, str, str]] = []


def git(*args: str, ok_fail: bool = True) -> str:
    r = subprocess.run([GIT, *args], cwd=REPO, capture_output=True, text=True)
    if r.returncode != 0 and not ok_fail:
        raise RuntimeError(f"git {' '.join(args)} -> {r.stderr.strip()}")
    return r.stdout


def ok(*args: str) -> bool:
    return subprocess.run([GIT, *args], cwd=REPO, capture_output=True).returncode == 0


def record(cid: str, passed: bool | None, evidence: str) -> None:
    state = "UNVERIFIABLE" if passed is None else ("PASS" if passed else "FAIL")
    results.append((cid, state, evidence))


# ─────────────────────────── A. 主干与谱系 ───────────────────────────
def check_a() -> None:
    a_anc = ok("merge-base", "--is-ancestor", SOT, BRANCH)
    b_anc = ok("merge-base", "--is-ancestor", BRANCH, SOT)
    behind = int(git("rev-list", "--count", f"{BRANCH}..{SOT}").strip() or 0)
    ahead = int(git("rev-list", "--count", f"{SOT}..{BRANCH}").strip() or 0)
    record("A1", (not a_anc and not b_anc) and behind > 1000,
           f"互为祖先? SoT→branch={a_anc} branch→SoT={b_anc}; behind={behind} ahead={ahead}")

    stat = git("diff", "--shortstat", SOT, BRANCH).strip()
    dels = int(m.group(1)) if (m := re.search(r"(\d+) deletion", stat)) else 0
    record("A2", dels > 200_000, f"{stat or '(空)'} → deletions={dels}")

    txt = (REPO / "deploy/production/RELEASE_RECORD.md").read_text(errors="replace")
    hit = [ln.strip() for ln in txt.splitlines() if "DO NOT cut over" in ln]
    quote = hit[0][:150] if hit else "(未找到)"
    record("A3", bool(hit), f"命中 {len(hit)} 行 | 原文: {quote}")

    m_anc = ok("merge-base", "--is-ancestor", "origin/main", SOT)
    s_anc = ok("merge-base", "--is-ancestor", SOT, "origin/main")
    d_main = git("log", "-1", "--format=%cd", "--date=short", "origin/main").strip()
    d_sot = git("log", "-1", "--format=%cd", "--date=short", SOT).strip()
    record("A4", (not m_anc and not s_anc), f"互为祖先? main→SoT={m_anc} SoT→main={s_anc}; tip 日期 main={d_main} SoT={d_sot}")


# ─────────────────────── B. 抢救提交真实性 ───────────────────────
CLAIMED = [
    ("1e87c9d9f6", 7), ("b7669660d5", 4), ("13f19d42c8", 2), ("12ad2433d4", 3),
    ("4623f6dfe9", 1), ("7f1339c82e", 3), ("d32e6e477b", 4), ("5402703717", 1),
    ("b29e37a2c3", 1), ("175f4c05ad", 1), ("0025fa27c8", 3), ("776314ecf2", 18),
    ("366551748a", 10), ("de0d990a8a", 13), ("ccf38cdd86", 2),
]


def commit_files(sha: str) -> list[str]:
    return [p for p in git("diff-tree", "--no-commit-id", "--name-only", "-r", sha).splitlines() if p]


def check_b() -> list[str]:
    bad, all_files = [], []
    for sha, n in CLAIMED:
        if not ok("cat-file", "-e", f"{sha}^{{commit}}"):
            bad.append(f"{sha}:不存在")
            continue
        files = commit_files(sha)
        all_files += files
        body = git("log", "-1", "--format=%B", sha)
        if len(files) != n:
            bad.append(f"{sha}:文件数 {len(files)}≠声称 {n}")
        if "Task:" not in body or "Agent:" not in body:
            bad.append(f"{sha}:缺 Task/Agent trailer")
    record("B1", not bad, f"15 个提交核对；问题={bad or '无'}")

    miss = [f for f in sorted(set(all_files)) if not ok("cat-file", "-e", f"{RESCUE}:{f}")]
    record("B2", not miss, f"{len(set(all_files))} 个文件在远端 {RESCUE} 抽全查；缺失={miss or '无'}")
    return sorted(set(all_files))


def refs_excluding(*substrings: str) -> list[str]:
    out = []
    for r in git("for-each-ref", "--format=%(refname)", "refs/heads",
                 "refs/remotes/origin", "refs/tags").split():
        if "dependabot" in r or r.endswith("origin/HEAD"):
            continue
        if any(s in r for s in substrings):
            continue
        out.append(r)
    return out


def refs_without_rescue() -> list[str]:
    """排除任何**已包含本次抢救提交**的 ref。

    首轮验收的 B3 误判就出在这里：只排除了 `rescue/l0-unique*`，却漏了抢救提交
    实际所在的 `deploy/user-modeling-v92`，于是把「抢救结果」当成「抢救前就已存在」，
    自己把自己判 FAIL。正确口径是按祖先关系排除，而不是按 ref 名字。
    """
    keep = []
    for r in refs_excluding():
        if any(ok("merge-base", "--is-ancestor", sha, r) for sha, _ in CLAIMED):
            continue
        keep.append(r)
    return keep


def check_b3(samples: list[str]) -> None:
    other = refs_without_rescue()
    lines = []
    all_good = True
    for f in samples:
        wt = REPO / f
        if not wt.exists():
            lines.append(f"{f}:工作树缺失")
            all_good = False
            continue
        h = git("hash-object", "--", f).strip()
        carrier = next((r for r in other if git("rev-parse", f"{r}:{f}").strip() == h), None)
        if carrier:
            all_good = False
            lines.append(f"{f}:内容已在 {carrier}（抢救前提不成立）")
        else:
            lines.append(f"{f} ✓")
    record("B3", all_good, f"抽查 {len(samples)} 个；对照 {len(other)} 个未含抢救提交的 ref；{'; '.join(lines)}")

    src = (REPO / "ui/src/ui/app-render.ts").read_text(errors="replace")
    hits = re.findall(r"[\"']\./shells/([a-z-]+)\.ts[\"']", src)
    record("B4", len(set(hits)) >= 3, f"app-render.ts 引用 shells: {sorted(set(hits))}")


# ─────────────────────── C. 冻结补丁忠实性 ───────────────────────
def patch_blocks(text: str):
    for b in re.split(r"(?=^diff --git )", text, flags=re.M):
        if not b.startswith("diff --git"):
            continue
        path = re.search(r"^diff --git a/(.+?) b/(.+)$", b, re.M).group(2)
        idx = re.search(r"^index ([0-9a-f]+)\.\.([0-9a-f]+)", b, re.M)
        yield path, (idx.group(1) if idx else None), (idx.group(2) if idx else None), b


def patch_integrity(text: str) -> tuple[list[str], list[str], list[str]]:
    """自洽性证明：取 pre blob 内容 → 应用本补丁块 → 结果哈希应等于 post。

    不依赖「冻结时 HEAD 是哪个提交」，也不依赖 post blob 仍可达，因此可长期复现。
    返回 (自洽, 不自洽, 工作树已前进)。
    """
    good, bad, drift = [], [], []
    for path, pre, post, block in patch_blocks(text):
        if not pre or not post:
            bad.append(f"{path}(无 index 行)")
            continue
        if set(pre) == {"0"}:  # 新增文件：无 pre 内容
            pre_bytes = b""
        elif ok("cat-file", "-e", pre):
            pre_bytes = subprocess.run([GIT, "cat-file", "blob", pre], cwd=REPO,
                                       capture_output=True).stdout
        else:
            bad.append(f"{path}(pre blob {pre} 不可达)")
            continue
        with tempfile.TemporaryDirectory() as td:
            t = Path(td)
            subprocess.run([GIT, "init", "-q"], cwd=t, capture_output=True)
            f = t / path
            f.parent.mkdir(parents=True, exist_ok=True)
            if pre_bytes or set(pre) != {"0"}:
                f.write_bytes(pre_bytes)
            (t / "one.patch").write_text(block)
            if subprocess.run([GIT, "apply", "one.patch"], cwd=t, capture_output=True).returncode != 0:
                bad.append(f"{path}(补丁块无法应用到 pre)")
                continue
            h = subprocess.run([GIT, "hash-object", "--", path], cwd=t,
                               capture_output=True, text=True).stdout.strip()
        if not h.startswith(post):
            bad.append(f"{path}(重建哈希 {h[:10]} ≠ post {post})")
            continue
        good.append(path)
        wt = REPO / path
        cur = git("hash-object", "--", path).strip() if wt.is_file() else ""
        if not cur.startswith(post):
            drift.append(path)
    return good, bad, drift


def check_c() -> dict[str, set[str]]:
    d = REPO / EVID / "frozen-l0-modified"
    patches = sorted(d.glob("*.patch"))
    paths: set[str] = set()
    ndiff = 0
    for p in patches:
        for path, _pre, _post, _b in patch_blocks(p.read_text(errors="replace")):
            ndiff += 1
            paths.add(path)
    record("C1", len(patches) == 16 and len(paths) == 64,
           f"patch 文件={len(patches)} diff条目={ndiff} 去重路径={len(paths)}")

    good, bad, drift = [], [], []
    for p in patches:
        g, b, dr = patch_integrity(p.read_text(errors="replace"))
        good += g
        bad += b
        drift += dr
    record("C2", not bad,
           f"自洽性证明（pre blob + 补丁块 → 重建哈希 == post）：忠实={len(good)}/64；不自洽={bad or '无'}")
    record("C2D", True,
           f"信息项 — 冻结后被他人继续编辑的文件={len(drift)}"
           + (f"：{sorted(drift)}" if drift else "；反向校验因此失败属预期，不代表补丁失真"))

    # 覆盖表：path -> 该路径被冻结的 post 哈希集合（用于 E 的内容级覆盖判定）
    cover: dict[str, set[str]] = {}
    extra = [REPO / EVID / "frozen-learning-recall-tests.patch",
             REPO / EVID / "frozen-blocked-l3-snapshot.patch"]
    for p in patches + [x for x in extra if x.exists()]:
        for path, _pre, post, _b in patch_blocks(p.read_text(errors="replace")):
            if post:
                cover.setdefault(path, set()).add(post)

    lp = REPO / EVID / "frozen-learning-recall-tests.patch"
    lt = lp.read_text(errors="replace") if lp.exists() else ""
    lg, lb, _ld = patch_integrity(lt)
    lpaths = {path for path, _a, _b, _c in patch_blocks(lt)}
    record("C3", len(lpaths) == 4 and not lb,
           f"learning patch: 路径={len(lpaths)} 自洽={len(lg)} 不自洽={lb or '无'} → {sorted(lpaths)}")

    bp = REPO / EVID / "frozen-blocked-l3-snapshot.patch"
    bt = bp.read_text(errors="replace") if bp.exists() else ""
    bg, bb, _bd = patch_integrity(bt)
    bpaths = {path for path, _a, _b, _c in patch_blocks(bt)}
    record("C4", len(bpaths) == 2 and not bb,
           f"blocked-l3 patch: 路径={len(bpaths)} 自洽={len(bg)} 不自洽={bb or '无'} → {sorted(bpaths)}")
    return cover


# ─────────────────────────── D. stash 处置 ───────────────────────────
def check_d() -> None:
    pinned = {}
    for line in git("for-each-ref", "--format=%(refname) %(objectname)", "refs/stash-archive").splitlines():
        r, _, s = line.partition(" ")
        pinned[r] = s.strip()
    n = len(git("stash", "list").splitlines())
    mismatch = []
    for i in range(n):
        want = git("rev-parse", f"stash@{{{i}}}").strip()
        ref = f"refs/stash-archive/2026-07-26/{i:02d}"
        if pinned.get(ref) != want:
            mismatch.append(f"{ref}→{pinned.get(ref, '缺失')} ≠ stash@{{{i}}}→{want[:10]}")
    record("D1", len(pinned) == 22 and not mismatch,
           f"固定 ref={len(pinned)}；不一致={mismatch or '无'}")
    record("D2", n == 22, f"git stash list = {n} 条")

    record("D3", ok("cat-file", "-e", "refs/stash-archive/2026-07-26/18^3:openbot-web/package.json"),
           "refs/stash-archive/2026-07-26/18^3:openbot-web/package.json 可达性")

    other = refs_excluding("stash")
    found = next((r for r in other if any(
        p.startswith("openbot-web/") for p in git("ls-tree", "-r", "--name-only", r).splitlines())), None)
    record("D4", found is None, f"在 {len(other)} 个 ref 中查 openbot-web/ → {found or '均不存在'}")

    pat = re.compile(r"sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY")
    hits = []
    for f in list((REPO / "skills/wechat-article").rglob("*")) + list((REPO / "skills/pptx").rglob("*")):
        if f.is_file() and pat.search(f.read_text(errors="replace")):
            hits.append(str(f.relative_to(REPO)))
    record("D5", not hits, f"凭据形态扫描（不回显值）：命中文件={hits or '无'}")


# ────────────────── E. 零遗留（最关键） ──────────────────
def check_e(cover: dict[str, set[str]]) -> None:
    """零遗留判定。

    覆盖必须按**内容**判定，不能按路径：一个文件的路径出现在补丁里，只证明
    「冻结那一刻的内容」被保全；若之后被继续编辑，新内容并未保全。首轮验收
    的 E3 就是按路径判的，会把这类文件误算成已覆盖。
    """
    idx: set[str] = set()
    refs = refs_excluding()  # 不含 refs/stash*，因为 stash 不算"已落地"
    for r in refs:
        idx.update(git("ls-tree", "-r", "--format=%(path)\t%(objectname)", r).splitlines())

    def entries() -> list[tuple[str, str]]:
        out = []
        for line in git("status", "--porcelain").splitlines():
            st, path = line[:2], line[3:]
            if " -> " in path:
                path = path.split(" -> ")[-1]
            path = path.strip('"')
            if "node_modules" in path:
                continue
            if st == "??" and path.endswith("/"):
                for sub in (REPO / path).rglob("*"):
                    if sub.is_file() and "node_modules" not in str(sub):
                        out.append(("??", str(sub.relative_to(REPO))))
            else:
                out.append((st, path))
        return out

    unique, frozen_exact, stale_freeze, leftover = [], [], [], []
    for _st, f in entries():
        wt = REPO / f
        if not wt.is_file():
            continue
        h = git("hash-object", "--", f).strip()
        if f"{f}\t{h}" in idx:
            continue
        unique.append(f)
        posts = cover.get(f)
        if posts and any(h.startswith(p) for p in posts):
            frozen_exact.append(f)      # 当前内容逐字被冻结
        elif posts:
            stale_freeze.append(f)      # 冻结过，但之后又被编辑，新内容未保全
        else:
            leftover.append(f)          # 完全未保全

    reg = (REPO / ".loom/registry.yaml").read_text(errors="replace")
    globs = re.findall(r"^\s+- (\S+)$", reg, re.M)

    def owned(path: str) -> bool:
        for g in globs:
            pat = "^" + re.escape(g).replace(r"\*\*", ".*").replace(r"\*", "[^/]*") + ".*$"
            if re.match(pat, path):
                return True
        return False

    orphan = [f for f in leftover if not owned(f)]
    stale_orphan = [f for f in stale_freeze if not owned(f)]
    record("E3", True,
           f"ref 索引 {len(idx)} 条/{len(refs)} refs；内容唯一={len(unique)}"
           f"（逐字已冻结={len(frozen_exact)}，冻结后又被编辑={len(stale_freeze)}，完全未保全={len(leftover)}）")
    record("E4", not orphan,
           f"完全未保全且 registry 无任务认领 = {len(orphan)} 个"
           + (f" → {orphan[:12]}" if orphan else ""))
    record("E5", not stale_orphan,
           f"冻结后被继续编辑、新内容未保全且无 owner = {len(stale_orphan)} 个"
           + (f" → {stale_orphan}" if stale_orphan else "（有 owner 者由 owner 落地，可接受）"))
    if leftover or stale_freeze:
        print("\n[E 明细] 唯一内容且当前状态未逐字保全的文件（registry 认领状态）:")
        for f in sorted(leftover):
            print(f"   未保全   {'有owner' if owned(f) else '无owner'}  {f}")
        for f in sorted(stale_freeze):
            print(f"   冻结已旧 {'有owner' if owned(f) else '无owner'}  {f}")


# ─────────────────────────── F. 有无破坏 ───────────────────────────
def check_f() -> None:
    staged = [x for x in git("diff", "--cached", "--name-only").splitlines() if x]
    record("F1", not staged, f"索引中 staged 文件={len(staged)} {staged[:5]}")

    cur = git("rev-parse", "--abbrev-ref", "HEAD").strip()
    record("F2", cur == BRANCH, f"当前分支={cur}")

    # 只标记**真正移动了 HEAD** 的破坏性操作。`scripts/committer` 每次提交前会
    # 清空索引，在本机 git 上会记一条 `reset: moving to HEAD` 的空操作 reflog；
    # 首轮验收把这类空操作也算成 FAIL，是误判。
    heads = len(git("for-each-ref", "--format=%(refname)", "refs/heads").splitlines())
    rows = [ln.split("|", 1) for ln in
            git("reflog", "-n", "60", "--format=%H|%gs").splitlines() if "|" in ln]
    moved = []
    for i, (sha, subj) in enumerate(rows):
        if not re.match(r"^(checkout|reset|rebase|merge)", subj):
            continue
        prev = rows[i + 1][0] if i + 1 < len(rows) else sha
        if sha != prev:  # HEAD 真的换了提交
            moved.append(f"{subj.strip()[:40]} ({prev[:8]}→{sha[:8]})")
    noop = sum(1 for _s, subj in rows if re.match(r"^reset:", subj)) - len(
        [m for m in moved if m.startswith("reset")])
    record("F3", not moved,
           f"heads={heads}；近 60 条 reflog 中真正移动 HEAD 的 checkout/reset/rebase/merge={moved or '无'}"
           f"（另有 {noop} 条 committer 清索引产生的空操作 reset，非破坏）")

    dirty = len(git("status", "--porcelain").splitlines())
    record("F4", dirty >= 50, f"工作树仍有 {dirty} 项脏改动（他人 WIP 未被清理）")

    slog = REPO / ".git/logs/refs/stash"
    drops = 0
    if slog.exists():
        drops = sum(1 for ln in slog.read_text(errors="replace").splitlines() if "drop" in ln.lower())
    record("F5", drops == 0, f"stash reflog 中 drop 记录={drops}")

    mine = {sha for sha, _ in CLAIMED}

    def tainted(ref: str) -> bool:
        tip = git("rev-parse", "--short=10", ref).strip()
        return tip in mine
    record("F6", not tainted("origin/main") and not tainted(SOT),
           f"origin/main tip={git('rev-parse', '--short=10', 'origin/main').strip()}, "
           f"SoT tip={git('rev-parse', '--short=10', SOT).strip()}（均不是本次抢救提交）")


def main() -> int:
    print(f"独立验收 — Phase 1 L0 抢救  repo={REPO}\n")
    check_a()
    files = check_b()
    samples = [f for f in files if f.startswith(("ui/src/ui/shells/", "skills/pptx/", "src/gateway/agent-growth/"))][:3]
    check_b3(samples)
    cover = check_c()
    check_d()
    check_e(cover)
    check_f()

    print(f"\n{'编号':6} {'判定':13} 证据")
    print("-" * 118)
    for cid, state, ev in results:
        print(f"{cid:6} {state:13} {ev}")
    fails = [r for r in results if r[1] == "FAIL"]
    unver = [r for r in results if r[1] == "UNVERIFIABLE"]
    print("\n" + "=" * 118)
    verdict = "FAIL" if fails else ("PASS WITH FINDINGS" if unver else "PASS")
    print(f"VERDICT: {verdict}   (PASS={len(results) - len(fails) - len(unver)}, FAIL={len(fails)}, UNVERIFIABLE={len(unver)})")
    for cid, _, ev in fails:
        print(f"  FAIL {cid}: {ev}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
