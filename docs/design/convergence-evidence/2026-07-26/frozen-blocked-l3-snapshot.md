# Frozen evidence: 被 landing-stream 阻塞的 L3 指针工具（2026-07-27）

**处置：** `freeze-evidence` —— **纯保险，不是落地**
**补丁：** `frozen-blocked-l3-snapshot.patch`（2 个新文件，561 行）
**来源：** 共享主树 `openbot`，分支 `deploy/user-modeling-v92` 未提交状态
**任务：** `local-worktree-consolidation`

## 为什么冻结

独立验收（`verify-rescue.py` 首轮）发现这 2 个文件是当时唯一「既不在任何 ref、
也不在任何冻结补丁、registry 亦无任务认领」的内容：

- `scripts/ops/l3-live-snapshot.ts`
- `scripts/__tests__/l3-live-snapshot.test.ts`

进一步核查发现**它们并非无主**：另一 agent 已在 `26a3d8b546`
（2026-07-27 10:27）提交 `docs/design/landing-stream-unblock-handoff-2026-07-27.md`，
诊断出同一阻塞并把解锁工单派给了 `kiro-loom`：

> 两者 UNMATCHED，守卫要求先给 disposition；两个 disposition 都在
> `scripts/worktree-audit.ts` 里，而该文件当前带着 `cursor-enterprise-model-gov`
> 的未提交 WIP（+390/−36），按 `AGENTS.md` 规则 2 只能由该文件的 task-owner 落地。

因此本次**不介入落地**（不改 `scripts/worktree-audit.ts`、不改 `.loom/registry.yaml`、
不代提交这两个文件），只把内容冻结成补丁作为保险，防止解锁工单排队期间被
`git checkout` / `git clean` 误清。

## 对 owner 的影响：零

- 两个文件仍以未跟踪状态留在工作树，`git status` 不变。
- 解锁路径不变：W1（registry owner 落地 `worktree-audit.ts` 的 WIP）→ W2（补
  disposition）→ 原作者按单一 stream 干净提交。
- 届时本补丁可直接丢弃，或用于比对内容有无漂移。

## 内容

| 文件                                         | 用途                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `scripts/ops/l3-live-snapshot.ts`            | 探测生产网关真实在线状态，重新生成 `deploy/production/RELEASE_RECORD.md` 的 L3 指针块 |
| `scripts/__tests__/l3-live-snapshot.test.ts` | 上述脚本的测试                                                                        |

该脚本的动因（引自其文件头）：2026-07-26 生产一天内切换 8 次，手写的
"Latest cutover" 指针九小时内两次过期，事故期间差点把恢复操作指向更旧的基线。

## 解冻

```bash
git apply docs/design/convergence-evidence/2026-07-26/frozen-blocked-l3-snapshot.patch
```

补丁生成时已通过 `git apply --check --reverse` 校验，与冻结时刻工作树逐字一致。
