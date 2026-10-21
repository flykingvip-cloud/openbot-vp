# 批次 7：任务表象单一真相

| 项   | 值                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| 日期 | 2026-10-21                                                                                                        |
| 仓库 | `flykingvip-cloud/openbot-vp`                                                                                     |
| 祖先 | 实现前 `git fetch origin main`，分支自 `origin/main` `6b170996036e1650764fcaad8d648ffa6a0dc554`（批次 6，PR #28） |
| 性质 | 全 bot 任务表象。不是某个机器人的 prompt 修改。                                                                   |
| 不做 | 不扩大 `submitForReview` / `self_advance` / accept / finalize。不开生产旗、不扩白名单。批次 8 不在本批。          |

用户看到的挂起序号以**会话挂起列表**为准。展示前与 `memory/task_ledger.json` 对账。对不上的行标「未入账」，不再问「第 3 条是不是某某」。

## 合同

1. **单一序号。** `reconcileTaskSurface` 按会话当前任务，再按挂起顺序编号。登记表里对得上的行带 ledger id；对不上的标「未入账」。只在登记表里、不在会话列表里的行不占序号。
2. **「只保留第 N 条」。** 按**刚才展示给用户的那份序号**执行。回执写明保留 id 和取消 id。登记表能写时，被取消且已入账的行记 `surface_disposition: "cancelled"`（状态改为 `paused`，避免再被当成活跃任务注入）。写失败时会话侧仍然取消，回执追加批次 6 的 `side_path_bypass: memory/task_ledger.json <code>`。不第二次追问。
3. **同一句重复。** 同一句清表指令再来一次，返回同一张回执，不按缩短后的列表重新解释序号。
4. **幽灵注入。** 心跳 / 恢复 / 非主线 ledger 注入带来源：`source=heartbeat`、`source=restore`、`source=ledger` 加 id。与当前用户句无关的非主线任务默认不注入。已绑定的主线任务保留。
5. **不因文件存在而关行。** 沿用批次 4 的只读对账。`ledgerIdsToCancel` 接受文件是否存在，但不据此增减取消集合。`autoClosedTaskIds` 仍为空。

「只保留第 N 条」和「现在挂着的任务有几个」不是新任务，不会把当前任务挂起后再换一条。

## 接入

| 位置 | 作用 |
| --- | --- |
| `src/agents/task-surface/surface.ts` | 对账、序号、回执、幽灵过滤 |
| `src/agents/task-surface/apply.ts` | 写会话挂起板和 ledger；写失败走旁路回执 |
| `src/auto-reply/reply/get-reply-run.ts` | 整句就是清表或问挂起列表时直接回执，不交给模型再问一遍 |
| `src/conversation-task/session-task-board.ts` | 这两类句子不触发任务切换 |
| `src/agents/pi-embedded-runner/run/rewrite-visible-reply.ts` | 模型仍追问序号时，改成同一张回执 |
| `src/agents/context-compiler/candidates.ts` | 非主线注入在有用户句时按相关性省略，并带来源 |
| `src/auto-reply/reply/restore-task-isolation.ts` | 恢复待核对行带来源；已取消行不再注入 |
| `src/infra/heartbeat-parked-notice.ts` | 心跳挂起通知标 `source=heartbeat` |
| `src/agents/turn-completion/contract.ts` | 导出 `formatSidePathBypassReceipt`，清表写失败复用批次 6 原文 |

## 怎么跑测试

```bash
pnpm exec vitest run \
  src/agents/task-surface/surface.test.ts \
  src/auto-reply/reply/restore-task-isolation.test.ts \
  src/auto-reply/reply/session-continuity.test.ts \
  src/gateway/server-methods/chat.restore.test.ts \
  src/conversation-task/session-task-board.test.ts \
  src/agents/context-compiler/group-task-stable-summary.test.ts
```

`src/agents/task-surface/surface.test.ts` 覆盖：

1. 会话列表与 ledger 不一致时，展示会话序号并标「未入账」，正文没有二次盘问。
2. 「只保留第三条」打在**已展示**的序号上；随后把挂起板顺序改掉，仍然保留原来的第 3 条。回执含保留 id 与取消 id。同一句再来一次，回执不变。
3. ledger 写入抛 `EACCES`：会话侧已取消，回执含 `side_path_bypass`，登记表文件不变，不再追问。
4. 文件存在不改变取消集合；没出现在会话序号里的 ledger 行保持 `active`。
5. 心跳 / 恢复注入的无关任务默认省略；留下的注入带来源和 id。

批次 4 恢复回归：`restore-task-isolation.test.ts`、`session-continuity.test.ts`、`chat.restore.test.ts`。
