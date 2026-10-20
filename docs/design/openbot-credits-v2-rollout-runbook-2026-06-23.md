# Credits v2 生产 Rollout Runbook

Date: 2026-06-23

## 1. 开关层级

| 层级        | 控制                                            | 说明                      |
| ----------- | ----------------------------------------------- | ------------------------- |
| 租户意愿    | `EntitlementSnapshot.features.creditsV2Enabled` | 套餐/快照层标记           |
| 全局阶段    | `OPENBOT_CREDITS_V2_ROLLOUT`                    | `off` / `canary` / `full` |
| Canary 名单 | `OPENBOT_CREDITS_V2_CANARY_ENTERPRISES`         | 逗号分隔 enterpriseId     |

**有效 v2** = 意愿开启 ∧ rollout 允许（`resolveEffectiveCreditsV2Enabled`）。

## 2. 推荐灰度步骤

1. **off（默认）** — 全量 v1，监控 baseline
2. **canary** — 选 1–3 个内部租户写入 `OPENBOT_CREDITS_V2_CANARY_ENTERPRISES`，开启 `creditsV2Enabled`
3. 观察 dashboard `commercialRuntimeDrift` + 平台 economics `byPricingEngine`
4. **full** — 全租户 rollout（仍尊重租户 feature 开关）

## 3. 校准与偏差监控

- `calibrateCreditsV2AgainstLedger` — 回放 v1/v2 价差
- `resolveCommercialRuntimeDrift` — 对账偏差 + v1/v2 分列 + 校准均值
- 告警建议：
  - `reconciliationAligned === false`
  - `calibrationMaxAbsDelta > tierWeight`（单任务价差异常）
  - `auditCoverageRatio < 0.95` 且 `auditLogEnabled`

## 4. 回滚

1. 设 `OPENBOT_CREDITS_V2_ROLLOUT=off`
2. 重启 gateway
3. 历史 ledger **不复算**（ADR）；新任务回到 v1

## 5. 租户切换检查清单

- [ ] 对账 `ledgerCreditsV2` 与 bucket 一致
- [ ] Forecast ETA 无异常跳变
- [ ] 治理面板计价引擎标注正确
- [ ] agent run `authorizationDecisionId` 覆盖率 ≥ 95%
