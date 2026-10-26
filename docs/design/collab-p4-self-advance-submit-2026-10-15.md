# Collaboration P4 — 有限自推进 + 交卷验收循环（2026-10-15）

> Status: **Governance Gate `self_advance` 生产调用方 + Mode B 选人 + 交卷空/重复拒绝 + 验收循环上限升级人。**  
> 平台 `botMaySelfAdvanceWithoutHuman` **L1 默认仍 false**。  
> 本 PR **不**写 LIVE、**不**灰开 claim/wake allowlist、**不**全局开旗、**不**造第二编排器。

## 交付对照（FINAL §3.5）

| #    | 工程项                                                | 实现                                                                                                   |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| P4.1 | Governance Gate 接生产 `self_advance`                 | `trySelfAdvance` / RPC `collaboration.task.trySelfAdvance`；条件见 §1.5                                |
| P4.2 | 灰组 L2 可设 `botMaySelfAdvanceWithoutHuman=true`     | 文档说明（operatingState.collaborationPolicy）；平台默认仍 false                                       |
| P4.3 | Mode B 选人：优先 board 责任人；`@所有人` 不得抢 lead | `mode-b-member-selection.ts` + decision-engine；认领问询走 getMemberProgress                           |
| P4.4 | 交卷链进生产路径；空/duplicate 不计成功               | `submitBoardItemForReview` → `empty_submission` / `duplicate_submission` / `duplicate_open_submission` |
| P4.5 | 验收循环上限 + 超限升级人                             | `returnCount` + `acceptanceLoopMaxReturns`（默认 3）→ wake `escalate`                                  |

## §1.5 自推进条件（全部满足才允许）

1. 组 L2：`botMaySelfAdvanceWithoutHuman=true`（平台 L1 默认 false）
2. 存在 `applied|in_progress` 看板项且未过验收
3. 使命非 onboarding
4. Governance Gate 允许 `self_advance`
5. 外发/终裁仍 `human_required`

`self_advance` **不**替代 finalize / outbound。

## 灰开 L2 self_advance（ops-only，本 PR 不写 LIVE）

在目标组的 **operatingState.collaborationPolicy**（L2）设置：

```json5
{
  collaborationPolicy: {
    botMaySelfAdvanceWithoutHuman: true, // L2 only; platform L1 default stays false
  },
  // finalDecisionPolicy.mode 保持 human_required
}
```

然后：

1. Reload/restart gateway（或走既有 operating-state 写入路径，**需另授权**）。
2. 可选：灰开 wake allowlist（另授权）以便 `trySelfAdvance` 写入 `source=self_advance` wake；即使 wake OFF，闸评估与 Mode B 选人仍可 dryRun。
3. 验证：`collaboration.task.trySelfAdvance` 在 L2=true + 活跃看板 + 非 onboarding 时 `advanced=true`；其它组 / 默认 L2=false → `l2_bot_may_self_advance`。

**回滚：**

1. 将组 L2 `botMaySelfAdvanceWithoutHuman` 改回 `false`（或不设，回落 L1 default false）。
2. Reload/restart。
3. 验证：`trySelfAdvance` → `advanced=false` / `reason=l2_bot_may_self_advance`。
4. 平台默认与新组种子仍为 false（`platformDefaultBotMaySelfAdvanceWithoutHuman()===false`）。

## 交卷链

```
in_progress|returned
  → submitForReview(submission_id, submissionSummary 非空)
       ↘ empty_submission / duplicate_submission / duplicate_open_submission → 不计成功
  → 主答 acceptSubmission | returnSubmission(reason)
       ↘ return → returnCount++；≥ acceptanceLoopMaxReturns → escalate 协调者/人
       ↘ accept → 关项
```

配置（可选）：

```json5
{
  collaboration: {
    task: {
      acceptanceLoopMaxReturns: 3, // default
    },
  },
}
```

## Mode B 选人

优先序：board `claimantId` → `intendedClaimantIds` → `getMemberProgress` 活跃成员 → 显式 @mention。  
`@所有人` 在存在看板责任人时 **不得**抢 lead（decision-engine `mode_b_board_lead`；`broadcastMustNotStealBoardLead()===true`）。

## RPC

| Method                                                                         | 说明                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `collaboration.task.trySelfAdvance`                                            | 生产自推进 tick（评估 §1.5 + Mode B lead + 可选 wake） |
| `collaboration.task.submitForReview` / `acceptSubmission` / `returnSubmission` | 既有交卷链（P4 加固空/重复/循环）                      |
| `collaboration.task.getMemberProgress`                                         | 认领问询只读                                           |

## 验收步骤

1. 平台默认：`botMaySelfAdvanceWithoutHuman` L1 false；`runtimeNotEnforced` **不再**含该字段（P4 已接线）。
2. L2=false → `trySelfAdvance` 不推进。
3. L2=true + applied|in_progress + 非 onboarding + human_required → 可推进；lead=board 责任人。
4. 空 `submissionSummary` → `empty_submission`；重复退回正文 → `duplicate_submission`。
5. 连续 return 达上限 → wake `escalate`（需 wake 灰开才落账）。
6. `@所有人` + board 责任人 → lead 不被广播抢走。
7. 相关 vitest 绿；无 LIVE / claim|wake allowlist 写入。

## 测试

```bash
./node_modules/.bin/vitest run --config vitest.gateway.config.ts \
  src/gateway/collaboration-dispatch/self-advance.test.ts \
  src/gateway/collaboration-dispatch/mode-b-member-selection.test.ts \
  src/gateway/collaboration-dispatch/claim-contract.test.ts \
  src/gateway/collaboration-dispatch/governance-gate.test.ts \
  src/gateway/collaboration-dispatch/policy-lane-presentation.test.ts
```

## 风险与 LIVE

| 项                   | 说明                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| LIVE 授权            | **不需要**（默认旗 OFF；不改生产配置；不写 L2 LIVE）                         |
| claim/wake allowlist | **未改动**（另需用户授权）                                                   |
| 风险                 | 灰开 L2 后 bot 可无人节拍 wake 责任人；误开仅影响该组；终裁仍 human_required |
| 回滚                 | L2 改回 false                                                                |
| 不做                 | Floor / P5 挑战窗产品化 / 全局开旗 / 第二编排器 / gmood2008 推送             |

## 与 P1–P3 关系

P1 看板事实面 + P2 私有 Todolist/计划门禁 + P3 wake/心跳；P4 把 self_advance 闸接到生产调用，并收紧交卷成功判定与验收循环。
