# OpenBot Commercial Runtime P1 - Cursor 实施说明

Date: 2026-06-23

Audience: Cursor 执行者

Status: Active handoff — 授权实施 **P1**（billing-plan Phase 2 + Phase 3）

Primary design source:

- `docs/design/openbot-commercial-runtime-billing-plan-2026-06-23.md`

Prerequisite:

- P0 已完成并通过验收（见 `docs/design/openbot-commercial-runtime-cursor-handoff-2026-06-23.md`）

---

## 1. P1 目标

在 P0 `authorizeCommercialRun()` + `SubscriptionRuntimeSnapshot` 基座上，补齐：

1. **Seat Entitlement Profile** — 席位商业档位（`basic_ai` / `pro_ai` / `elite_ai`）
2. **Seat → Bot ownership** — Bot 资源归属席位
3. **Over Allocation 治理** — 降级/换套餐后的超配拦截
4. **Credit Bucket** — 周期额度与充值分桶消费
5. **Employee Model Gate 交集** — EffectiveModelSet ∩ 席位 tier
6. **AI 岗位模板** — 组织岗位 → 默认 Profile
7. **Dashboard 治理投影** — `commercialGovernanceStatus` + forecast + reconciliation

---

## 2. 交付物与接线入口

### 2.1 类型与 Store

| 模块                         | 路径                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| Seat Entitlement Profiles    | `src/gateway/billing/seat-entitlement-profiles.ts`          |
| Seat Entitlement Assignments | `src/gateway/billing/seat-entitlement-assignments-store.ts` |
| Over Allocation              | `src/gateway/billing/over-allocation-store.ts`              |
| Over Allocation 计算         | `src/gateway/billing/compute-over-allocation.ts`            |
| Credit Buckets               | `src/gateway/billing/credit-buckets-store.ts`               |
| Billing Reconciliation       | `src/gateway/billing/billing-reconciliation.ts`             |
| AI Job Templates             | `src/gateway/billing/ai-job-templates.ts`                   |

### 2.2 运行时闸口

| 入口                                  | 行为                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `authorize-commercial-run.ts`         | 超配拦 `create_bot`；Burst 读 `concurrencyPolicy`                       |
| `employee-model-gate.ts`              | allowlist 经 `filterModelIdsBySeatEntitlementProfile`；AOR 用过滤后集合 |
| `filter-model-ids-by-seat-profile.ts` | 租户 tier ∩ 席位 profile；超配 `run_high_tier` 降最低 tier              |
| `record-credit-usage.ts`              | 有 bucket 时 `consumeCreditBuckets`；status 优先读 bucket               |
| `agent-run-registry.ts`               | `maxBurstRuns`、`concurrencyMode`；PAYG 无限并发                        |

### 2.3 Gateway RPC

| 方法                     | P1 变更                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `seats.assign`           | `jobTemplateId` / `entitlementProfileId`；超配拦 `assign_seat`                                 |
| `seats.set-role`         | 超配拦 `upgrade_seat_profile`；profile 升档守卫                                                |
| `resources.createBot`    | `ownerSeatId` 绑定                                                                             |
| `billing.dashboard`      | `commercialGovernanceStatus`、`overAllocation`、`consumptionForecast`、`creditsReconciliation` |
| `consumption-forecast.*` | 已有独立 RPC；dashboard 内嵌同引擎                                                             |

### 2.4 订阅生命周期

- `subscription-provisioning.ts` — 开通写 `plan_cycle` bucket + `refreshOverAllocationState`
- `order-fulfillment.ts` — 充值写 `recharge` bucket
- `bootstrap-seat-allocation.ts` — 自动席位同步写默认 profile

---

## 3. 故意留给 P2 / 未做项

1. Concurrency `queue` 语义（当前仅 block + burst ceiling）
2. Enterprise UI Budget Forecast Card 前端
3. `Credits v2` 独立 ADR、token-weight economics
4. Commerce / order / proration 重构
5. `authorizeCommercialRun` 与 `employee-model-gate` 在闸口层的双重 profile 校验（当前以 gate 层 allowlist 为主）

---

## 4. 验收测试命令

```bash
# P1 核心单测
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/billing/credit-buckets-store.test.ts \
  src/gateway/billing/compute-over-allocation.test.ts \
  src/gateway/billing/agent-run-registry.test.ts \
  src/gateway/billing/ai-job-templates.test.ts \
  src/gateway/model-entitlement/filter-model-ids-by-seat-profile.test.ts \
  src/gateway/server-methods/billing.test.ts

# P0 回归（建议一并跑）
OPENBOT_TEST_PROFILE=low pnpm test \
  src/gateway/billing/p1-runtime-wiring.integration.test.ts \
  src/gateway/billing/record-credit-usage.test.ts

# 构建
pnpm build
```

### 4.1 手工验收要点

1. **席位 tier 过滤**：`basic_ai` 席位仅见 `tier_a` 模型；`pro_ai` 见 `tier_a`+`tier_b` 交集
2. **超配治理**：bots 超额 → `create_bot` 被拒；profile 超额 → `run_high_tier` 降至最低 tier
3. **Credit Bucket**：订阅开通写 `plan_cycle`；充值写 `recharge`；扣费先消费 bucket
4. **Dashboard**：无订阅返回 `commercialGovernanceStatus: normal`；有超配返回 `over_allocated` 与 `blockedActions`
5. **岗位模板**：`seats.assign` + `jobTemplateId: sales_ai` → 默认 `pro_ai` profile

---

## 5. 与 P0 handoff 的关系

- P0 handoff 仍有效，但 **scope 仅限 P0**；本文件覆盖 P1。
- 类型扩展见 `src/gateway/billing/types.ts`（`BotVisibility`、`SeatEntitlementProfileId`、`OverAllocationState`、`CreditBucket`）。

---

## 6. 完成标准

- [ ] 上述测试全绿
- [x] `pnpm build` 无 `[INEFFECTIVE_DYNAMIC_IMPORT]` 警告（commercial-orders 改静态 import tenant-billing-projection；打破 authorize ↔ governance 循环）
- [ ] Dashboard 含治理字段且与 `enterprise.status` 语义分离（`commercialGovernanceStatus`）
- [x] Worker 路径：`employee-model-gate` AOR 使用过滤后 allowlist
- [x] `seats.set-role` 升档守卫在 mutation 前执行（含隐式默认 profile 升档）
- [x] `SeatEntitlementProfile.maxConcurrentRuns` 接入 `authorizeCommercialRun` + registry 席位计数
- [x] seat/bot 变更后 `refreshEnterpriseOverAllocationIfSubscribed`
- [x] Dashboard 治理字段 UI 契约 + overview/settings store 接线
