# 模型管理 × AOR 两档式集成改造清单（2026-06-05）

## 文档目的

本文用于指导平台端「模型管理」模块与 AOR（Agent Orchestration Runtime）的**两档式集成改造**实施。

本文不是概念讨论稿，而是执行清单。团队应按本文逐项落地、联调、验收。

## 目标结论

模型管理与 AOR 采用**两档式集成**：

1. `native`
   - 平台模型管理模块完全按现有平台原生数据源运行
   - 不依赖 AOR
   - 满足当前平台端的模型资产、任务方案、智能路由、使用分析、治理告警等基础需求

2. `aor_enhanced`
   - 平台模型管理继续作为**控制面真源**
   - AOR 作为**执行与反馈增强层**
   - 增加真实执行解释、Evaluator 完成度、Bandit 学习状态、优化分成、live coding 证据等增强能力

## 非目标

- 不把模型管理重构为 AOR 专属控制台
- 不让 AOR 成为平台模型管理的前置依赖
- 不在本轮引入 3 档或 4 档模式
- 不让前端 UI 直接依赖 `@openbot/aor-*`
- 不让前端 adapter 持续膨胀为唯一事实源

## 架构原则

### 控制面 / 执行面边界

- 平台模型管理：
  - 模型资产纳管真源
  - 任务方案真源
  - 智能路由策略真源
  - 治理动作确认真源

- AOR：
  - 任务执行真源
  - selector 决策真源
  - evaluator 分数真源
  - feedback / bandit 学习真源
  - optimization report / audit / billing ingest 真源

### UI 原则

- UI 不直接判断 AOR 包是否存在
- UI 只消费统一的 `PlatformPortReadModel` / `PlatformModelsVM`
- AOR 仅作为一个可选增强数据源出现在 projection 层

### 后端原则

- 新增 server-side canonical projection
- 尽量减少前端 adapter 中的配置拼装与治理启发式推导
- AOR 增强数据通过 Gateway 公共接口进入平台投影，不直接 deep import AOR 运行时内部

## 当前状态判断

### 当前模型管理已具备的基础能力

- 模型资产页：
  `ui/src/ui/ports/platform/models/sections/ModelAssetsSection.ts`
- 任务方案页：
  `ui/src/ui/ports/platform/models/sections/ModelTaskPlansSection.ts`
- 智能路由页：
  `ui/src/ui/ports/platform/models/sections/SmartRoutingSection.ts`
- 使用分析页：
  `ui/src/ui/ports/platform/models/sections/ModelUsageAnalyticsSection.ts`
- 治理告警页：
  `ui/src/ui/ports/platform/models/sections/ModelGovernanceSection.ts`

### 当前最关键问题

平台模型管理的很多对象仍主要由前端 adapter 推导：

- `buildConfiguredPlans()`
- `buildConfiguredTaskProfiles()`
- `buildConfiguredRoutingPolicies()`
- `buildGovernanceIssues()`
- `buildModelGovernanceVM()`

相关文件：

- `ui/src/ui/ports/platform/models/adapter.ts`

这意味着：

- `native` 模式可运行
- 但长期不适合作为 AOR 集成真源
- 本轮必须补 server-side canonical snapshot / projection

## 总体改造顺序

1. 新增模式开关
2. 新增 server-side 模型管理 canonical snapshot
3. 新增 AOR enhanced projection
4. 扩展平台读模型 `PlatformPortReadModel`
5. 调整前端 adapter 消费方式
6. 在 5 个 tab 中分批接入 AOR 增强视图
7. 建立平台控制策略到 AOR 执行语义的映射
8. 建立验证、回滚和灰度方案

---

## 一、配置开关改造

### 1.1 新增模式字段

目标：

- 明确平台模型管理运行模式
- 对外只暴露 `native` / `aor_enhanced`

建议配置：

```yaml
gateway:
  platform:
    models:
      mode: native | aor_enhanced
      aor:
        gatewayUrl: http://127.0.0.1:18789
        toolsBaseUrl: http://127.0.0.1:18789
        enableBandit: true
        enableRoutingExplanations: true
        enableOptimizationMetrics: true
```

### 1.2 改造项

- [ ] 在配置 schema 中新增 `gateway.platform.models.mode`
- [ ] 允许值仅为 `native` / `aor_enhanced`
- [ ] 为 `aor` 增强配置增加可选块
- [ ] 为未配置场景提供默认值 `native`
- [ ] 在 control-ui / bootstrap 路径中透出当前模式

### 1.3 相关文件

- `src/config/*`
- `src/gateway/control-ui-contract.ts`
- `ui/src/ui/controllers/control-ui-bootstrap.ts`

### 1.4 验收

- [ ] 未配置模式时，平台模型管理正常工作
- [ ] 切换到 `aor_enhanced` 时，平台可读取增强 projection
- [ ] 非法值会被 schema/validation 拒绝

