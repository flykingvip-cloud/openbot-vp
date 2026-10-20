# OpenBot 企业端 AI 劳动力套餐实施拆解

Date: 2026-06-22

Status: Draft — 面向实施团队的执行拆解

Audience: 企业端 UI、Gateway/Billing、平台套餐运营、QA

Related:

- `docs/design/openbot-enterprise-ai-workforce-pricing-master-plan-2026-06-21.md`
- `docs/design/openbot-plan-requirements-guided-selection-2026-06-21.md`
- `docs/design/openbot-enterprise-cost-budget-ia-consolidation-2026-06-19.md`
- `docs/design/platform-plan-entitlement-architecture-2026-06-20.md`

---

## 0. 目标

把两份方案收敛成实施团队可直接执行的任务拆解，并遵守当前代码现实：

1. **不推翻** 已冻结的企业端 4 Tab IA
2. 基于现有 `cost-budget` 模块做**渐进增强**
3. 先冻结套餐 contract，再做推荐与展示
4. 先做企业用户可感知改造，再做平台运营增强

---

## 1. 实施总原则

### 1.1 必须遵守的现状约束

- 企业端「成本与预算」仍是 4 个视觉 Tab：
  - `overview`
  - `commerce`（`subscription / orders / invoices`）
  - `seats`
  - `settings`（`control / resources / analytics`）
- `loadAll()` 仍是模块级聚合加载入口，不在本拆解里重构为懒加载框架。
- `commercial-orders.list` 仍然由订单页 lazy load，不扩进 `loadAll()`。
- 现有 `subscriptions.*`、`enterprise-allocation.*`、`commercial-*`、`billing.*` RPC 语义不变。

### 1.2 实施顺序原则

```text
先冻结 contract
→ 再做展示模型
→ 再做企业端选购向导
→ 再做购后摘要与进度
→ 最后做平台运营联动
```

### 1.3 不建议并行推进的部分

以下内容强依赖上游冻结，不建议提前开做：

- 推荐引擎真实规则
- 套餐结果页第一层 Capacity 数字
- 平台端画像字段
- Enterprise / Business 差异化展示

原因：这些都依赖统一的套餐 contract 数值表。

---

## 2. 阶段总览

| 阶段    | 目标                     | 产出重点                                         |
| ------- | ------------------------ | ------------------------------------------------ |
| Phase 0 | 冻结套餐 contract 真相   | 五档数值、展示模型、字段映射                     |
| Phase 1 | 企业端选购主路径         | 总览 Hero、catalog Landing、需求向导、推荐结果   |
| Phase 2 | 购后套餐中枢             | 当前套餐摘要、容量进度、换套餐/续费/加量路径收直 |
| Phase 3 | 平台端套餐画像与运营配置 | targetPersonas、匹配 hints、套餐详情配置入口     |
| Phase 4 | 成本/毛利/预警联动       | 平台经营视图、企业升级建议、风险闭环             |

---

## 3. Phase 0 — Contract 冻结

### 3.1 目标

输出一份实施团队与运营团队都能用的**唯一套餐真相表**，明确以下字段：

- `maxSeats`
- `maxBots`
- `maxConcurrentRuns`
- `monthlyCredits`
- `allowedTiers`
- `allowedPolicies`
- `policyId`
- `overagePolicy`
- `supportTier`
- `slaTarget`
- `salesMotion`
- `displayHighlights`

### 3.2 依赖

- `platform-plan-entitlement-architecture-2026-06-20.md`
- `platform-pricing-tiers-2026-06-16.md`

### 3.3 交付项

#### A. 冻结五档 contract 数值

输出表格并签字确认：

- Trial
- Starter
- Professional
- Business
- Enterprise

要求：

- 一档一行
- 每项 Capacity 数值必须唯一
- 不允许卡片文案和 contract 数值分离

#### B. 定义展示映射层

新增一个共享展示模型，用于把套餐 contract 转换为前端卡片第一层/第二层展示。

建议新建：

- `ui/src/ui/views/cost-budget/plan-capacity-display.ts`

内容：

- `buildPlanCapacitySummary(meta)`
- `buildPlanCapabilityBullets(meta)`
- `buildPlanExpansionHints(meta)`

