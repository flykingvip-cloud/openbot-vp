# OpenBot Commercial Runtime 套餐计费落地方案

Date: 2026-06-23

Status: Draft - 已吸收专家复核意见的可执行收敛方案

Audience: Gateway/Billing、Commerce、Model Entitlement、Enterprise UI、Platform Pricing、QA

Related:

- [平台套餐权益架构与预警闭环设计](/design/platform-plan-entitlement-architecture-2026-06-20)
- [OpenBot 企业端 AI 劳动力套餐与定价主实施计划](/design/openbot-enterprise-ai-workforce-pricing-master-plan-2026-06-21)
- [OpenBot 企业端 AI 劳动力套餐实施拆解](/design/openbot-enterprise-ai-workforce-pricing-execution-breakdown-2026-06-22)
- [套餐 Capacity Contract 冻结表](/design/openbot-plan-capacity-contract-frozen-2026-06-22)
- `src/gateway/billing/**`
- `src/gateway/package-entitlement/**`
- `src/gateway/model-entitlement/**`
- `src/gateway/commerce/**`

---

## 0. 执行摘要

专家团队提出的方向是对的，但对 OpenBot 而言，落地重点不是重做一套新商业系统，而是把当前已经存在的 4 条链路收敛成同一个运行时真相：

1. `Plan / PlanVersion` 的价格锁定链
2. `EntitlementSnapshot / model binding` 的能力链
3. `seats / bot / agent-run / employee gate` 的运行时授权链
4. `tenant credits / usage ledger / bill / economics` 的计量与核算链

当前代码已经具备：

- 版本锁价：`src/gateway/billing/types.ts`、`src/gateway/billing/plans-store.ts`
- 套餐权益快照：`src/gateway/package-entitlement/types.ts`
- 企业订阅开通：`src/gateway/billing/subscription-provisioning.ts`
- 并发与 Bot 限制：`src/gateway/billing/agent-run-governance.ts`、`src/gateway/billing/constraint-engine.ts`
- 员工模型授权闸口：`src/gateway/model-entitlement/employee-model-gate.ts`
- Credits 扣减与 Usage Ledger：`src/gateway/billing/record-credit-usage.ts`、`src/gateway/billing/usage-ledger-store.ts`
- 订单、Proration、履约：`src/gateway/commerce/order-pricing.ts`、`src/gateway/commerce/order-fulfillment.ts`

因此本方案的结论不是“从零设计套餐系统”，而是：

```text
以现有 billing + entitlement + commerce 为基座，
补齐 Subscription Runtime Snapshot、authorizeCommercialRun()、
Seat Entitlement、Over Allocation、Credit Bucket、Transition Engine，
形成真正可运行的 OpenBot Commercial Runtime。
```

专家复核后的优先级冻结如下：

- P0：对象定义冻结、`SubscriptionRuntimeSnapshot`、`authorizeCommercialRun()`、硬并发治理、现有 `agent-run-registry` 的强制接线、`OverAllocationState`
- P1：`Seat -> Bot ownership`、`Seat Entitlement`、AI 岗位模板、Burst 并发、`CreditBucket`、Forecast Engine
- P2：`Credits v2` 独立 ADR、token-weight economics、Enterprise AI Governance

额外冻结结论：

- 不引入 `Package` 替换 `Plan / PlanVersion`
- 不在当前阶段重写 commerce / order / proration
- 不在当前阶段升级到 token-weight credits 计费
- UI 主目标是治理入口，不是继续堆叠报表和营销配置

本轮专家复核后新增一条根冻结：

> OpenBot 必须先统一“商业对象到底是什么”，再谈套餐、并发、Forecast、治理。

最终统一定义如下：

| 对象       | 本质             | 是否长期存在 | 是否计费核心 |
| ---------- | ---------------- | ------------ | ------------ |
| `Seat`     | 人类员工席位     | 是           | 是           |
| `Bot`      | AI 员工资产      | 是           | 是           |
| `Run`      | 一次 AI 执行任务 | 否           | 是           |
| `Workflow` | 编排逻辑         | 是           | 否           |
| `Credits`  | AI 预算口径      | 否           | 是           |

核心归属链冻结为：

```text
Enterprise
  -> Seat
    -> Bot
      -> Run
```

---

## 1. 当前代码现状映射

### 1.1 已经存在的商业定义层

| 层           | 当前模块                                                            | 现状判断 |
| ------------ | ------------------------------------------------------------------- | -------- |
| 套餐头       | `src/gateway/billing/types.ts` `Plan`                               | 已有     |
| 套餐版本     | `src/gateway/billing/types.ts` `PlanVersion`                        | 已有     |
| 版本锁价     | `PlanVersion.snapshot`                                              | 已有     |
| 商业策略     | `commercial`、`marketingTags`、`matchingProfile`                    | 已有     |
| 套餐权益快照 | `src/gateway/package-entitlement/types.ts` `EntitlementSnapshot`    | 已有     |
| 套餐模型绑定 | `src/gateway/model-entitlement/plan-version-model-binding-store.ts` | 已有     |