---

## 二、Server-side Canonical Snapshot

### 2.1 目标

将当前主要在前端 adapter 中拼装的模型管理数据下沉到 Gateway 后端，形成稳定真源。

### 2.2 新增模块

建议新增：

- [ ] `src/gateway/models/platform-models-snapshot.ts`
- [ ] `src/gateway/models/platform-models-aor-projection.ts`
- [ ] `src/gateway/server-methods/models-management.ts`

### 2.3 Snapshot 应包含的数据

- [ ] 模型资产目录
- [ ] provider 健康状态
- [ ] gateway catalog 模型
- [ ] allowlist / recommendation pool
- [ ] task plan 目录
- [ ] routing policy 目录
- [ ] usage by model / task / plan / policy
- [ ] governance issue / insight / risk
- [ ] AOR enhanced 数据块（仅增强模式）

### 2.4 新 RPC 建议

- [ ] `models.management.snapshot`
- [ ] `models.management.routing-explanations`
- [ ] `models.management.aor-status`

### 2.5 验收

- [ ] 前端可在不读取本地 config 细节的情况下构建 `PlatformModelsVM`
- [ ] snapshot 在 `native` 模式下完整返回基础数据
- [ ] snapshot 在 `aor_enhanced` 模式下额外返回 AOR 增强数据

---

## 三、Platform Read Model 扩展

### 3.1 目标

在 `PlatformPortReadModel` 中加入统一的 AOR 增强块，而不是让 UI 直接判断 AOR 是否存在。

### 3.2 新增字段

建议新增：

```ts
aor?: {
  enabled: boolean
  syncStatus: "ok" | "degraded" | "unavailable"
  policyBindings: Array<...>
  routingExplanations: Array<...>
  learning: {
    arms: Array<{ arm: string; mean: number; trials: number }>
    updatedAt?: number
  }
  optimization: {
    savingsProxyQty: number
    revenueShareProxyQty: number
    savingsUsd?: number
    revenueShareUsd?: number
    updatedAt?: number
  }
  liveCodingEvidence?: Array<...>
}
```

### 3.3 具体改造项

- [ ] 为 `PlatformPortReadModel` 增加 `aor` 可选块
- [ ] 增加 `policyBindings`
- [ ] 增加 `routingExplanations`
- [ ] 增加 `learning.arms`
- [ ] 增加 `optimization`
- [ ] 增加 `liveCodingEvidence`

### 3.4 相关文件

- `ui/src/ui/ports/platform/semantic/platform-read-model.ts`
- `ui/src/ui/ports/platform/enterprise/*` 如有共享读模型路径需同步

### 3.5 验收

- [ ] `native` 模式下 `aor` 字段缺失或 `enabled=false`
- [ ] `aor_enhanced` 模式下 `aor` 字段结构完整
- [ ] 前端无 direct import `@openbot/aor-*`

---

## 四、TaskProfile / ModelPlan / RoutingPolicy 到 AOR 的映射

### 4.1 核心判断

当前平台模型管理中的：

- `TaskProfile`
- `ModelPlan`
- `RoutingPolicy`

不能直接等同于 AOR 的：

- `TaskType`
- `Skill`
- `Selector`

需要显式映射层。

### 4.2 建议新增字段

在 `TaskProfile` 或 `ModelPlan` 增加：

- [ ] `aorTaskTypeId`
- [ ] `aorSkillId`（可选）
- [ ] `selectorStrategy`
- [ ] `objectiveEvaluatorMode`

推荐优先放在 `ModelPlan`：

```ts
{
  planId: string
  ...
  aorExecution?: {
    taskTypeId: string
    skillId?: string
    selectorStrategy: "best_quality" | "balanced" | "bandit"
    evaluatorMode: "content" | "workspace"
  }
}
```

### 4.3 改造项

- [ ] 平台方案对象增加 `aorExecution`
- [ ] 允许平台路由模式表达 `bandit`
- [ ] 建立 `ModelPlan -> AOR policy binding` projection
- [ ] 对不存在映射的方案给出明确治理告警

### 4.4 验收

- [ ] 平台至少能为 2 个 TaskProfile 输出 AOR 绑定
- [ ] `bandit` 策略可从模型管理控制面表达
- [ ] 绑定缺失时治理页能提示“未映射到 AOR 执行语义”

---

## 五、AOR Enhanced Projection

### 5.1 目标

把 AOR 的运行时事实回填给模型管理，而不是只进入 cost-budget。

### 5.2 应接入的数据

- [ ] routing explanations
- [ ] selected model
- [ ] rejected candidates
- [ ] fallback chain
- [ ] evaluator score
- [ ] bandit arm mean / trials
- [ ] optimization savings / revenue share
- [ ] live coding archive record

