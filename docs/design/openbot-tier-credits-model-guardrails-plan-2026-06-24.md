# OpenBot Tier / Credits / Model Guardrails 优化改造方案

Date: 2026-06-24

Status: Draft - 基于当前实现现状的语义收敛与渐进改造方案

Audience: Platform Pricing、Resource Catalog、Gateway/Billing、Model Entitlement、Enterprise UI

Related:

- [OpenBot Commercial Runtime 套餐计费落地方案](/design/openbot-commercial-runtime-billing-plan-2026-06-23)
- [平台套餐权益架构与预警闭环设计](/design/platform-plan-entitlement-architecture-2026-06-20)
- [Tier / Policy 定义](/design/platform-pricing-tiers-2026-06-16)

---

## 0. 执行摘要

当前 OpenBot 在套餐建模上同时存在三层概念：

1. `Tier`：资源能力层
2. `Credits`：套餐级 AI 预算
3. `modelQuota`：模型级额度字段

问题不在于“有没有这些字段”，而在于：

- 这三者的职责边界还没有完全冻结
- 平台端套餐页仍让运营同时配置 `allowedTiers + allowedModelIds + modelQuota`
- 用户容易误以为：
  - 选 Tier 后还要重复选模型
  - modelQuota 决定 Credits 结构

本方案的最终结论是：

```text
Tier 决定“能用哪些模型池”
Credits 决定“套餐总预算”
modelQuota 决定“某个模型的高级子限制”
```

因此：

1. `Tier` 应成为套餐主配置
2. 模型列表应由 Tier 自动投影，默认只读预览
3. `modelQuota` 应降级为高级控制，不参与 Credits 主结构
4. 若未来真要做“模型级预算分账”，必须新增独立概念，而不是复用 `modelQuota`

---

## 1. 当前代码现状

### 1.1 Tier 已经是独立能力层

资源目录已经把 Tier 和模型目录解耦：

- `src/gateway/resource-catalog/types.ts`
- `src/gateway/resource-catalog/models-catalog-store.ts`

当前语义：

- `Tier` 只是模型池分层
- 模型条目记录自己属于哪个 `tier`
- Tier 本身不带套餐额度语义

### 1.2 套餐绑定仍是双轨

当前套餐版本绑定在：

- `src/gateway/model-entitlement/plan-version-model-binding-store.ts`

同时保存：

- `allowedTiers`
- `allowedModelIds`
- `allowedPolicies`
- `modelQuota`

这意味着当前系统实际上仍是“双轨真相”：

```text
Tier 一套
模型显式选择又一套
```

### 1.3 运行时默认仍偏 legacy

在：

- `src/gateway/model-entitlement/entitlement-config.ts`
- `src/gateway/model-entitlement/tier-routing.ts`

当前默认 `routingMode = "legacy"`，即：

- 默认还是 `allowedModelIds` 为真源
- 只有显式切到 `tier` 时才由 `allowedTiers` 自动投影模型池

### 1.4 系统已经承认 Tier 与模型列表可能不一致

在：

- `src/gateway/resource-catalog/doctor-checks.ts`

已有一致性检查：

- `allowedTiers` 投影出的模型池
- 与 `allowedModelIds`

如果不一致就报：

- `binding_tier_mismatch`

这说明当前实现已经暴露出同一个结构性问题：

> 套餐页不应该要求运营同时维护 Tier 和模型两份真相。

### 1.5 Credits 主链当前并不读取 modelQuota

Credits 计量主链在：

- `src/gateway/billing/credit-meter.ts`
- `src/gateway/billing/record-credit-usage.ts`

当前 Credits 的真实计算依据是：

- 模型所在 `tier`
- `CreditWeight`
- token 用量加权

当前 **没有读取 `modelQuota` 来决定 Credits 结构**。

这说明：

> 现有 `modelQuota` 不是 Credits 主预算结构，而只是一个尚未完全收敛语义的高级限制字段。

---

## 2. 语义冻结

### 2.1 Tier

`Tier` 定义：

```text
Tier = 模型能力层 / 模型池分组
```

职责：

- 表达套餐开放了哪些能力层
- 表达企业与员工允许访问的模型池上界
- 支撑 AOR / Policy / 成本投影 / 能力描述

不负责：

- 套餐总预算
- 单模型调用上限

### 2.2 Credits

`Credits` 定义：

```text
Credits = 套餐级 AI 工作额度 / 总预算
```

职责：

- 表达整个套餐周期内的总 AI 使用预算
- 表达企业级月配额、充值包、补差额
- 支撑 Forecast / Budget / Reconciliation

不负责：

- 决定具体开放哪些模型
- 单模型精细额度结构

### 2.3 modelQuota

`modelQuota` 当前建议重新解释为：

```text
某个模型的高级子限制 / guardrail
```

适用场景：

1. 某模型特别贵
2. 某模型是试点灰度
3. 某模型要单独限流
4. 某模型要在同 Tier 内受更严格治理

不建议把它解释成：

```text
Credits 的结构性分配器
```

---

## 3. 核心判断

### 3.1 同样是 Tier A，不同套餐额度不一样，是否合理

合理。

但要区分两种“额度”：

#### 情况 A：套餐总额度不同

例如：

- Starter：`allowedTiers = [tier_a]` + `monthlyCredits = 3,000`
- Professional：`allowedTiers = [tier_a]` + `monthlyCredits = 30,000`

这完全合理。

因为：

- `Tier A` 一样
- 套餐总预算不同

#### 情况 B：Tier A 中某个模型的单独额度不同

例如：

