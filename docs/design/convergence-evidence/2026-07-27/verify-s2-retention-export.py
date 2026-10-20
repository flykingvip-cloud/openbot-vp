#!/usr/bin/env python3
"""S2 验收（只读，可复现）

    python3 docs/design/convergence-evidence/2026-07-27/verify-s2-retention-export.py

这一批含**新写的接线代码**，所以验收比前几批更严：除了忠实性，还要核
  - 新 handler 引用的每个辅助函数在主干里真的存在
  - 主干原有的 18 个 conversations RPC 一个没少、没被改名
  - 三个注册面（handler / server-methods-list / method-scopes）都齐
  - 作用域授权落在正确的一档
  - 所有相对 import 可解析
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

GIT = "/usr/bin/git"
REPO = Path(__file__).resolve().parents[4]
BASE = "origin/replay/b7-subset-security"
BR = "origin/replay/b7-subset-retention-and-export"
SRC = "cursor-composer/collaboration-deliverable-v95"
res: list[tuple[str, str, str]] = []


def git(*a: str) -> str:
    return subprocess.run([GIT, *a], cwd=REPO, capture_output=True, text=True).stdout


def blob(rev: str, p: str) -> str:
    r = subprocess.run([GIT, "rev-parse", "--verify", "--quiet", f"{rev}:{p}"],
                       cwd=REPO, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def rec(cid: str, ok: bool | None, ev: str) -> None:
    res.append((cid, "INFO" if ok is None else ("PASS" if ok else "FAIL"), ev))


RPC = re.compile(r'^\s*"([a-zA-Z][\w.-]*\.[\w.-]+)":\s*async', re.M)


def main() -> int:
    conv_old = set(RPC.findall(git("show", f"{BASE}:src/gateway/server-methods/conversations.ts")))
    conv_new = set(RPC.findall(git("show", f"{BR}:src/gateway/server-methods/conversations.ts")))
    rec("X1", conv_old <= conv_new and conv_new - conv_old == {"conversations.exportTranscript"},
        f"conversations RPC：主干 {len(conv_old)} 个全部保留；新增={sorted(conv_new - conv_old)}；"
        f"丢失={sorted(conv_old - conv_new) or '无'}")

    gov_old = set(RPC.findall(git("show", f"{BASE}:src/gateway/server-methods/enterprise-memory-governance.ts")))
    gov_new = set(RPC.findall(git("show", f"{BR}:src/gateway/server-methods/enterprise-memory-governance.ts")))
    rec("X2", gov_old <= gov_new and gov_new - gov_old == {
        "enterprise-memory.governance.retention.get",
        "enterprise-memory.governance.retention.update"},
        f"governance RPC：新增={sorted(gov_new - gov_old)}；丢失={sorted(gov_old - gov_new) or '无'}")

    gov_txt = git("show", f"{BR}:src/gateway/server-methods/enterprise-memory-governance.ts")
    rec("X3", "CW2-P6-02" in gov_txt and "Fail closed: never include private" in gov_txt,
        "主干原有注释与 fail-closed 逻辑保留（未被 B7 版本整体覆盖）")

    # 新 handler 引用的辅助函数必须在主干存在
    conv_txt = git("show", f"{BR}:src/gateway/server-methods/conversations.ts")
    handler = conv_txt[conv_txt.index('"conversations.exportTranscript"'):]
    handler = handler[: handler.index('  "conversations.export"')]
    helpers = ["respondInvalid", "respondError", "loadConfig", "resolveCtx",
               "exportConversationTranscript"]
    used = [h for h in helpers if h in handler]
    undefined = [h for h in used if f"{h}" not in conv_txt.split(handler)[0]
                 and f"{h}" not in conv_txt.split(handler)[-1]]
    rec("X4", not undefined,
        f"新 handler 用到的辅助函数 {used}；文件内未定义/未导入={undefined or '无'}")

    # 三个注册面
    lst = git("show", f"{BR}:src/gateway/server-methods-list.ts")
    sc = git("show", f"{BR}:src/gateway/method-scopes.ts")
    need = ["conversations.exportTranscript",
            "enterprise-memory.governance.retention.get",
            "enterprise-memory.governance.retention.update"]
    rec("X5", all(f'"{n}"' in lst for n in need) and all(f'"{n}"' in sc for n in need),
        f"三个方法在 server-methods-list 与 method-scopes 中均已注册："
        f"{[n.split('.')[-1] for n in need]}")

    # 作用域分档：按行号落在哪个 scope 数组
    lines = sc.split("\n")
    marks = {}
    for i, ln in enumerate(lines):
        m = re.match(r"^  \[(\w+)\]:", ln)
        if m:
            marks[i] = m.group(1)
    def scope_of(name: str) -> str:
        for i, ln in enumerate(lines):
            if f'"{name}"' in ln:
                cur = "?"
                for j in sorted(marks):
                    if j < i:
                        cur = marks[j]
                return cur
        return "缺失"
    got = {n: scope_of(n) for n in need}
    want = {"conversations.exportTranscript": "WRITE_SCOPE",
            "enterprise-memory.governance.retention.get": "READ_SCOPE",
            "enterprise-memory.governance.retention.update": "WRITE_SCOPE"}
    rec("X6", got == want, f"作用域分档：{ {k.split('.')[-1]: v for k, v in got.items()} }（期望 WRITE/READ/WRITE）")

    # 新增文件与来源逐字相同
    adds = ["src/conversations/tenant-retention-config.ts", "src/conversations/retention-policy.ts",
            "src/conversations/conversation-export.ts", "src/conversations/conversation-export.test.ts"]
    bad = [p for p in adds if blob(BR, p) != blob(SRC, p)]
    rec("X7", not bad, f"4 个新增文件与来源分支 blob 逐字相同；不同={bad or '无'}")

    # 未引入 retention-enforcer / 未替换主干 conversations.ts
    rec("X8", not blob(BR, "src/conversations/retention-enforcer.ts"),
        "未引入 B7 的 retention-enforcer.ts（其 retention.scan 弱于主干）")

    # 相对 import 全解析
    def ex(p: str) -> bool:
        for c in (f"{p}.ts", f"{p}.tsx", f"{p}/index.ts", p):
            if blob(BR, c):
                return True
        return False
    changed = [f for f in git("diff", "--name-only", f"{BASE}..{BR}").split("\n") if f]
    unresolved = []
    for f in changed:
        for spec in set(re.findall(r'(?:from|import)\s+["\']([^"\']+)["\']', git("show", f"{BR}:{f}"))):
            if not spec.startswith("."):
                continue
            parts: list[str] = []
            for seg in (Path(f).parent / re.sub(r"\.(js|ts)$", "", spec)).as_posix().split("/"):
                if seg == "..":
                    if parts:
                        parts.pop()
                elif seg not in (".", ""):
                    parts.append(seg)
            if not ex("/".join(parts)):
                unresolved.append(f"{f} → {spec}")
    rec("X9", not unresolved, f"改动 {len(changed)} 个文件的相对 import 全解析；未解析={unresolved or '无'}")

    print(f"{'编号':6} {'判定':6} 证据")
    print("-" * 112)
    for cid, s, ev in res:
        print(f"{cid:6} {s:6} {ev}")
    f = [x for x in res if x[1] == "FAIL"]
    real = [x for x in res if x[1] in ("PASS", "FAIL")]
    print("\n" + "=" * 112)
    print(f"VERDICT: {'FAIL' if f else 'PASS'}   (可失败断言 {len(real)}：PASS={len(real)-len(f)}, FAIL={len(f)})")
    for cid, _s, ev in f:
        print(f"  FAIL {cid}: {ev}")
    return 1 if f else 0


if __name__ == "__main__":
    raise SystemExit(main())