结论：

- 平台端“卖什么”这件事已经不是空白。
- 当前最大问题不在静态套餐定义，而在这些定义如何变成运行时唯一真相。

### 1.2 已经存在的订阅与履约层

| 能力                  | 当前模块                                             | 现状判断 |
| --------------------- | ---------------------------------------------------- | -------- |
| 订阅状态              | `src/gateway/billing/subscriptions-store.ts`         | 已有     |
| 订阅版本锁定          | `Subscription.planVersionId`                         | 已有     |
| 立即换套餐            | `subscriptions.change-plan` + `order-fulfillment.ts` | 已有     |
| 下一周期换套餐        | `pendingChange`                                      | 已有     |
| Proration 差价        | `src/gateway/commerce/order-pricing.ts`              | 已有     |
| 订单履约              | `src/gateway/commerce/order-fulfillment.ts`          | 已有     |
| 租户 billing 状态投影 | `src/gateway/commerce/tenant-billing-projection.ts`  | 已有     |

结论：

- Subscription 和 Commerce 已经具备骨架。
- 但“换套餐”仍偏订单驱动，缺少统一的 Subscription Transition Engine。

### 1.3 已经存在的运行时授权层

| 运行时约束            | 当前模块                                                              | 现状判断 |
| --------------------- | --------------------------------------------------------------------- | -------- |
| 企业 entitlement 解析 | `src/gateway/billing/resolve-enterprise-entitlement.ts`               | 已有     |
| 并发槽 registry       | `src/gateway/billing/agent-run-registry.ts`                           | 已有     |
| 并发闸口              | `src/gateway/billing/agent-run-governance.ts`                         | 已有     |
| Bot 限制              | `src/gateway/billing/constraint-engine.ts` + `bot-resources-store.ts` | 已有     |
| Seat 分配             | `src/gateway/billing/seats-store.ts`                                  | 已有     |
| 自动席位引导          | `src/gateway/billing/bootstrap-seat-allocation.ts`                    | 已有     |
| 员工模型授权          | `src/gateway/model-entitlement/employee-model-gate.ts`                | 已有     |
| 角色档位投影          | `src/gateway/model-entitlement/role-grant-profiles.ts`                | 已有     |

结论：

- OpenBot 已经有 Runtime Enforcement 的雏形。
- 但授权链仍然分散在多个模块里，且尚未全部基于“冻结订阅快照”读取。

### 1.4 已经存在的计量、账单、经营层

| 能力         | 当前模块                                                           | 现状判断 |
| ------------ | ------------------------------------------------------------------ | -------- |
| Credits 余额 | `src/gateway/billing/tenant-credits-store.ts`                      | 已有     |
| Credits 扣减 | `src/gateway/billing/record-credit-usage.ts`                       | 已有     |
| Usage Ledger | `src/gateway/billing/usage-ledger-store.ts`                        | 已有     |
| 实时成本估算 | `src/gateway/billing/runtime.ts`                                   | 已有     |
| 账单与快照   | `src/gateway/billing/ledger-store.ts`、`server-methods/billing.ts` | 已有     |
| 毛利聚合     | `src/gateway/economics/aggregate.ts`                               | 已有     |

结论：

- Ledger、Bill、Economics 不是缺席，而是字段与边界还不够“商业运行时化”。

---

## 2. 与专家方案相比的关键缺口

### G0. 商业对象定义与归属链还未完全冻结

当前行为：

- `Seat` 已存在于 `src/gateway/billing/seats-store.ts`
- `Bot` 已存在于 `src/gateway/billing/bot-resources-store.ts`
- `Run` 已存在于 `src/gateway/billing/agent-run-registry.ts`
- 但这三者的商业语义还没有在同一份文档和同一条运行时链上冻结。
- 当前 `BotResource` 仍以 `ownerUserId` 为主，而不是明确的 `ownerSeatId`。

风险：

- 后续权限、审计、成本归因、Bot 共享、Bot Marketplace、团队协作会出现归属混乱。
- 企业无法稳定回答“哪个员工席位创建了哪些 AI 员工，哪些 AI 员工又产生了哪些运行成本”。

决策：

1. 文档与代码同时冻结三元定义：
   - `Seat = 人`
   - `Bot = AI 员工`
   - `Run = AI 执行`
2. 所有商业归因默认沿 `Seat -> Bot -> Run` 下钻。
3. `Workflow` 明确为持久编排资产，不作为主计费对象。

### G1. Snapshot 还没有真正冻结

当前行为：