- Starter：`Tier A` 下 `claude-sonnet = 100`
- Professional：`Tier A` 下 `claude-sonnet = 1000`

这也成立。

但这表达的是：

```text
modelQuota 不同
```

不是：

```text
Tier A 自身不同
```

### 3.2 modelQuota 是否决定 Credits 结构

不建议这样定义。

原因：

1. 当前代码实现并非如此
2. 这样会把套餐总预算与模型级限制混成一层
3. 后续对账、Forecast、产品认知都会变复杂

如果未来真要实现：

```text
不同模型分配不同 Credits 预算
```

应新增独立概念，例如：

- `ModelBudget`
- `ModelCreditBucket`
- `ModelSpendCap`

而不是继续沿用 `modelQuota` 这个名字。

---

## 4. 目标架构

最终建议把这三层改造成：

```text
Resource Catalog
  -> Tier
  -> Model Pool

PlanVersion Binding
  -> allowedTiers
  -> allowedPolicies
  -> policyId
  -> resolvedModelIds (derived / cache)
  -> modelGuardrails (advanced only)

Commercial Runtime
  -> Credits (package-level)
  -> Credit Buckets
  -> Usage Ledger

Advanced Control
  -> per-model request cap
  -> per-model token cap
  -> optional future model budget
```

---

## 5. 具体改造方案

## Phase 0 - 语义冻结

目标：

- 把 Tier、Credits、modelQuota 的职责正式定死

动作：

1. 文档冻结：
   - `Tier = 能力层`
   - `Credits = 套餐总预算`
   - `modelQuota = 高级模型 guardrail`
2. 在平台端、企业端、后端注释中统一术语
3. 停止把 modelQuota 当作默认基础配置宣传

验收：

- 文档、代码注释、前台文案对三者语义一致

## Phase 1 - 套餐页改成 Tier 主配置

目标：

- 套餐页不再要求运营手工勾选模型作为主流程

动作：

1. 平台套餐页：
   - 主配置保留 `allowedTiers`
   - 模型池改成 `Tier 自动解析模型池`
   - 默认只读预览
2. 保存时：
   - 用 `platform-resource-catalog.resolve-tiers`
   - 自动投影出 `allowedModelIds`
   - 继续写给后端，保持企业端/员工端兼容
3. 不再要求运营维护两份真相

验收：

- 选 Tier 后能自动看到模型池
- 保存时后端拿到自动投影的 `allowedModelIds`
- 企业端/员工端现有链路不受影响

## Phase 2 - modelQuota 下沉到高级控制

目标：

- 把 `modelQuota` 从主编辑表单移出

动作：

1. 默认套餐编辑页不展示模型额度输入
2. 新增高级折叠区或高级抽屉：
   - “高级模型控制”
3. 只在高级区展示：
   - 单模型 request cap
   - 单模型 token cap
4. 保持默认运营视角简洁

验收：

- 普通套餐配置只需关心 Tier / Credits / Concurrency / Policy
- 高级控制仍可配置模型级 guardrail

## Phase 3 - 后端结构收敛

目标：

- 从“双轨真相”过渡到“Tier 为主，模型列表为派生”

动作：

1. 保留 `allowedModelIds` 作为兼容输出字段
2. 逐步把它视为：
   - `resolvedModelIds`
   - 来自 `allowedTiers` 的派生缓存
3. `doctor-checks` 从“人工双配一致性校验”
   逐步收敛为“派生结果是否健康”

验收：

- Tier 变成配置真源
- 模型列表变成可解释派生结果

## Phase 4 - 如确有需要，再做模型级预算

目标：

- 仅在确实需要“模型级预算分账”时新增独立能力

动作：

1. 不复用 `modelQuota`
2. 新增独立结构，例如：

```ts
type ModelBudget = {
  modelId: string;
  monthlyCreditsCap?: number;
  spendCapCents?: number;
};
```

3. 与 `CreditBucket / UsageLedger / Forecast` 联动

验收：

- 模型级预算与套餐总预算口径分离
- 不破坏现有 Credits 主链

---

## 6. 前台交互建议

### 套餐页主流程

只展示：

1. 可用资源层级
2. 路由策略
3. 总 Credits / AI 工作额度
4. 并发
5. Seats / Bots

模型区变成：

```text
Tier 自动解析模型池
```

默认只读。

### 高级控制区

放：

1. per-model request cap
2. per-model token cap
3. AOR 高级选项

这部分只有高级运营或平台管理员才需要。

---

## 7. 对当前现状的最小改造建议

如果只做最小改造，我建议优先落地这三件事：

1. 套餐页：`Tier` 主配置，模型改成只读预览
2. `modelQuota` 从主表单移到“高级控制”
3. 文案明确：
   - `Credits = AI工作额度`
   - `modelQuota = 模型高级限制`

这样能最小成本解决当前几个核心问题：

- 为什么选了 Tier 还要选模型
- 为什么不同套餐同 Tier 看起来额度不一样
- 为什么 `modelQuota` 容易被误解成 Credits 结构

---

## 8. 最终结论

对 OpenBot 来说，最合理的结构是：

1. `Tier` 负责决定模型池
2. `Credits` 负责决定套餐总预算
3. `modelQuota` 负责决定某个模型的高级子限制

所以：

**同样都选 Tier A，不同套餐额度不同，是合理的。**

但这个“额度不同”默认应体现在：

- `monthlyCredits`
- `maxConcurrentRuns`
- `maxBots`
- `maxSeats`

而不是默认要求运营为每个模型逐个填额度。

`modelQuota` 应该被降级为高级控制，而不是基础配置。