### 5.3 数据来源

现有可复用：

- `packages/aor-core/src/audit.ts`
- `packages/aor-core/src/billing-bridge.ts`
- `packages/aor-core/src/optimization-report.ts`
- `packages/aor-core/src/bandit.ts`
- `packages/aor-core/src/bandit-persistence.ts`
- `packages/aor-sdk-node/src/live-coding.ts`

### 5.4 后端改造项

- [ ] 从 AOR audit / billing / bandit state / live archive 聚合 projection
- [ ] 将 projection 注入 `models.management.snapshot`
- [ ] 增加健康状态 `syncStatus`
- [ ] 为 AOR 不可用场景提供降级语义

### 5.5 验收

- [ ] `aor_enhanced` 模式下模型管理可看到最近 routing explanations
- [ ] `aor_enhanced` 模式下模型管理可看到 bandit arms
- [ ] `aor_enhanced` 模式下模型管理可看到 optimization summary
- [ ] AOR 数据缺失时仅显示“暂不可用”，不影响基础模块

---

## 六、前端适配层改造

### 6.1 目标

让 `adapter.ts` 优先消费 server-side canonical snapshot，而不是自己在前端拼大量“配置生成对象”。

### 6.2 具体改造

- [ ] 保留当前 adapter 作为过渡层
- [ ] 逐步减少 `buildConfiguredPlans()`
- [ ] 逐步减少 `buildConfiguredTaskProfiles()`
- [ ] 逐步减少 `buildConfiguredRoutingPolicies()`
- [ ] `routingExplanations` 不再默认空数组
- [ ] `governanceIssues` 优先使用后端 projection
- [ ] 前端启发式逻辑保留为 fallback，而不再作为主真源

### 6.3 必须优先收敛的点

- [ ] `RoutingDecisionExplanation[]` 真数据接入
- [ ] `usageByPolicy` 后端真实聚合接入
- [ ] `governanceIssues` 来源统一

### 6.4 相关文件

- `ui/src/ui/ports/platform/models/adapter.ts`

---

## 七、UI 分区改造清单

### 7.1 Model Assets

目标：

- 在增强模式下展示 AOR 运行覆盖和建议信息

改造项：

- [ ] 新增 “AOR 状态” 小卡片
- [ ] 新增 “AOR 覆盖任务数 / 最近运行模型数”
- [ ] 新增 “live coding 证据入口”
- [ ] 在详情抽屉中增加 “AOR 最近命中/回退/得分”

文件：

- `ui/src/ui/ports/platform/models/sections/ModelAssetsSection.ts`

### 7.2 Task Plans

目标：

- 展示平台方案到 AOR 执行语义的映射

改造项：

- [ ] 详情面板展示 `aorTaskTypeId`
- [ ] 展示 `skillId`
- [ ] 展示 `selectorStrategy`
- [ ] 展示 `evaluatorMode`
- [ ] 缺失映射时显示治理警告

文件：

- `ui/src/ui/ports/platform/models/sections/ModelTaskPlansSection.ts`

### 7.3 Smart Routing

目标：

- 用真实 AOR 决策解释替代空 explanation

改造项：

- [ ] explanation panel 读取 AOR explanation
- [ ] 展示 rejected models
- [ ] 展示真实 fallback chain
- [ ] 展示 selected model / evaluator score
- [ ] 新增 `bandit` 排序模式文案

文件：

- `ui/src/ui/ports/platform/models/sections/SmartRoutingSection.ts`
- `ui/src/ui/ports/platform/models/view-model.ts`

### 7.4 Usage Analytics

目标：

- 将 AOR 增强指标纳入使用分析

改造项：

- [ ] 新增 AOR KPI 区块
- [ ] 展示 `decision coverage`
- [ ] 展示 `bandit trials`
- [ ] 展示 `fallback recovered`
- [ ] 展示 `optimization savings`
- [ ] 展示 `revenue share`

文件：

- `ui/src/ui/ports/platform/models/sections/ModelUsageAnalyticsSection.ts`

### 7.5 Governance

目标：

- 治理从纯前端启发式升级为“平台规则 + AOR 运行证据”

改造项：

- [ ] 治理问题增加 AOR 运行证据
- [ ] 新增 “AOR 学习偏斜 / selector 配置偏差 / evaluator 缺失” 等问题类型
- [ ] Insight 支持跳转到真实 routing explanation
- [ ] 风险项支持跳转到 live coding evidence

文件：

- `ui/src/ui/ports/platform/models/sections/ModelGovernanceSection.ts`
- `ui/src/ui/ports/platform/models/adapter.ts`

---

## 八、AOR 侧改造清单

### 8.1 AOR 输出给平台的投影能力

- [ ] 增加面向平台模型管理的 projection 导出结构
- [ ] 输出 routing explanations
- [ ] 输出 bandit arm snapshots
- [ ] 输出 optimization summary
- [ ] 输出 live coding archive summary