- `PlanVersion.snapshot` 是价格快照，已具备版本锁定语义。
- 但 `EntitlementSnapshot` 与 `PlanVersionModelBinding` 仍可按 `planVersionId` 原地更新：
  - `src/gateway/package-entitlement/plan-version-entitlement-store.ts`
  - `src/gateway/model-entitlement/plan-version-model-binding-store.ts`
- `resolveEnterpriseEntitlement()` 与 `resolvePlanVersionEntitlement()` 在快照缺失时仍会回退到 `PlanVersion` 或 binding 默认值：
  - `src/gateway/billing/resolve-enterprise-entitlement.ts`
  - `src/gateway/package-entitlement/resolve-plan-version-entitlement.ts`

风险：

- 历史订阅虽然锁了 `planVersionId`，但对应 entitlement/binding 仍可能被后改。
- 运行时与账单重算存在“版本 id 不变、能力事实变了”的风险。

决策：

1. `active` 或已被订阅引用的 `planVersionId`，禁止再更新 entitlement snapshot 和 model binding。
2. 任意商业能力变更，一律追加新 `PlanVersion`。
3. 运行时读取默认只认“已冻结 snapshot”，不再静默回退；回退仅允许迁移期开关启用。

### G2. 还没有真正的 Subscription Runtime Snapshot

当前行为：

- 订阅锁定 `planVersionId`。
- 开通时会做 entitlement 投影、seat bootstrap、credits 初始化。
- 但运行时仍是“订阅 -> planVersionId -> 现查 entitlement/binding/store”。

风险：

- 订阅成功后的真实运行 contract 不是单对象。
- 排查升级、降级、补量、角色投影错乱时，需要横跨多个 store 还原事实。

决策：

- 新增 `SubscriptionRuntimeSnapshot`，在 subscribe / change-plan / renew / contract-adjust 时物化。
- 运行时授权、Credits、告警、账单归因默认以该 snapshot 为第一真相。

### G3. Seat Entitlement 还停留在“角色授权”，未进入“商业席位授权”

当前行为：

- `SeatRole = viewer | creator | admin`
- 模型授权靠 `role-grant-profile`
- Seat 当前只有 `currentRole` 与 `botQuota`

风险：

- 无法表达“同一企业里张三是 Basic AI、李四是 Pro AI、王五是 Elite AI”。
- `SeatRole` 同时承担治理角色与商业能力角色，后续会失真。

决策：

1. 保留 `SeatRole` 作为治理/组织角色。
2. 新增 `SeatEntitlementProfile` 作为商业档位，例如：
   - `basic_ai`
   - `pro_ai`
   - `elite_ai`
3. 新增 `SeatEntitlementAssignment`，把员工/席位绑定到商业档位。
4. 运行时模型、并发、私有模型、工作流能力改为 `tenant snapshot ∩ seat profile` 共同决定。

### G3.1 Seat -> Bot Ownership Model 还不存在

当前行为：

- `BotResource` 当前主要字段是 `ownerUserId`。
- 运行时没有冻结 `Seat -> Bot` 的主 ownership 模型。

风险：

- 后续做 Bot 共享、团队协作、资产继承、Marketplace、审计归因时会失控。
- 仅靠 `ownerUserId` 无法稳定表达企业内的席位治理、职位变更与资产交接。

决策：

1. `BotResource` 升级为显式 seat ownership：

```ts
type BotResource = {
  id: string;
  enterpriseId: string;
  ownerSeatId: string;
  visibility: "private" | "team" | "enterprise" | "public_template";
  createdAt: string;
  deletedAt: string | null;
};
```

2. `ownerUserId` 保留为兼容/投影字段，不再作为长期真源。
3. 所有 Bot 成本、权限、共享、模板化都默认基于 `ownerSeatId` 与 `visibility` 解析。

### G4. 降级没有 Over Allocation 机制

当前行为：

- 现在的换套餐本质是“取消旧订阅 + 创建新订阅”。
- 配额检查主要发生在后续新增动作时。
- 没有专门的“超配状态”记录、告警和治理。

风险：

- 从高配降到低配后，已有 Seats/Bots/Grants/Concurrency 只会“碰到哪里拦哪里”。
- 平台无法明确告诉企业“你现在超配了多少、哪些动作会被拦、需要做什么恢复”。

决策：

- 新增 `OverAllocationState`，显式记录：
  - `seatsOver`
  - `botsOver`
  - `seatProfilesOver`
  - `privateModelsOver`
  - `workflowsOver`
- 由于当前 `platform-auth` 的 `enterprise.status` 已承担 `trial / paid / suspended / expired` 语义，
  **不复用该字段表达超配**；改为在 billing/runtime 域新增治理状态投影，例如
  `commercialGovernanceStatus = normal | over_allocated`，并由 `OverAllocationState` 驱动。
