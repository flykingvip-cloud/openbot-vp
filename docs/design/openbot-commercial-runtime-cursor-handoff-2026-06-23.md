# OpenBot Commercial Runtime - Cursor 实施说明

Date: 2026-06-23

Audience: Cursor 执行者

Final Acceptance Owner: `codex`

Status: Active handoff - 只授权实施 **P0**

Primary design source:

- `docs/design/openbot-commercial-runtime-billing-plan-2026-06-23.md`

Supporting context:

- `docs/design/platform-plan-entitlement-architecture-2026-06-20.md`
- `docs/design/openbot-enterprise-ai-workforce-pricing-master-plan-2026-06-21.md`
- `docs/design/openbot-enterprise-ai-workforce-pricing-execution-breakdown-2026-06-22.md`
- `docs/design/openbot-plan-capacity-contract-frozen-2026-06-22.md`

---

## 1. 先读这个，再动代码

本任务不是“继续做套餐 UI”，也不是“重做一套 Package 系统”。

这次要做的是：

```text
把 OpenBot 当前已有的 billing + entitlement + commerce
收口成真正可运行的 Commercial Runtime。
```

本次 handoff **只做 P0**，不要越界做 P1 / P2。

### 1.1 这次的唯一目标

你要完成的是：

1. 冻结 OpenBot 的核心商业对象定义
2. 冻结运行时真相链
3. 建立统一商业闸口 `authorizeCommercialRun()`
4. 把现有硬并发治理统一接到 `agent-run-registry`
5. 为后续 P1 打下不会返工的基础

### 1.2 这次明确不做

以下内容 **不要做**：

1. 不要引入 `Package` 替换 `Plan / PlanVersion`
2. 不要重写 `commerce / order / proration`
3. 不要做 `Credits v2`
4. 不要做 token-weight economics
5. 不要重写 policy-engine
6. 不要做 P1 的 `Seat -> Bot ownership` 正式落地
7. 不要做 Burst / Queue / PAYG 正式实现
8. 不要做 Forecast Engine 正式实现
9. 不要大改 UI 结构

如果你发现为了做 P0 必须跨进这些范围，先暂停并记录，不要硬做。

---

## 2. 这次必须冻结的概念

在代码注释、类型语义、实现命名上，统一接受以下定义：

| 对象       | 含义             | 是否长期存在 | 是否计费核心 |
| ---------- | ---------------- | ------------ | ------------ |
| `Seat`     | 人类员工席位     | 是           | 是           |
| `Bot`      | AI 员工资产      | 是           | 是           |
| `Run`      | 一次 AI 执行任务 | 否           | 是           |
| `Workflow` | 持久编排逻辑     | 是           | 否           |
| `Credits`  | AI 预算口径      | 否           | 是           |

归属链必须按下面理解：

```text
Enterprise
  -> Seat
    -> Bot
      -> Run
```

注意：

- P0 不要求你正式实现 `ownerSeatId`
- 但 P0 的命名、注释、运行时数据流必须为这个归属链让路

---

## 3. 执行边界

### 3.1 本次只做 P0

P0 = `Phase 0 + Phase 1`，来自主设计文档中的冻结定义。

### 3.2 P0 交付物

你必须交付以下结果：

1. `PlanVersion` 对应的 entitlement / model binding 不再允许在 active 或 referenced 状态下被原地修改
2. 新增 `SubscriptionRuntimeSnapshot` store 与最小物化链路
3. 新增 `authorizeCommercialRun()`，作为执行前统一商业闸口
4. 现有所有硬并发执行路径统一走 `agent-run-registry`
5. Usage Ledger 增加足够的运行时归因字段，至少支撑 snapshot/run 级审计
6. 针对上述变更补齐测试

---

## 4. 先做这些预检

### 4.1 读取并确认上下文

开始改代码前，先完整阅读：

1. `docs/design/openbot-commercial-runtime-billing-plan-2026-06-23.md`
2. 本文档

### 4.2 多 agent 安全

开始前执行：

```sh
bun scripts/agent-attribution.ts
```

如果你看到以下情况，先暂停：

1. 本任务要碰的热文件已有别的 agent 未提交 WIP，且无法安全局部编辑
2. 你需要大面积改共享热文件，无法保持小步提交

### 4.3 提交节奏

强制使用小步迁移：

1. 每个 green checkpoint 立刻提交
2. 不要攒巨大 diff
3. 只提交你实际修改的文件
4. 不要 `git add .`

如果要提交，使用：

```sh
scripts/committer "<message>" <file...>
```

---

## 5. 必须修改的代码范围

### 5.1 P0 核心文件

优先级最高：

