# Frozen evidence: learning-recall tests (2026-07-26)

**Disposition:** `freeze-evidence`（`convergence-base-decision-2026-07-20.md` § Dirty-file policy
的未认领路径默认处置）
**Patch:** `frozen-learning-recall-tests.patch`（4 个新文件，含 binary-safe 头）
**来源:** 共享主树 `openbot` 未提交状态（分支 `deploy/user-modeling-v92`）
**任务:** `local-worktree-consolidation`

## 为什么冻结而不是直接提交

这 4 个文件在全工作区唯一（任何本地/远端分支都不含它们），属于必须抢救的 L0 资产；
但 `pnpm worktree:audit --cached --fail-on-unmatched` 判定它们 **UNMATCHED** ——
`.loom/registry.yaml` 的 `landingStreams` 中没有任何 stream 覆盖
`src/auto-reply/reply/learning-*`。

给它们补 landing stream 需要：

1. 在 `scripts/worktree-audit.ts` 的规则表新增一条 rule，然后
2. 跑 `loom import` 由规则表重建 `.loom/registry.yaml` 的 `landingStreams`。

而这两个文件当时都带着**其他 agent 的未提交改动**（`.loom/registry.yaml` 有 353 行 WIP），
`loom import` 会整体重写 registry 并覆盖那些改动。因此本次不改门禁定义，改为冻结成证据。

## 冻结内容

| 文件                                                             | 说明                        |
| ---------------------------------------------------------------- | --------------------------- |
| `src/auto-reply/reply/learning-recall.test.ts`                   | `learning-recall.ts` 的单测 |
| `src/auto-reply/reply/learning-evolution.e2e.test.ts`            | learning 演进 e2e           |
| `src/auto-reply/reply/learning-recall-cross-process.e2e.test.ts` | 跨进程召回 e2e              |
| `src/auto-reply/reply/__fixtures__/learning-reuse-worker.mjs`    | 上述 e2e 的 worker fixture  |

被测实现（`learning-recall.ts`、`learning-skill-curation.ts`、`experience-capsule-backflow.ts`）
已在分支 `cursor-main-recovery/main-recovery-routing` 上，owner 为 `cursor-main-recovery`。

## 解冻步骤（由 stream owner 执行）

```bash
# 1. 给这些路径补一条 landing stream（需在 registry 干净时做）
#    scripts/worktree-audit.ts 新增 rule → pnpm loom import → 校验
# 2. 应用补丁
git apply docs/design/convergence-evidence/2026-07-26/frozen-learning-recall-tests.patch
# 3. 按正常分组提交（此时 audit 不再报 UNMATCHED）
```

同批仍未认领、需要同样处置的路径（本次未冻结，实现体已在 MRR 分支上）：

- `src/auto-reply/reply/experience-capsule-backflow.ts`
- `src/auto-reply/reply/learning-recall-context.ts`
- `src/auto-reply/reply/learning-recall.ts`
- `src/auto-reply/reply/learning-skill-curation.ts`
- `src/gateway/enterprise-model/**`