#### C. 校正现有静态权益来源

当前 `pricing-comparison-view.ts` 里的静态权益映射只能作为过渡。

Phase 0 要求：

- 不再新增新的静态 benefit key
- 标记哪些文案已有后端字段来源
- 标记哪些文案需后续迁移到 contract

### 3.4 文件级任务

| 文件                                                               | 动作                               |
| ------------------------------------------------------------------ | ---------------------------------- |
| `docs/design/platform-pricing-tiers-2026-06-16.md`                 | 作为数值冻结参考，不直接继续扩文案 |
| `docs/design/platform-plan-entitlement-architecture-2026-06-20.md` | 对齐字段分层                       |
| `ui/src/ui/ports/platform/pricing/pricing-comparison-view.ts`      | 停止继续堆静态权益                 |
| `ui/src/ui/views/cost-budget/plan-capacity-display.ts`（新）       | 新建展示模型层                     |

### 3.5 验收标准

- 所有套餐第一层核心数字有唯一真相
- 展示模型可以只依赖套餐 contract 生成第一层展示
- 实施团队无需再猜 Starter/Professional/Business 的实际上限

---

## 4. Phase 1 — 企业端选购主路径

### 4.1 目标

在不破坏 4 Tab 架构的前提下，把企业用户首次进入模块时的主路径改成：

```text
总览 Hero
→ 订阅与订单 / 套餐目录
→ 需求引导向导
→ 推荐结果
→ 套餐详情
→ 订阅
```

### 4.2 依赖

- Phase 0 contract 冻结
- 现有 `commercePanel` 三 panel 架构

### 4.3 模块拆分

建议新增目录：

- `ui/src/ui/views/cost-budget/cost-budget-plan-selector/`

建议文件：

- `landing.ts`
- `wizard.ts`
- `wizard-state.ts`
- `matching-engine.ts`
- `matching-reasons.ts`
- `recommendation-page.ts`
- `plan-detail-sections.ts`
- `compare-entry.ts`

### 4.4 具体任务

#### A. 总览 Hero 双入口

位置：

- `ui/src/ui/views/cost-budget/cost-budget-page.ts`

任务：

- 未订阅时移除“只剩空态”的体验
- 在 `overview` 顶部增加：
  - `开始智能推荐`
  - `查看全部套餐`
- 保留现有 todos、forecast、summary，不做大重排

建议抽文件：

- `ui/src/ui/views/cost-budget/cost-budget-overview-subscribe-hero.ts`

#### B. 订阅与订单 / 套餐目录 Landing

位置：

- `renderSubscriptionCatalog()`

任务：

- 在现有 `catalog` panel 里增加双入口 Landing
- 默认展示：
  - 向导入口
  - 完整对比表入口
- 不是直接展示全量卡片列表

#### C. 需求引导向导

输入维度按子方案冻结：

- 团队规模
- 主要场景
- 模型广度
- 月消耗强度
- Bot / 自动化需求

要求：

- 全前端状态
- 不引入新 RPC
- 可随时跳过

#### D. 规则推荐引擎

建议实现位置：

- `ui/src/ui/views/cost-budget/cost-budget-plan-selector/matching-engine.ts`

要求：

- 只做 deterministic rule engine
- 不引入 LLM
- 至少输出：
  - `primaryRecommendation`
  - `alternativeRecommendation`
  - `reasons[]`

数据来源：

- `availablePlans`
- contract 冻结表
- 预估规则

#### E. 推荐结果页

结果页展示三层内容：

1. 标准权益
2. 套餐内扩展
3. 套餐外扩展

要求：

- 使用 `plan-capacity-display.ts`
- 使用现有 `renderPricingComparison` 作为完整对比次级入口
- CTA 最终仍调用现有 `subscribe` / `changePlan`

### 4.5 文件级任务

| 文件                                                            | 动作                                     |
| --------------------------------------------------------------- | ---------------------------------------- |
| `ui/src/ui/views/cost-budget/cost-budget-page.ts`               | 接 Hero、接 catalog 新入口               |
| `ui/src/ui/views/cost-budget/cost-budget-nav.ts`                | 不改路由结构，仅新增必要 label 支持      |
| `ui/src/ui/views/cost-budget/cost-budget-plan-selector/*`（新） | 向导与推荐结果核心模块                   |
| `ui/src/ui/views/cost-budget/plan-capacity-display.ts`          | 结果页复用                               |
| `ui/src/ui/views/cost-budget/cost-budget-page.browser.test.ts`  | 增未订阅 Hero、catalog landing、跳转断言 |