- 降级后不删资产，只进入“只减不增”模式：
  - 禁止新增 Seat / Bot
  - 禁止把低档位席位升到高档位
  - 禁止新增超 tier 运行
  - 允许企业自助清退直到恢复正常

### G4.1 并发仍缺少 Burst Control

当前行为：

- 当前并发约束主要基于 `maxConcurrentRuns` 与 registry 硬拦截。
- 这足以形成企业级基础控制，但还不够支撑高峰流量企业场景。

风险：

- 一旦瞬时峰值超过 included 并发，企业会直接被打断。
- 无法承载 AI 客服、AI 销售、AI 呼叫中心等典型高峰场景。

决策：

1. 并发能力拆成两层：
   - `includedRuns`
   - `maxBurstRuns`
2. 新增 `ConcurrencyPolicy`：

```ts
type ConcurrencyPolicy = {
  includedRuns: number;
  maxBurstRuns: number;
  overagePricePerRunCents?: number;
  mode: "block" | "queue" | "pay_as_you_go";
};
```

3. P0 先完成硬并发治理与统一入口。
4. P1 再把 Burst/Queue/PAYG 作为企业版增强能力接入。

### G5. Credits 归属还不够成熟

当前行为：

- `tenant-credits-store.ts` 只有按 `enterpriseId + cycleStart` 的聚合余额。
- `appendRechargeCredits()` 直接把充值 credits 加到同一个 `monthlyCredits` 字段。

风险：

- 套餐月配额、充值包、升级补差额无法分账。
- 周期切换、客服调整、审计对账很难解释。

决策：

- 把 credits 改成 bucket 模型：
  - `plan_cycle`
  - `recharge`
  - `proration_bonus`
  - `manual_adjustment`
- 消费顺序默认：
  1. `plan_cycle`
  2. `proration_bonus`
  3. `recharge`
  4. `manual_adjustment`

### G6. Credits 计价模型仍是过渡态

当前行为：

- 当前 credits 主要按 tier 固定扣点，`record-credit-usage.ts` 再结合 token 用量做一定权重处理。
- 经营分析、forecast、dashboard、reconciliation 都已依赖当前 credits 语义。

风险：

- 长期来看，固定档位扣点无法精确映射不同 token 量、工具调用量、运行时成本。
- 但若在当前阶段直接切到全量 token-weight 计价，会同时冲击 ledger、forecast、economics、dashboard 与 reconciliation。

决策：

- 当前阶段 **不改 Credits v2 计价模型**，继续把现有 credits 视为可运行的桥接方案。
- `Credits v2` 单独立 ADR，目标模型为：
  - `tierWeight`
  - `tokenCostFactor`
  - `toolFactor`
  - `runtimeFactor`
- 当前主线优先保证：
  - 可运行
  - 可计费
  - 可审计
  - 可对账

### G7. Usage Ledger 还不是“运行时唯一真相”

当前行为：

- 当前 ledger 记录了 `taskId/modelId/tier/policyId/creditsCharged/providerCostCents/...`
- 但缺少专家方案所需的关键运行时维度：
  - `subscriptionSnapshotId`
  - `seatId`
  - `orgSeatId`
  - `userId`
  - `botId`
  - `runId`
  - `authorizationDecisionId`

风险：

- 账单能看总量，但难以解释“是谁、在哪个席位、用哪个 Bot、基于哪个订阅快照、被哪个授权决策放行”的问题。

决策：

- 将 Usage Ledger 扩展为运行级审计真相。
- Credits 扣减、provider cost、tenant revenue、forecast、margin 都以 ledger 交易为中心串联。

### G7.1 缺少真正的 Usage Forecast Engine

当前行为：

- 现有 `runtime.ts`、`billing.dashboard`、`consumption-forecast/**` 已有部分估算与日序列基础。
- 但企业侧仍缺少“月底是否会超额”的预算预测主卡片。

风险：

- 企业最怕 AI 费用失控；没有预测，扩容与续费都会犹豫。
- 只有统计，没有风险解释，无法形成企业版预算闭环。

决策：

1. 新增 `Usage Forecast Engine`，基于 ledger 与 bucket 计算：
   - 当前日均消耗
   - 月底预计消耗
   - 套餐内额度
   - 预计超额
2. 企业端新增 `Budget Forecast Card`，这是风险预测，不是普通统计图。
3. 预测引擎口径统一基于：
   - `UsageLedger`
   - `CreditBucket`
   - `SubscriptionRuntimeSnapshot`

### G8. 运行时授权逻辑分散

当前行为：

- 并发在 `agent-run-governance.ts`
- 模型 allowlist 在 `employee-model-gate.ts`
- 预算闸口在 `enforce.ts`
- Credits 扣减在运行成功后 `record-credit-usage.ts`

风险：

- 同一条 run 路径需要跨多个模块才能回答“为什么这次被允许/被拒绝”。
- 不同入口可能绕过部分商业约束。