- `src/gateway/server-methods/platform-plan-bundle.ts`
- `src/gateway/billing/resolve-enterprise-entitlement.ts`
- `src/gateway/package-entitlement/resolve-plan-version-entitlement.ts`
- `src/gateway/billing/subscriptions-store.ts`
- `src/gateway/billing/subscription-provisioning.ts`
- `src/gateway/commerce/order-fulfillment.ts`
- `src/gateway/billing/agent-run-registry.ts`
- `src/gateway/billing/agent-run-governance.ts`
- `src/gateway/billing/constraint-engine.ts`
- `src/gateway/billing/enforce.ts`
- `src/gateway/billing/record-credit-usage.ts`
- `src/gateway/billing/usage-ledger-store.ts`
- `src/gateway/model-entitlement/employee-model-gate.ts`

### 5.2 需要 review 并接线的执行入口

以下调用点必须 review。原则是：

- 如果它是执行前入口，必须改成先走 `authorizeCommercialRun()`
- 如果它是执行后记账入口，必须和 `authorizeCommercialRun()` 的输出对齐
- 如果它不是执行入口，要在代码注释或 handoff 备注里说明原因

当前已知调用点：

- `src/auto-reply/reply/agent-runner-execution.ts`
- `src/auto-reply/reply/followup-runner.ts`
- `src/cron/isolated-agent/run.ts`
- `src/gateway/server-methods/resources.ts`
- `src/gateway/server-methods/usage-ingest.ts`

### 5.3 允许新增的文件

P0 允许新增：

- `src/gateway/billing/subscription-runtime-snapshots-store.ts`
- `src/gateway/billing/subscription-transition-engine.ts`
- `src/gateway/billing/authorize-commercial-run.ts`

如有必要，可新增对应测试文件。

---

## 6. 详细实施步骤

按下面顺序做，不要跳步。

### Step A - 冻结 active/referenced planVersion 的能力事实

目标：

- 已经 active 的版本，或者已经被订阅引用的版本，不能再原地改 entitlement / model binding

实施要求：

1. 在 `platform-plan-bundle.ts` 的 write 路径里加守卫
2. 结合：
   - `planVersion.status`
   - `isPlanVersionReferenced()`
3. 对 active 或 referenced 版本：
   - 拒绝更新 entitlement snapshot
   - 拒绝更新 model binding
4. 任何能力变化都必须通过新 `PlanVersion` 承载

验收要点：

- 不能只在 UI 层阻止
- 必须是服务端 hard reject

### Step B - 新增 `SubscriptionRuntimeSnapshot`

目标：

- 订阅后的运行时事实变成单对象真相

最低要求：

1. 新增 store
2. 至少包含：
   - `enterpriseId`
   - `subscriptionId`
   - `planId`
   - `planVersionId`
   - `pricingSnapshot`
   - `entitlementSnapshot`
   - `modelBindingSnapshot`
   - `billingMode`
   - `effectiveAt`
3. 在以下路径物化：
   - subscribe
   - change-plan
   - renew fulfillment
   - 任何会切换当前订阅事实的地方

注意：

- P0 先实现“生成 + 读取 + 接线”
- 不要求你一次性完成所有 P1/P2 字段

### Step C - 新增 `authorizeCommercialRun()`

目标：

- 所有 AI 执行前统一经过一个商业闸口

最低职责：

1. 校验 subscription state
2. 解析 runtime snapshot
3. 校验 model entitlement / employee gate
4. 校验 bot / concurrency / credits / budget / overage
5. 输出统一 decision

建议输出至少包括：

- `allowed`
- `authorizationDecisionId`
- `enterpriseId`
- `subscriptionSnapshotId`
- `policyDecision`
- `creditDecision`
- `concurrencyDecision`

注意：

- P0 先做“统一入口”
- 不要求你在 P0 实现 Burst/Queue/PAYG
- 但接口设计必须给后续 `ConcurrencyPolicy` 留口

### Step D - 把硬并发统一接到 `agent-run-registry`

目标：

- 所有需要占并发槽的执行路径，都走同一套 registry acquire/release

要求：

1. 不重写 `agent-run-registry.ts`
2. 把它升格为唯一硬并发占槽真源
3. 所有执行入口不得绕过

最低验收：

- 当前所有 enterprise run 入口都先检查并发再执行
- 不再存在“某个路径不占槽”的情况

### Step E - Usage Ledger 扩字段

目标：

- 至少能追溯到 run/snapshot 级运行事实

P0 最少字段：

- `subscriptionSnapshotId`
- `subscriptionId`
- `runId`（如果上游拿得到）
- `authorizationDecisionId`

如果当前调用链还能稳定拿到，也尽量补：

- `userId`
- `billingSeatId`
- `orgSeatId`
- `botId`

要求：

- 不要为了凑字段破坏当前运行链
- 拿不到的字段可以 optional
- 但必须把 schema 预留好，并在调用链尽可能传递

### Step F - 将已知入口接入统一闸口