### 4.6 验收标准

- 未订阅用户不需要先理解套餐名就能开始选购
- Hero 与 catalog Landing 都可进入选购主路径
- 推荐结果有可解释理由
- 最终仍走现有订阅 RPC

---

## 5. Phase 2 — 购后套餐中枢

### 5.1 目标

让已订阅企业在 `commerce/plan` 里能直接看懂：

- 当前套餐是什么
- 当前用了多少
- 套餐内还能怎么调
- 什么情况下需要升级 / 加量 / 联系销售

### 5.2 依赖

- Phase 0 展示模型层
- 企业 allocation / roleProfiles / resources / forecast

### 5.3 具体任务

#### A. 当前套餐摘要增强

位置：

- `renderSubscriptionPlan()`

补充：

- 第一层 Capacity 摘要
- 合同窗
- 当前 entitlement 层级
- 当前 credits / seats / bots / concurrency 使用情况

#### B. 生命周期进度条

位置：

- `overview`
- `commerce/plan`

状态：

- 已订阅
- 待分配席位
- 已验证模型授权

#### C. 套餐内扩展说明

直接深链到：

- `seats`
- role 模板
- 岗位级模型微调
- 全量同步授权

不是新功能，而是把现有能力前置解释清楚。

#### D. 套餐外扩展说明

统一入口到：

- `createRechargeOrder`
- `changePlan`
- 联系销售

### 5.4 文件级任务

| 文件                                                     | 动作                             |
| -------------------------------------------------------- | -------------------------------- |
| `ui/src/ui/views/cost-budget/cost-budget-page.ts`        | 增当前套餐摘要、进度条、扩展区块 |
| `ui/src/ui/views/cost-budget/cost-budget-seats-panel.ts` | 作为套餐内扩展深链目标，不大改   |
| `ui/src/ui/views/cost-budget/plan-capacity-display.ts`   | 提供购后摘要渲染                 |

### 5.5 验收标准

- 已订阅用户可以在 1 屏内理解“当前套餐 + 当前使用 + 下一步动作”
- 套餐内扩展与套餐外扩展边界清晰
- 与 seats / orders / recharge 流程深链连通

---

## 6. Phase 3 — 平台端套餐画像与配置增强

### 6.1 目标

让平台运营在创建或维护套餐时，不只是在填价格和模型绑定，而是在定义：

- 这份套餐服务什么企业画像
- 它主打什么使用方式
- 推荐逻辑如何偏向某些场景

### 6.2 依赖

- Phase 0 contract
- 现有 `platform-plan-bundle.*`

### 6.3 具体任务

#### A. 增加套餐画像元数据

建议新增字段：

- `targetPersonas`
- `matchingPriority`
- `inPlanFlexibilityNotes`
- `beyondPlanNotes`

可先挂在 bundle 侧元数据，不要求第一天就进入 entitlement 主模型。

#### B. 平台创建流语义增强

当前位置：

- `ui/src/ui/ports/platform/pricing/page.ts`

建议不是重做，而是在现有编辑区增加：

- 目标客户画像
- 推荐场景
- 套餐内扩展说明
- 套餐外扩展说明

#### C. preview-allocation 复用

平台侧应能直接预览：

- 这个套餐下 viewer / creator / admin 会得到什么能力

也就是把企业端会看到的内容，在平台端先看到。

### 6.4 文件级任务

| 文件                                                     | 动作                       |
| -------------------------------------------------------- | -------------------------- |
| `ui/src/ui/ports/platform/pricing/page.ts`               | 增套餐画像与推荐说明编辑区 |
| `ui/src/ui/capability/platform-plan-bundle/endpoints.ts` | 扩 metadata 类型           |
| `src/gateway/server-methods/platform-plan-bundle.ts`     | 扩 bundle 元数据保存/回传  |

### 6.5 验收标准