决策：

- 新增统一入口 `authorizeCommercialRun()`，并将其提升为 **所有 AI 执行前唯一商业闸口**。
- 以下入口全部必须在执行前调用：
  - Chat
  - Workflow
  - Bot Run
  - Agent Run
  - Batch Task
  - Automation
  - API
- 统一校验内容至少包括：
  1. `Subscription State`
  2. `Seat Entitlement`
  3. `Model Entitlement`
  4. `Bot Quota`
  5. `Concurrency`
  6. `Credits`
  7. `Budget`
  8. `Overage Policy`
- `authorizeCommercialRun()` 统一输出：
  - `authorizationDecisionId`
  - `effectiveSubscriptionSnapshotId`
  - `effectiveSeatEntitlementProfile`
  - `policyDecision`
  - `creditReservation` 或 `creditDecision`
- 现有 `agent-run-registry.ts` 不是重写对象，而是 P0 强制接线对象：
  所有需要并发占槽的入口都必须通过同一 acquire/release 链路。

### G9. Transition Engine 还不完整

当前行为：

- 有 `pendingChange`
- 有 Proration quote
- 有 fulfillment

缺失：

- 账期切换自动应用 pending change
- 升级补发 credits bucket
- 降级写入 over-allocation
- 运行时快照切换审计

决策：

- 新增 `subscription-transition-engine.ts`
- 所有订阅变化只经此模块落地

### G10. 选购与管理 UI 还需要继续收口

当前风险：

- 若继续把注意力放在套餐文案、图表和配置堆叠上，会稀释 Runtime Commercial Engine 的主线。
- 当前套餐表达如果过度暴露 `tiers / policies / models`，会让企业前台变成资源术语堆叠，而不是业务价值表达。

决策：

- 选购路径继续冻结为三层：
  - 主路径：智能推荐
  - 次路径：查看全部套餐
  - 高级路径：联系销售
- 管理 UI 优先级冻结为：
  - 权限治理
  - 配额治理
  - 并发治理
  - 模型治理
  - 预算治理
- 本阶段不再以“更多统计图 / 更多报表 / 更多营销配置项”为核心目标。
- 套餐前台一层表达统一去模型化：
  - `AI 员工数量` -> `maxBots`
  - `团队规模` -> `maxSeats`
  - `AI 同时工作能力` -> `maxConcurrentRuns`
  - `每月任务处理能力` -> `credits`
  - `高级 AI 能力` -> `allowedTiers`
  - `安全治理能力` -> `features`
- 前台主卡片不直接暴露：
  - `Tier A/B/C`
  - `Claude Sonnet`
  - `GPT-4o`
- 模型与 tier 细节仅放入二级“AI 能力详情”抽屉。
- `Credits` 前台默认改名为 **AI工作额度**；后台与账务层仍保留 `credits` 术语。

---

## 3. 冻结后的目标架构

```text
Plan
  -> PlanVersion
    -> Immutable Plan Pricing Snapshot
    -> Immutable Entitlement Snapshot
    -> Immutable Model Binding Snapshot

Tenant Subscription
  -> Subscription Runtime Snapshot
  -> Seat Entitlement Assignment
  -> Over Allocation State

AI Asset Runtime
  -> Seat
  -> Bot
  -> Workflow
  -> Agent Run

Commercial Runtime
  -> authorizeCommercialRun()
  -> Bot Registry
  -> Agent Run Registry
  -> Policy / Constraint / Routing / Cost Control
  -> Concurrency Policy
  -> Credit Buckets

Financial Truth
  -> Usage Ledger
  -> Provider Cost
  -> Bill
  -> Cost Snapshot
  -> Economics / Forecast / Reconciliation / Overage
```

### 3.1 商业原则冻结

1. 主收费单位：`Seats`
2. 企业长期价值对象：`Seat / Bot / Workflow`
3. 企业执行与成本对象：`Run / Credits / Provider Cost`
4. `Bots` 是 AI 资产额度，不是主收费单位
5. 订阅后运行时只认 snapshot，不认 Plan 头
6. 所有 AI 执行入口统一先过 `authorizeCommercialRun()`
7. 降级不删资产，统一进入 `Over Allocation`
8. Credits 永不回收已发额度，但必须按 bucket 归属审计
9. `Credits v2` 单独 ADR，不阻塞当前主线

### 3.2 选购与运营 UI 原则

1. 主路径：智能推荐
2. 次路径：查看全部套餐
3. 高级路径：联系销售
4. 管理 UI 首先服务治理，不以报表堆叠为优先

---

## 4. 目标数据模型

### 4.1 `SubscriptionRuntimeSnapshot` 新增

建议文件：

- `src/gateway/billing/subscription-runtime-snapshots-store.ts`

建议结构：