这是 P0 最关键的落地点。

作为最低要求，你必须 review 所有当前使用以下函数的入口：

- `resolveEmployeeModelGate()`
- `tryAcquireEnterpriseAgentRun()`
- `recordCreditUsage()`
- `checkEnterpriseBotCreate()`

原则：

1. 执行前路径 -> 改走 `authorizeCommercialRun()`
2. 执行后路径 -> 与 `authorizeCommercialRun()` 的 output 对齐
3. 非执行前路径 -> 明确注释为何不接

如果你发现某条执行路径应该接但你无法安全接入，停止并记录，不要假装完成。

---

## 7. 这次不要实现但要为后续留口的内容

### 7.1 先不要做正式 ownership 落地

P0 不要求实现：

- `ownerSeatId`
- `visibility`

但你要做到：

1. 不再把 `ownerUserId` 进一步固化为最终真源语义
2. 新增逻辑不要依赖“Bot 只能归属于 userId”这个假设

### 7.2 先不要做 Burst

P0 不要求实现：

- `includedRuns`
- `maxBurstRuns`
- `pay_as_you_go`
- `queue`

但你要做到：

1. `authorizeCommercialRun()` 的并发 decision 结构允许后续扩展
2. 不把“并发只有 block”写死到不可扩展的 API 里

### 7.3 先不要做 Forecast Engine

P0 不要求实现 UI 卡片或完整预测引擎。

但你要做到：

1. 新增的 ledger / snapshot 字段足够支撑后续 Forecast
2. 不要把 P0 的数据结构设计成未来无法按日或按周期聚合

---

## 8. 测试要求

### 8.1 必须新增或更新的测试方向

至少覆盖这些场景：

1. active / referenced `planVersion` 无法原地改 entitlement / binding
2. subscribe / change-plan / renew 会物化 `SubscriptionRuntimeSnapshot`
3. `authorizeCommercialRun()`：
   - active 订阅放行
   - 无订阅拒绝或 skip 语义正确
   - credits 不足拒绝
   - 并发超限拒绝
   - budget 超限时按当前控制逻辑处理
4. 所有 enterprise run 路径走同一并发占槽
5. Usage Ledger 能写入新增字段且不破坏幂等

### 8.2 优先跑的测试

先跑最小必要集，优先低压 profile：

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/billing/agent-run-governance.test.ts \
  src/gateway/billing/record-credit-usage.test.ts \
  src/gateway/billing/constraint-engine.test.ts \
  src/gateway/billing/bootstrap-seat-allocation.test.ts \
  src/gateway/model-entitlement/employee-model-gate.aor.test.ts \
  src/gateway/model-entitlement/employee-model-gate.all-bot-runs.test.ts
```

补充执行：

```sh
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/server-methods/billing.test.ts \
  src/gateway/server-methods/commercial.test.ts \
  src/gateway/server-methods/platform-plan-bundle.test.ts
```

如果你新增了新文件测试，也把它们纳入 scoped run。

如果你改动了构建边界，最后再跑：

```sh
pnpm build
```

---

## 9. Stop Conditions

出现以下情况，暂停并记录，不要继续硬做：

1. 你无法明确识别某条 AI 执行路径是否属于执行前入口
2. 你发现还有更多绕过路径，但无法在当前 shared tree 中安全接线
3. 为了做 P0，你必须跨入 `Credits v2`、Burst 正式实现、ownership 正式落地
4. 你需要大改 UI 才能让后端方案成立
5. 共享热文件存在别的 agent 未提交冲突，无法局部编辑

---

## 10. 交付格式

完成后请把结果交回 `codex` 验收，并同时给出：

1. 改动摘要
2. 实际接入了哪些执行入口
3. 哪些入口仍未接入，以及原因
4. 跑过哪些测试
5. 还有哪些风险故意留给 P1

如果你只完成了部分内容，也必须明确：

- 完成了什么
- 没完成什么
- 为什么没完成

不要用“后续可以再做”掩盖 P0 未闭环的问题。

---

## 11. 最终验收标准

`codex` 最终只按下面标准验收：

1. **概念是否收口**
   - `Seat / Bot / Run / Workflow` 语义是否统一
2. **真相链是否冻结**
   - active / referenced version 是否不能原地改能力事实
3. **运行闸口是否统一**
   - 是否出现了真实的 `authorizeCommercialRun()`
4. **并发是否统一**
   - enterprise run 是否都走 `agent-run-registry`
5. **订阅快照是否成型**
   - 是否有可读写的 `SubscriptionRuntimeSnapshot`
6. **审计是否增强**
   - ledger 是否至少带 snapshot / run / decision 级字段
7. **范围是否守住**
   - 没有越界去做 `Credits v2` / Commerce 重构 / Burst 正式实现

如果以上 7 条有任意一条不成立，P0 不通过。