- 平台可以配置套餐服务对象与推荐提示
- 平台可以看到 roleProfiles 预览
- 企业端推荐引擎不需要硬编码套餐特例

---

## 7. Phase 4 — 成本、毛利、风险联动

### 7.1 目标

把企业端“推荐套餐”和平台端“套餐成本/毛利/风险”联到一起，避免：

- 推荐了用户喜欢的套餐
- 但平台亏钱

### 7.2 依赖

- 现有 `platform-economics`
- `package-margin`
- `consumption-forecast`

### 7.3 具体任务

#### A. 企业端建议联动

推荐结果页可以逐步增加：

- 当前推荐套餐适不适合长期使用
- 未来 30 天可能先触顶的是并发、Credits 还是 Bot

#### B. 平台端经营联动

平台端套餐页要能看到：

- 目标毛利
- 当前毛利
- forecast 风险
- 哪些企业在频繁触发升级建议

#### C. 推荐与毛利保护规则

推荐引擎后续可以加入一条运营规则：

- 在多个套餐都满足条件时，优先推荐“最小满足且毛利健康”的套餐

不是简单按最低价推荐。

### 7.4 文件级任务

| 文件                                                               | 动作                                 |
| ------------------------------------------------------------------ | ------------------------------------ |
| `ui/src/ui/ports/platform/pricing/economics-section.ts`            | 增与套餐推荐相关的经营视角           |
| `src/gateway/consumption-forecast/*`                               | 如有必要补推荐输入，不先新增复杂逻辑 |
| `docs/design/platform-plan-entitlement-architecture-2026-06-20.md` | 同步 contract 与预警闭环             |

### 7.5 验收标准

- 平台能解释“为什么这个套餐被推荐”
- 运营能看到“这个套餐推荐出去是否健康”
- 企业端与平台端不再各说各话

---

## 8. 依赖顺序

```text
Phase 0
  ↓
Phase 1
  ↓
Phase 2
  ↓
Phase 3
  ↓
Phase 4
```

更细粒度依赖：

1. `contract 冻结`
2. `plan-capacity-display`
3. `catalog landing`
4. `wizard + matching-engine`
5. `recommendation page`
6. `current plan summary`
7. `platform metadata`
8. `economics linkage`

---

## 9. 实施团队分模块建议

### 模块 A：企业端总览与 catalog

适合负责文件：

- `ui/src/ui/views/cost-budget/cost-budget-page.ts`
- `ui/src/ui/views/cost-budget/cost-budget-overview-*.ts`
- `ui/src/ui/views/cost-budget/cost-budget-plan-selector/*`

### 模块 B：套餐展示与共享 display model

适合负责文件：

- `ui/src/ui/views/cost-budget/plan-capacity-display.ts`
- `ui/src/ui/ports/platform/pricing/pricing-comparison-view.ts`

### 模块 C：平台套餐配置增强

适合负责文件：

- `ui/src/ui/ports/platform/pricing/page.ts`
- `ui/src/ui/capability/platform-plan-bundle/endpoints.ts`
- `src/gateway/server-methods/platform-plan-bundle.ts`

### 模块 D：运营分析联动

适合负责文件：

- `ui/src/ui/ports/platform/pricing/economics-section.ts`
- `src/gateway/consumption-forecast/*`

---

## 10. 第一批建议提交范围

如果要最小风险启动，建议首批 PR 只含：

1. Phase 0 contract 冻结文档 / 配置真相
2. `plan-capacity-display.ts`
3. `catalog` Landing
4. 总览 Hero 双入口

**不要**首批就同时上：

- 完整向导
- 平台 metadata
- economics 联动

原因：这三项都依赖 Phase 0 结果稳定后再推进更安全。

---

## 11. 建议的阶段验收口径

### Phase 0 通过条件

- 五档 contract 数值唯一
- 企业端 / 平台端 / 方案文档一致

### Phase 1 通过条件

- 未订阅用户可从总览或 catalog 开始选购
- 推荐结果可解释
- 不新增新顶层入口

### Phase 2 通过条件

- 已订阅用户能看懂当前套餐与扩展边界

### Phase 3 通过条件

- 平台运营可以配置推荐画像

### Phase 4 通过条件

- 推荐与经营分析形成闭环