```ts
type SubscriptionRuntimeSnapshot = {
  id: string;
  enterpriseId: string;
  subscriptionId: string;
  planId: string;
  planVersionId: string;
  pricingSnapshot: {
    billingCycle: "monthly" | "semiannual" | "annual";
    basePriceCents: number;
  };
  entitlementSnapshot: {
    maxSeats: Partial<Record<SeatRole, number>>;
    maxBots: number;
    maxConcurrentRuns: number;
    concurrencyPolicy?: {
      includedRuns: number;
      maxBurstRuns: number;
      overagePricePerRunCents?: number;
      mode: "block" | "queue" | "pay_as_you_go";
    };
    monthlyCredits: number;
    allowedTiers: string[];
    allowedPolicies: string[];
    allowCustomPolicy?: boolean;
    allowPrivateModels?: boolean;
    overagePolicy: {
      type: "block" | "credits_only" | "pay_as_you_go";
      allowBurstConcurrency: boolean;
    };
  };
  modelBindingSnapshot: {
    allowedModelIds: string[];
    allowedTiers: string[];
    allowedPolicies: string[];
    policyId?: string;
  };
  billingMode: "credits" | "enterprise_budget";
  effectiveAt: string;
  expiresAt?: string;
  createdAt: string;
};
```

规则：

- 每次订阅生效、升级、降级生效、续费合同切换，都生成新 snapshot。
- 运行时默认只读该表。

### 4.2 `SeatEntitlementProfile` 与 `SeatEntitlementAssignment` 新增

建议文件：

- `src/gateway/billing/seat-entitlement-profiles.ts`
- `src/gateway/billing/seat-entitlement-assignments-store.ts`

职责分离：

- `SeatRole`：组织治理角色
- `SeatEntitlementProfile`：商业能力档位

建议 profile：

| Profile    | 含义         | 默认能力                       |
| ---------- | ------------ | ------------------------------ |
| `basic_ai` | 基础员工席位 | Tier A、低并发、无私有模型     |
| `pro_ai`   | 生产席位     | Tier A/B、中并发               |
| `elite_ai` | 高级席位     | Tier A/B/C、高并发、可私有模型 |

### 4.3 `BotResource` ownership 升级

建议文件：

- `src/gateway/billing/bot-resources-store.ts`

目标结构：

```ts
type BotVisibility = "private" | "team" | "enterprise" | "public_template";

type BotResource = {
  id: string;
  enterpriseId: string;
  ownerSeatId: string;
  ownerUserId?: string; // compat / projection only
  visibility: BotVisibility;
  createdAt: string;
  deletedAt: string | null;
};
```

规则：

- `ownerSeatId` 是长期真源。
- `visibility` 是未来共享、协作、Marketplace 的前置字段。

### 4.4 `ConcurrencyPolicy` 新增

建议结构：

```ts
type ConcurrencyPolicy = {
  includedRuns: number;
  maxBurstRuns: number;
  overagePricePerRunCents?: number;
  mode: "block" | "queue" | "pay_as_you_go";
};
```

接入方式：

- 挂入 `SubscriptionRuntimeSnapshot.entitlementSnapshot`
- 与 `agent-run-registry`、`authorizeCommercialRun()` 联动

### 4.5 `CreditBucket` 新增

建议文件：

- `src/gateway/billing/credit-buckets-store.ts`

建议结构：

