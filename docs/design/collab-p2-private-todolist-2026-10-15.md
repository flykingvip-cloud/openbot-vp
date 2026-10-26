# Collaboration P2 — 私有 Todolist + 计划门禁（2026-10-15）

> Status: **Executor-private Todolist 协议 + 持久私有清单 + markInProgress 计划门禁 + 执行三件套注入。**  
> 平台 `collaboration.task.claimContract` 默认仍 **OFF**；本 PR **不**灰开 allowlist、**不**改 LIVE。  
> Todolist 确认后归属 **执行者私有**，不是小组共享看板子记录。看板仍只承载小组共享合同。

## 交付对照（FINAL §3.3）

| #    | 工程项                                                         | 实现                                                                                                                                                                          |
| ---- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2.1 | `ExecutorPrivateTodolist` 绑定 `boardItemId` + `ownerMemberId` | `src/gateway/collaboration-dispatch/executor-private-todolist.ts`；存储 `<ns>/executor-todolists/`；`visibility: executor_private`；可读：本人 + 主答/lead + 可选 coordinator |
| P2.2 | `proposeTodolist` → `confirmTodolist` / `reviseTodolist`       | 同模块 + RPC `collaboration.task.*`；未 confirm 时 `markInProgress` → `plan_gate_unconfirmed`                                                                                 |
| P2.3 | 执行注入三件套                                                 | `buildExecutionTaskBag` / `formatExecutionTaskBagForPrompt`：看板摘要 + 群上下文指针 + 本人 Todolist 当前步                                                                   |
| P2.4 | `signalInsight` → wake 主答                                    | `signalInsight` → Wake Contract `source: insight`（`wakeContract` OFF 时 best-effort 不写）                                                                                   |

过渡期：结构化协议 + 持久私有 log；`freeChatIsTodolist()===false`。

## 协议流

```
claim/apply（谁接）
  → proposeTodolist（执行者私有拆步）
  → confirmTodolist / reviseTodolist（主答）
  → markInProgress（仅确认后可标交付推进）
  → 执行回合注入 task bag（三件套）
  → （可选）signalInsight 唤醒主答
```

## RPC

| Method                                             | 说明                     |
| -------------------------------------------------- | ------------------------ |
| `collaboration.task.proposeTodolist`               | 执行者起草私有清单       |
| `collaboration.task.confirmTodolist`               | 主答确认（计划门禁通过） |
| `collaboration.task.reviseTodolist`                | 主答要求修订（清除确认） |
| `collaboration.task.getTodolist` / `listTodolists` | 私有读（ACL）            |
| `collaboration.task.buildExecutionTaskBag`         | 取三件套袋               |
| `collaboration.task.signalInsight`                 | 贡献/创新 → wake 主答    |

写入仍受 **同一** ClaimContract 开关/灰组 allowlist 约束（与看板写路径一致）；**本 PR 不打开任何旗标**。

## 验收步骤

1. **自由聊天 ≠ Todolist**：`freeChatIsTodolist()===false`；`todolistIsGroupSharedBoardSubrecord()===false`。
2. **默认 OFF**：`claimContract=false` 且不在 allowlist → `proposeTodolist` / `markInProgress` 返回 `flag_off`。
3. **计划门禁**：publish→claim→apply 后，未 confirm 直接 `markInProgress` → `plan_gate_unconfirmed`。
4. **确认后可推进**：propose → 主答 confirm → `markInProgress` → `in_progress`。
5. **修订清确认**：`reviseTodolist` → status `revise_requested`；需重新 propose/confirm。
6. **私有可读**：owner / authorized confirmer / coordinator 可读；其它成员 `forbidden`。
7. **三件套**：`buildExecutionTaskBag` 含 boardSummary + groupContextPointer + todolistCurrentStep。
8. **insight**：`wakeContract=true` 时 `signalInsight` 写入 wake，`whoWokeWhom` 可见 `source=insight`；OFF 时 `woke=false`。

## 测试

```bash
./node_modules/.bin/vitest run --config vitest.gateway.config.ts \
  src/gateway/collaboration-dispatch/executor-private-todolist.test.ts \
  src/gateway/collaboration-dispatch/claim-contract.test.ts \
  src/gateway/collaboration-dispatch/peer-review-gate.test.ts \
  src/gateway/collaboration-learning/claim-contract-entry.test.ts
```

## 风险与 LIVE

| 项        | 说明                                                             |
| --------- | ---------------------------------------------------------------- |
| LIVE 授权 | **不需要**（默认旗 OFF；不改生产配置；不灰开 allowlist）         |
| 风险      | 计划门禁会拒绝「未确认就标推进」——符合终稿；旧调用方需先 confirm |
| 回滚      | 回退本 PR；或暂时不走 markInProgress 路径                        |
| 不做      | Floor / P3 群心跳 / P4 self_advance / 全局开旗 / 第二编排器      |

## 与 P1 关系

P1 共享看板挂目标合同；P2 在 claim 之后加执行者私有拆步与计划门禁。口头派工仍不上板（`oralDispatchCreatesBoardFact()===false`）。
