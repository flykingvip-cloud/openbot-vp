# Collaboration P3 — Wake 灰组 + group task heartbeat（2026-10-15）

> Status: **灰组 `wakeContractGroupAllowlist` + group task heartbeat（读看板写 wake）+ 可选管理日摘要。**  
> 平台 `collaboration.task.wakeContract` 默认仍 **OFF**。  
> **不**灰开 `claimContract` allowlist、**不**改 LIVE、**不**全局开旗、**不**造第二编排器。  
> 心跳 **不**冒充 transcript 完成（`heartbeatFakesTranscriptCompletion()===false`）。

## 交付对照（FINAL §3.4）

| # | 工程项 | 实现 |
| --- | --- | --- |
| P3.1 | 灰组开 `wakeContract` | `wakeContractGroupAllowlist`；样本组 `grp-daniel-hhd-gmail-com-upbeyond`（文档示例，本 PR **不**写入生产配置） |
| P3.2 | 可选 `assistantMentionDispatch` | 仍默认 OFF；仅资格 / same-round peer_ask，**不**默认新回合风暴（`assistantInlineAtCreatesRound()===false`） |
| P3.3 | **group task heartbeat** | `group-task-heartbeat.ts`：默认 30min 扫 board → nudge；连续 2 次无响应 → `escalate` 至 `coordinatorBotId` 或群主 |
| P3.4 | 管理播报（可选） | `buildAdminDailySummaryMessage` / RPC `adminDailySummary`：一条 C0/C1 摘要，非刷屏 |
| — | whoWokeWhom 可审计 | nudge / escalate 写入 wake 账本；既有 `whoWokeWhom` RPC |

## 灰开（ops-only）

```json5
{
  collaboration: {
    task: {
      wakeContract: false, // keep false
      wakeContractGroupAllowlist: [
        "grp-daniel-hhd-gmail-com-upbeyond",
        // or "*/grp-daniel-hhd-gmail-com-upbeyond"
      ],
      // optional knobs (defaults = FINAL 30min / 2)
      groupTaskHeartbeat: {
        scanIntervalMs: 1_800_000,
        escalateAfterConsecutiveNoResponse: 2,
      },
      // optional; still eligibility-only, not new-round storm
      // assistantMentionDispatch: true,
    },
  },
}
```

Reload/restart gateway. Other groups remain wake-write fail-closed.

## 回滚

1. 从 `wakeContractGroupAllowlist` 移除该组（或置 `[]`）。
2. 保持 `wakeContract: false`。
3. Reload/restart。
4. 验证：`runGroupTaskHeartbeat` / `recordWakeEvent` 对该组返回 `flag_off`；`listWakeEvents` / `whoWokeWhom` 只读仍可用。

## 心跳行为

```
cron/RPC tick（force 可跳过间隔）
  → 读 <ns>/board-claims（任务表面）
  → 未认领 / 逾期 / 阻塞 / 退回 / 活跃未终态 → nudge 责任人
  → 同一 fingerprint 连续 nudge ≥ N（默认 2）→ escalate 协调者或群主
  → 写 wake-events（source=nudge|escalate）+ heartbeat state
  → 不写 transcript、不假装交卷完成
```

RPC：

| Method | 说明 |
| --- | --- |
| `collaboration.task.runGroupTaskHeartbeat` | 执行一次心跳 tick |
| `collaboration.task.adminDailySummary` | 一条管理日摘要 |
| `collaboration.task.whoWokeWhom` | 既有：谁唤醒了谁 |

## 验收步骤

1. 默认 OFF：`wakeContract=false` 且不在 allowlist → heartbeat `flag_off`。
2. 灰开 allowlist（仅配置，非本 PR LIVE）：对该组 `runGroupTaskHeartbeat` 可 nudge。
3. 连续无响应 → `source=escalate`；`whoWokeWhom` 可见。
4. `heartbeatFakesTranscriptCompletion()===false`。
5. `assistantInlineAtCreatesRound()===false`（提及派发仍非新回合风暴）。
6. 相关 vitest 绿。

## 测试

```bash
./node_modules/.bin/vitest run --config vitest.gateway.config.ts \
  src/gateway/collaboration-dispatch/group-task-heartbeat.test.ts \
  src/gateway/collaboration-dispatch/wake-contract.test.ts \
  src/gateway/collaboration-dispatch/assistant-mention-dispatch.test.ts \
  src/gateway/collaboration-learning/wake-contract-entry.test.ts
```

## 风险与 LIVE

| 项 | 说明 |
| --- | --- |
| LIVE 授权 | **不需要**（默认旗 OFF；不改生产配置；不写入 allowlist 到 LIVE） |
| claim allowlist | **未改动**（另需用户授权） |
| 风险 | 灰开后 nudge/escalate 会写 wake 账本；误配 allowlist 仅影响所列组 |
| 回滚 | 移除 allowlist 条目 |
| 不做 | Floor / P4 self_advance 生产调用方 / 全局开旗 / 第二编排器 / gmood2008 推送 |

## 与 P1/P2 关系

P1 看板事实面 + P2 私有 Todolist；P3 在 wake 灰组上加心跳，使「上次心跳醒了谁」可日清回答。