```ts
type CreditBucket = {
  id: string;
  enterpriseId: string;
  subscriptionSnapshotId?: string;
  cycleStart: string;
  bucketType: "plan_cycle" | "recharge" | "proration_bonus" | "manual_adjustment";
  creditsGranted: number;
  creditsConsumed: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

### 4.6 `OverAllocationState` 新增

建议文件：

- `src/gateway/billing/over-allocation-store.ts`

建议结构：

```ts
type OverAllocationState = {
  enterpriseId: string;
  subscriptionSnapshotId: string;
  status: "normal" | "over_allocated";
  seatsOver: number;
  botsOver: number;
  seatProfilesOver: number;
  privateModelsOver: number;
  workflowsOver: number;
  blockedActions: Array<
    "assign_seat" | "create_bot" | "duplicate_bot" | "upgrade_seat_profile" | "run_high_tier"
  >;
  detectedAt: string;
  updatedAt: string;
};
```

### 4.7 `UsageLedgerEntry` 扩展

建议直接扩展 `src/gateway/package-entitlement/types.ts` 中的 `UsageLedgerEntry`：

```ts
type UsageLedgerEntry = {
  id: string;
  enterpriseId: string;
  subscriptionSnapshotId: string;
  subscriptionId: string;
  userId?: string;
  billingSeatId?: string;
  orgSeatId?: string;
  botId?: string;
  runId?: string;
  taskId: string;
  policyId: string;
  tier: string;
  modelId: string;
  creditsCharged: number;
  providerCostCents: number;
  tenantRevenueCents: number;
  authorizationDecisionId?: string;
  occurredAt: string;
};
```

---

## 5. 运行时统一执行流程

### 5.1 Run 授权主流程

```text
User / Bot 发起任务
-> resolve scope (enterpriseId / seatId / botId / runId)
-> load active SubscriptionRuntimeSnapshot
-> load SeatEntitlementAssignment
-> check subscription state / billing state
-> resolve effective tier/policy/model ceiling
-> check OverAllocationState
-> check Bot / Concurrency / Burst / CreditBucket / Budget / Overage Policy
-> authorizeCommercialRun() emits authorizationDecisionId
-> acquire agent-run slot
-> execute model
-> append UsageLedgerEntry
-> consume CreditBucket
-> release agent-run slot
```

建议新增：

- `src/gateway/billing/authorize-commercial-run.ts`

由其统一编排现有模块：

- `subscriptions-store.ts`
- `resolve-enterprise-entitlement.ts`
- `agent-run-governance.ts`
- `employee-model-gate.ts`
- `constraint-engine.ts`
- `enforce.ts`
- `record-credit-usage.ts`

### 5.2 Bot 创建流程

```text
create-bot request
-> load SubscriptionRuntimeSnapshot
-> check OverAllocationState
-> check tenant maxBots
-> check seat profile / user bot quota
-> create bot or reject
```

### 5.3 Seat 分配流程

```text
admin assign seat
-> load SubscriptionRuntimeSnapshot
-> allocate SeatRole
-> allocate SeatEntitlementProfile
-> if over quota: reject or mark suspended seat assignment
-> apply model grant profile
```

---

## 6. 套餐变更规则

### 6.1 升级

默认规则：立即生效

执行步骤：

1. 生成新的 `SubscriptionRuntimeSnapshot`
2. 计算 Proration 差价
3. 追加 `proration_bonus` bucket
4. 刷新 seat profile ceiling
5. 清理可自动恢复的 over-allocation

Credits 规则：

- 不回收旧额度
- 仅补发新增部分在剩余周期的比例额度

建议公式：

```text
topUp = max(0, round((targetMonthlyCredits - currentPlanMonthlyCredits) * remainingRatio))
```

### 6.2 降级

默认规则：下一周期生效

执行步骤：

1. 当前周期只写 `pendingChange`
2. 周期切换时生成新 `SubscriptionRuntimeSnapshot`
3. 立即计算 `OverAllocationState`
4. 不删除 Seats / Bots / Grants
5. 阻止任何使超配更严重的新动作

### 6.3 续费

默认规则：

- 合同窗口刷新
- 不改当前 runtime snapshot 的能力事实
- 若续费同时续到新版本，则走 transition engine 生成新 snapshot

### 6.4 Credits 充值

默认规则：

- 不并入 `plan_cycle` bucket
- 单独写 `recharge` bucket
- 账单、客服、财务界面都能区分“月配额”与“买的包”

---

## 7. 分阶段实施计划

阶段优先级按专家复核意见冻结为：

- P0：对象定义、运行时真相链、硬并发与统一商业闸口
- P1：企业内 AI 席位分层、Ownership、Burst 与财务归属
- P2：更精细的成本算法与治理能力

说明：

- `P0` 由下面的 `Phase 0` 与 `Phase 1` 共同构成。
- `P1` 由下面的 `Phase 2` 与 `Phase 3` 共同构成。
- `P2` 对应下面的 `Phase 4`。

## Phase 0 - 冻结概念与真相链

目标：先冻结商业对象定义，再让“版本锁定”从价格扩展到权益与模型绑定

改动：

1. 文档与类型同时冻结：
   - `Seat = 人`
   - `Bot = AI 员工`
   - `Run = AI 执行`
   - `Workflow = 持久编排资产`
2. `platform-plan-bundle.ts`
   - 禁止修改 active 或 referenced `planVersionId` 的 entitlement/binding
3. `resolve-enterprise-entitlement.ts`
   - 默认不再回退到动态 `PlanVersion`
4. `resolve-plan-version-entitlement.ts`
   - 默认不再回退到空 binding/默认并发
5. `usage-ledger-store.ts` + `record-credit-usage.ts`
   - 扩展 ledger 字段

验收：

- Seat / Bot / Run / Workflow 定义在文档与代码层一致
- 订阅运行时不再读取 Plan 头
- 运营无法“原地修改”已生效版本的能力事实

## Phase 1 - 上线 Subscription Runtime Snapshot + authorizeCommercialRun() + Hard Concurrency

目标：让所有 AI 执行入口都基于统一运行时真相、统一商业闸口与统一硬并发治理

改动：

1. 新增 `subscription-runtime-snapshots-store.ts`
2. 新增 `subscription-transition-engine.ts`
3. 新增 `authorize-commercial-run.ts`
4. 收口 `constraint-engine` 与执行前商业约束链
5. `subscriptions.subscribe`
6. `subscriptions.change-plan`
7. `order-fulfillment.ts`
8. 周期切换调度点
9. 将现有 `agent-run-registry.ts` 接入唯一并发占槽入口
10. 将以下入口统一接入：

- Chat
- Workflow
- Bot Run
- Agent Run
- Batch Task
- Automation
- API

验收：

- subscribe / upgrade / downgrade / renew 都生成可审计 snapshot
- 当前企业任意一次运行，都能追溯到唯一 `subscriptionSnapshotId`
- 所有 AI 执行入口都先经过 `authorizeCommercialRun()`
- 不再存在绕过 `agent-run-registry` 的并发执行路径

## Phase 2 - 上线 Ownership、Seat Entitlement、Burst 与 Forecast

目标：支持企业内不同席位绑定不同 AI 档位，建立 Seat -> Bot ownership，并补齐企业体验关键能力

改动：

1. 新增 `over-allocation-store.ts`
2. 升级 `bot-resources-store.ts`，引入 `ownerSeatId` 与 `visibility`
3. 新增 `seat-entitlement-assignments-store.ts`
4. 新增企业 AI 岗位模板
5. 引入 `ConcurrencyPolicy` 与 Burst 能力
6. 新增 `Usage Forecast Engine`
7. 改造 `seats.assign`、`seats.set-role`
8. 改造 `employee-model-gate.ts`
9. 改造 `bootstrap-seat-allocation.ts`
10. 在订阅降级与周期切换时生成 `commercialGovernanceStatus`
11. 企业前台文案去模型化，默认使用“AI工作额度”等价值口径

验收：

- 同一企业可同时存在 `basic_ai / pro_ai / elite_ai`
- Seat 可以稳定归属到 Bot，Bot 可以稳定归属到 Run 成本
- 企业可看到月底预计消耗与预计超额
- 企业高峰流量可走 Burst/Queue/PAYG 策略
- 降级后不删资产，只出现清晰的超配治理状态
- UI 能明确展示“禁止新增、等待治理、自助恢复”的状态

## Phase 3 - 上线 Credit Buckets + Reconciliation

目标：让 Credits 与财务归属真正可核对，同时不改变当前 credits 定价语义

改动：

1. 新增 `credit-buckets-store.ts`
2. 改造 `tenant-credits-store.ts` 为兼容层或迁移层
3. 改造 `record-credit-usage.ts`
4. 新增 `billing-reconciliation.ts`
5. 改造 forecast / economics / dashboard

验收：

- 月配额、充值、补差额可单独对账
- Credits 余额与 ledger 可做双向 reconciliation

## Phase 4 - Credits v2 与治理增强（独立 ADR）

目标：在不打断当前商业主线的前提下，升级到更精细的成本映射与治理能力

改动：

1. 产出 `Credits v2` 独立 ADR
2. 设计 token-weight / tool-weight / runtime-weight credits 公式
3. 校准 forecast / economics / reconciliation 新口径
4. 增补 Enterprise AI Governance：
   - 审计
   - 审批
   - 合规
   - 私有模型治理

验收：

- `Credits v2` 具备独立开关与迁移路径
- 不影响既有 snapshot、ledger、bill 的历史复算

---

## 8. 最终落地结论

对 OpenBot 来说，当前最正确的路线不是继续扩静态套餐页面，而是：

1. 保留现有 `Plan / PlanVersion / EntitlementSnapshot / Commerce` 主骨架
2. 先冻结 `Seat / Bot / Run / Workflow` 的商业定义
3. 把 entitlement 与 model binding 从“可更新配置”升级为“冻结版本事实”
4. 先落地 `SubscriptionRuntimeSnapshot` 与 `authorizeCommercialRun()`，统一运行时真相链
5. 把现有 `agent-run-registry` 升格为所有并发执行路径的强制占槽真源
6. 建立 `Seat -> Bot -> Run` ownership 模型
7. 把 `SeatRole` 与 `SeatEntitlementProfile` 分层
8. 用 `OverAllocationState` 解决降级事故
9. 用 `ConcurrencyPolicy + Burst` 提升企业高峰体验
10. 用 `CreditBucket + UsageLedger + Forecast` 解决 Credits、账单、成本一致性
11. 把 `Credits v2` 留在后续 ADR，不阻塞当前商业运行时主线
12. 企业前台默认展示“AI 员工数量、团队规模、AI 同时工作能力、AI工作额度”，而不是模型名与 tier 术语

只有完成这一步，OpenBot 的套餐系统才会从：

```text
静态套餐配置
```

升级为：

```text
可执行、可审计、可升级、可降级、可对账的 Commercial Runtime
```