### 8.2 AOR 接收平台控制策略

- [ ] 接收 `ModelPlan.aorExecution`
- [ ] 接收 `RoutingPolicy.selectorStrategy`
- [ ] 接收约束：成本 / 延迟 / 能力 / 健康
- [ ] 支持 `bandit` 被平台显式配置

### 8.3 AOR 模式边界

- [ ] `native` 模式下，AOR 不要求存在
- [ ] `aor_enhanced` 模式下，AOR 仅增强，不接管平台配置真源

---

## 九、后端接口与契约清单

### 9.1 新接口

- [ ] `models.management.snapshot`
- [ ] `models.management.routing-explanations`
- [ ] `models.management.aor-status`

### 9.2 新响应字段

- [ ] `aor.enabled`
- [ ] `aor.syncStatus`
- [ ] `aor.policyBindings`
- [ ] `aor.routingExplanations`
- [ ] `aor.learning.arms`
- [ ] `aor.optimization`
- [ ] `aor.liveCodingEvidence`

### 9.3 契约要求

- [ ] 所有字段都可选降级
- [ ] `native` 模式不返回增强块或返回 `enabled=false`
- [ ] `aor_enhanced` 模式若 AOR 不可用，返回 `syncStatus=degraded/unavailable`

---

## 十、实施顺序（建议 Sprint 切分）

### Sprint 1：模式与 snapshot

- [ ] 配置开关 schema
- [ ] `models.management.snapshot`
- [ ] `PlatformPortReadModel.aor`
- [ ] 前端 adapter 优先读 snapshot

### Sprint 2：最小增强读模式

- [ ] routing explanations
- [ ] optimization summary
- [ ] bandit arms
- [ ] usage analytics AOR KPI

### Sprint 3：控制策略映射

- [ ] `ModelPlan.aorExecution`
- [ ] `bandit` 路由模式
- [ ] policy binding projection
- [ ] task plan / routing UI 对齐

### Sprint 4：治理增强

- [ ] AOR 运行证据进入 governance
- [ ] live coding evidence 展示
- [ ] selector / evaluator / fallback 相关治理项

---

## 十一、验收清单

### 11.1 Native 模式

- [ ] 模型管理所有 tab 正常打开
- [ ] 没有 AOR 数据时不报错
- [ ] 不展示 AOR 专属卡片或展示为隐藏状态
- [ ] 资产、方案、路由、分析、治理均能用平台原生数据跑通

### 11.2 AOR Enhanced 模式

- [ ] 读模型中能看到 `aor` 增强块
- [ ] 智能路由可展示真实 explanation
- [ ] 使用分析可展示 `bandit` / `optimization` 指标
- [ ] 治理页可展示 AOR 增强问题/建议
- [ ] AOR 不可用时仅显示降级提示，不影响基础渲染

### 11.3 AOR 策略映射

- [ ] 至少 2 个 TaskPlan 能映射到 AOR
- [ ] `bandit` 可从平台表达
- [ ] fallback / cost / latency / capability / health 约束能进 AOR selector

### 11.4 边界

- [ ] UI 不直接 import `@openbot/aor-*`
- [ ] 模型管理 projection 不 deep import OpenBot/AOR 内部私有实现
- [ ] AOR 关闭时平台功能完整
- [ ] AOR 打开时增强能力生效

---

## 十二、回滚策略

### 12.1 快速回滚

- [ ] 将 `gateway.platform.models.mode` 切回 `native`
- [ ] 前端只使用基础 snapshot 字段
- [ ] 忽略 `aor` 增强块

### 12.2 渐进灰度

- [ ] 先在单租户/测试租户启用 `aor_enhanced`
- [ ] 观察 explanation / bandit / optimization 数据稳定性
- [ ] 再扩展到全平台

---

## 十三、需要重点避免的反模式

- [ ] 不要把 AOR 变成模型管理的前置依赖
- [ ] 不要让前端 adapter 成为长期唯一真源
- [ ] 不要在 UI 里直接调用 AOR 包逻辑
- [ ] 不要让平台和 AOR 各自维护一套独立任务语义
- [ ] 不要把 `native` 模式做成“阉割版”

---

## 十四、实施完成标志

当满足以下条件时，视为本轮“两档式集成”落地完成：

- [ ] `native` 模式完整可用
- [ ] `aor_enhanced` 模式完整可用
- [ ] 平台模型管理有后端 canonical snapshot
- [ ] AOR 增强数据通过 projection 注入模型管理
- [ ] 至少 `routing explanations`、`bandit arms`、`optimization summary` 三类增强数据可见
- [ ] 至少一个 `TaskPlan` 已具备稳定 AOR 执行映射
- [ ] 所有验收命令通过
