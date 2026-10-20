#!/usr/bin/env python3
"""文件级子集重放的依赖闭包分析（只读）

    python3 docs/design/convergence-evidence/2026-07-27/subset-closure.py

为什么需要：B7 的取舍是**按功能挑文件**，不是整提交重放。纯加文件有两个坑：
  1. 加进来的文件 import 了主干没有的模块 → 构建直接断
  2. 加进来的文件没有任何主干文件引用它 → 死代码，功能并未真正接上

本脚本对每个选集做递归相对 import 闭包，并把每个依赖分三类：
  ON-TRUNK    主干已有，安全
  IN-SOURCE   主干没有，但在同一来源分支上能取到 → 必须一起加
  MISSING     两边都没有 → 阻塞项
另外报告每个新增文件是否被主干任何文件引用（是否需要接线）。
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

GIT = "/usr/bin/git"
REPO = Path(__file__).resolve().parents[4]
TRUNK = "origin/replay/b7-deliverable-preview-partial"
SRC_BRANCH = "cursor-composer/collaboration-deliverable-v95"

SELECTIONS: dict[str, list[str]] = {
    "S1 响应 DLP": [
        "src/gateway/response-dlp.ts",
        "src/gateway/response-dlp.test.ts",
    ],
    "S2 会话导出 + 租户留存配置 + 留存 UI": [
        "src/conversations/conversation-export.ts",
        "src/conversations/conversation-export.test.ts",
        "src/conversations/tenant-retention-config.ts",
        "ui/src/ui/ports/enterprise/views/enterprise-retention-policy-surface.ts",
        "ui/src/ui/ports/employee/views/employee-data-retention-summary-card.ts",
    ],
    "S3 群交付物预览链": [
        "src/gateway/knowledge/deliverables/save-and-archive.ts",
        "src/gateway/knowledge/deliverables/save-and-archive.test.ts",
        "src/gateway/server-methods/group-workspace-file.ts",
        "src/gateway/server-methods/group-workspace-file.pack.ts",
        "ui/src/ui/wiring/deliverable-save.ts",
        "ui/src/ui/wiring/deliverable-save.test.ts",
        "ui/src/ui/wiring/group-deliverable-preview-flow.ts",
        "ui/src/ui/views/artifact-sidebar-deliverable.test.ts",
        "ui/src/ui/app.group-deliverable-preview.node.test.ts",
    ],
    "S4 actor 作用域 + 隔离测试": [
        "src/gateway/actor-scope.ts",
        "src/gateway/actor-scope.test.ts",
        "src/gateway/server-methods/cross-tenant-task-memory.test.ts",
        "src/gateway/server-methods/rpc-tenant-scope.test.ts",
        "src/memory/query-atoms-acl.test.ts",
    ],
}

IMPORT_RE = re.compile(r"""(?:from|import)\s+["']([^"']+)["']""")


def git(*a: str) -> str:
    return subprocess.run([GIT, *a], cwd=REPO, capture_output=True, text=True).stdout


def blob(rev: str, path: str) -> str:
    r = subprocess.run([GIT, "rev-parse", "--verify", "--quiet", f"{rev}:{path}"],
                       cwd=REPO, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def read(rev: str, path: str) -> str:
    return git("show", f"{rev}:{path}")


def resolve(importer: str, spec: str) -> str | None:
    """把相对 import 解析成仓库路径（.js -> .ts）。非相对的一律视为外部包。"""
    if not spec.startswith("."):
        return None
    base = (Path(importer).parent / spec).as_posix()
    base = re.sub(r"\.js$", "", base)
    parts: list[str] = []
    for seg in base.split("/"):
        if seg == "..":
            if parts:
                parts.pop()
        elif seg not in (".", ""):
            parts.append(seg)
    stem = "/".join(parts)
    return stem


def exists_any(rev: str, stem: str) -> str | None:
    for cand in (f"{stem}.ts", f"{stem}.tsx", f"{stem}/index.ts", stem):
        if blob(rev, cand):
            return cand
    return None


def main() -> int:
    print(f"trunk = {git('rev-parse', '--short', TRUNK).strip()}   src = {SRC_BRANCH}\n")
    overall_missing = 0
    for name, seeds in SELECTIONS.items():
        print("=" * 104)
        print(f"## {name}   种子文件 {len(seeds)}")
        queue = list(seeds)
        seen: set[str] = set()
        extra_from_source: list[str] = []
        missing: list[str] = []
        on_trunk = 0
        while queue:
            f = queue.pop(0)
            if f in seen:
                continue
            seen.add(f)
            src_blob = blob(SRC_BRANCH, f)
            if not src_blob:
                missing.append(f"{f}（来源分支也没有）")
                continue
            for spec in set(IMPORT_RE.findall(read(SRC_BRANCH, f))):
                stem = resolve(f, spec)
                if not stem:
                    continue
                hit_trunk = exists_any(TRUNK, stem)
                if hit_trunk:
                    on_trunk += 1
                    continue
                hit_src = exists_any(SRC_BRANCH, stem)
                if hit_src:
                    if hit_src not in seeds and hit_src not in extra_from_source:
                        extra_from_source.append(hit_src)
                    queue.append(hit_src)
                else:
                    missing.append(f"{stem}（{f} 引用，两边都没有）")

        print(f"   相对 import 解析：主干已有 {on_trunk} 处")
        if extra_from_source:
            print(f"   **必须一起加的传递依赖 {len(extra_from_source)} 个：**")
            for f in extra_from_source:
                print(f"      {len(read(SRC_BRANCH, f).splitlines()):5}行  {f}")
        else:
            print("   传递依赖：无（种子文件自足）")
        if missing:
            overall_missing += len(missing)
            print(f"   **阻塞 {len(missing)} 项：**")
            for m in missing:
                print(f"      {m}")

        # 接线检查：主干是否有任何文件引用这些新增模块
        print("   --- 接线状态（主干是否已有引用者）---")
        for f in seeds + extra_from_source:
            if f.endswith(".test.ts") or ".test." in f:
                continue
            stem = Path(f).name.replace(".ts", "")
            hits = git("grep", "-l", "--", f"{stem}.js", TRUNK).strip().split("\n")
            hits = [h.split(":", 1)[-1] for h in hits if h.strip()]
            hits = [h for h in hits if h != f]
            print(f"      {'有引用者' if hits else '**无引用者（死代码，需接线）**':<28} {f}"
                  + (f"  ← {hits[:2]}" if hits else ""))
        print()
    print("=" * 104)
    print(f"合计阻塞项：{overall_missing}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
