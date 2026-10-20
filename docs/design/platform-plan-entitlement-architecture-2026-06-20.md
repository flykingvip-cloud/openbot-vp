# 平台套餐权益架构与预警闭环设计

> 日期：2026-06-20  
> 状态：Draft — 供执行团队冻结后实施  
> 关联：`docs/design/platform-pricing-tiers-2026-06-16.md`、`.kiro/specs/package-entitlement-v2/`、`.kiro/specs/subscription-commerce/`、`ui/src/ui/ports/platform/pricing/`

---

## 0. 执行摘要

当前平台套餐体系已具备以下基础：

- `Plan / PlanVersion` 承载价格与版本锁定
- `EntitlementSnapshot` 承载部分组织级权益
- 企业端已具备席位、Bot、并发、Credits、预测与容量建议
- 平台端已具备套餐编辑、经营分析、毛利阈值与套餐对比视图

但当前仍存在一个结构性问题：

> **套餐卡片展示的权益，只有一部分与后端真实权益对齐；其余仍停留在静态营销文案层。**

典型现象：

- 卡片中的 `席位` / `Bot` / `并发` / `Credits` 可被系统计算与预警
- 卡片中的 `审计日志` / `SLA` / `邮件支持` / `专属连接器` / `CSM` / `高级治理` 多数未形成统一后端 contract
- 企业购买视角与员工实际使用视角尚未明确分层

本设计的目标是：

```text
把套餐从“展示文案集合”
升级为
“可配置、可执行、可预警、可经营分析的后端 contract”
```

本设计输出三件核心产物：

1. **套餐权益后端建模清单**
2. **平台管理端改造建议**
3. **企业/员工/平台三层用户预警闭环**

---

## 1. 背景与问题定义

### 1.1 当前套餐权益的真实结构

当前套餐卡片展示的权益，实际上混合了 4 类不同性质的信息：

| 类型              | 示例                                 | 当前状态               |
| ----------------- | ------------------------------------ | ---------------------- |
| **硬边界权益**    | 席位数、Bot 数、并发上限、Credits    | 已部分建模，可 enforce |
| **能力权益**      | 可用模型档位、多工作流、BYOM、连接器 | 已部分建模，未完全统一 |
| **治理/部署权益** | 审计日志、MFA、审批流、隔离、VPC     | 仅少数字段有后端真相   |
| **服务条款**      | 邮件支持、SLA、CSM、联系销售         | 主要仍是展示文案       |

这会导致 3 个问题：

1. 前端可以卖，后端不一定能管
2. 平台可以定价，经营分析不一定能解释
3. 用户碰到权益边界时，系统不一定能及时预警

### 1.2 当前代码真相

#### 已经进入后端真相的权益

当前 `EntitlementSnapshot` 已具备：

- `monthlyCredits`
- `maxSeats`
- `maxBots`
- `maxConcurrentRuns`
- `allowedPolicies`
- `allowedTiers`
- `allowCustomPolicy`
- `allowPrivateModels`
- `overagePolicy`

代码锚点：

- `src/gateway/package-entitlement/types.ts`
- `src/gateway/server-methods/platform-plan-bundle.ts`

#### 当前仍主要依赖静态展示的权益

套餐卡片权益展示主要来自按档位硬编码的静态 benefits：

- `ui/src/ui/ports/platform/pricing/pricing-comparison-view.ts`
- `ui/src/i18n/locales/zh-CN.ts`

这意味着诸如以下权益仍未全面进入后端 contract：

- `邮件支持（工作日）`
- `优先支持 99.5% SLA`
- `专属 CSM + 99.95% SLA`
- `高级治理（MFA / 审批流）`
- `专属连接器`
- `逻辑数据隔离`
- `私有化 / VPC 部署`

### 1.3 企业购买视角与员工使用视角的错位

企业管理员买套餐时，关注的是：

- 成本是否可预测
- 组织能承载多少成员、Bot、并发、工作流
- 是否满足治理、隔离、支持与部署要求
- 是否可以提前获知触顶风险

员工实际使用时，感知的是：

- 我能否用某模型
- 我能否执行某工作流
- 是否排队、是否被限流
- 我的角色是否足够
- 被拒绝时下一步应该做什么

这说明：

> **企业购买权益** 与 **员工体验权益** 必须分层建模，而不是共用一套平铺文案。

当前系统已经隐含了这条链路：

- 企业天花板权益：`enterprise-allocation.overview`
- 员工角色体验：`role-grant-profiles`

代码锚点：

- `src/gateway/server-methods/enterprise-allocation.ts`
- `src/gateway/model-entitlement/role-grant-profiles.ts`

---

## 2. 设计目标

### 2.1 核心目标

1. 套餐权益必须成为后端可解释 contract
2. 平台端必须可编辑、可版本化、可比对、可预览影响
3. 企业管理员必须收到容量、预算、能力三类预警
4. 员工必须收到角色化、可执行的使用提示
5. 平台运营必须能把权益、成本、价格、毛利放在同一条分析链路里

### 2.2 非目标

本设计不直接覆盖：

- 外部支付/开票平台对接
- 复杂法务合同条款引擎
- 第三方 CRM / ERP 双向同步
- 全面重做企业端 IA
- 替换现有 `Plan / PlanVersion` 定价快照机制

---

## 3. 设计原则

| #   | 原则                        | 说明                                          |
| --- | --------------------------- | --------------------------------------------- |
| P1  | **价格与权益解耦**          | `PlanVersion.snapshot` 只管定价；权益另行建模 |
| P2  | **组织权益与员工体验分层**  | 企业买的是边界，员工用的是投影                |
| P3  | **能卖的权益必须能管理**    | 任何对外卖点都应有后端字段或规则承载          |
| P4  | **能限制的权益必须能预警**  | 容量型与能力型权益都应接入告警                |
| P5  | **Enterprise 允许合同覆写** | 不用静态文案代替真实配置                      |
| P6  | **平台编辑必须版本化**      | draft → diff → activate，不改生效真相         |
| P7  | **展示从 contract 渲染**    | 不再按档位硬编码权益文案                      |
| P8  | **经营分析闭环优先**        | 权益调整必须能解释成本与毛利变化              |

---

## 4. 目标权益架构

### 4.1 总体分层

```text
Plan / PlanVersion.snapshot
  └─ 价格、周期、计费规则

Plan Entitlement Contract
  ├─ EntitlementSnapshot          （组织级可 enforce 权益）
  ├─ PlanServiceProfile           （服务与商务条款）
  ├─ PlanGovernanceProfile        （治理与部署能力）
  ├─ PlanOutcomeProfile           （业务结果展示口径）
  └─ EnterpriseContractOverride   （企业合同覆写）

Employee Experience Projection
  └─ 企业权益 + 角色预设 → 员工可感知体验
```

### 4.2 各层职责

| 层                             | 真相类型      | 主要受众        | 是否运行时 enforce    |
| ------------------------------ | ------------- | --------------- | --------------------- |
| `PlanVersion.snapshot`         | 价格快照      | 平台/财务       | 是（计费）            |
| `EntitlementSnapshot`          | 组织硬边界    | 企业管理员/平台 | 是                    |
| `PlanServiceProfile`           | 服务条款      | 企业管理员/销售 | 否（主要为运营/支持） |
| `PlanGovernanceProfile`        | 治理/部署能力 | 企业管理员/平台 | 部分                  |
| `PlanOutcomeProfile`           | 业务结果展示  | 企业管理员/市场 | 否（展示口径）        |
| `EnterpriseContractOverride`   | 合同覆写      | 销售/大客户运营 | 是/部分               |
| `EmployeeExperienceProjection` | 角色化体验    | 员工            | 是（通过投影）        |

---

## 5. 套餐权益后端建模清单

### 5.1 保持不变的既有模型

以下模型继续保留既有语义：

- `Plan`
- `PlanVersion`
- `PlanPricing`
- `Subscription`
- `Commercial_Order`
- `Invoice_Request`

其中：

- `PlanVersion.snapshot` 仍只承载价格与计费快照
- 不把服务条款、营销卖点、治理能力重新塞回 `PlanVersion.snapshot`

### 5.2 组织级权益真相：`EntitlementSnapshot`

#### 目标职责

- 承载组织级可 enforce 权益
- 承载容量边界
- 承载模型/路由/超额策略
- 作为 forecast、预算控制、运行时限制、升级建议的输入

#### 字段建议

```ts
type EntitlementSnapshot = {
  planVersionId: string;

  // 容量边界
  maxSeats: Partial<Record<"viewer" | "creator" | "admin", number>>;
  maxBots: number;
  maxConcurrentRuns: number;
  maxWorkflows?: number;
  maxKnowledgeBases?: number;
  maxStorageGb?: number;
  maxConnectorBindings?: number;

  // 用量边界
  monthlyCredits: number;
  overagePolicy: {
    type: "block" | "credits_only" | "pay_as_you_go";
    allowBurstConcurrency: boolean;
  };

  // AI 权限边界
  allowedTiers: string[];
  allowedPolicies: string[];
  policyId?: string;
  modelQuota?: Record<string, number>;
  allowCustomPolicy?: boolean;
  allowPrivateModels?: boolean;

  updatedAt: string;
};
```

#### 设计说明

- `monthlyCredits=0` 表示不走 Credits 路径，可进入 enterprise budget 模式
- `maxConcurrentRuns=0` 表示不限
- `allowedTiers` 是能力上限，不直接等同员工最终可用模型
- `modelQuota` 允许细化到模型维度

### 5.3 服务条款：`PlanServiceProfile`

#### 目标职责

- 承载支持与 SLA 等商业条款
- 支撑卡片展示、订单说明、续费策略、合同差异化
- 作为运营与客户成功体系的配置真相

#### 字段建议

```ts
type PlanServiceProfile = {
  planVersionId: string;
  supportTier: "community" | "email" | "priority" | "dedicated_csm";
  slaTarget: "none" | "99.5" | "99.95" | "custom";
  salesMotion: "self_serve" | "contact_sales" | "contract_only";
  invoiceMode: "self_service_request" | "platform_assisted" | "contract_only";
  renewalMotion: "self_serve" | "sales_assisted" | "contract_renewal";
  updatedAt: string;
};
```

#### 设计说明

- `salesMotion` 替代“联系销售”文案猜测
- `slaTarget` 与前端展示的 SLA 卡片文案对齐
- `supportTier` 为后续平台支持中心和通知策略预留钩子

### 5.4 治理与部署能力：`PlanGovernanceProfile`

#### 目标职责

- 承载治理、隔离、部署、连接器、BYOM 等高级能力
- 区分 Business 与 Enterprise 的核心差异
- 支撑平台管理与大客户合同覆写

#### 字段建议

```ts
type PlanGovernanceProfile = {
  planVersionId: string;
  auditLog: boolean;
  approvalFlow: "none" | "basic" | "advanced";
  mfaRequired: boolean;
  dataIsolation: "shared" | "logical" | "vpc" | "private";
  privateDeployment: boolean;
  byom: boolean;
  customPolicy: boolean;
  dedicatedConnectors: string[];
  updatedAt: string;
};
```

#### 设计说明

- `dedicatedConnectors` 不用模糊文案表示，应可列出 connector capability IDs
- `dataIsolation` 与 `privateDeployment` 分开，避免“逻辑隔离”和“私有化/VPC”混成同一概念

### 5.5 对外展示口径：`PlanOutcomeProfile`

#### 目标职责

- 承载“业务结果”估算
- 为对外卡片和增长页提供统一展示数据
- 让展示从静态文案改为后端可配置结构

#### 字段建议

```ts
type PlanOutcomeProfile = {
  planVersionId: string;
  taskEstimateMonthly?: number;
  kbQaEstimateMonthly?: number;
  workflowRunsEstimateMonthly?: number;
  estimationBasisVersion: string;
  displayHighlights: string[];
  recommendedUseCases: string[];
  updatedAt: string;
};
```

#### 设计说明

- `displayHighlights` 用于卡片展示，替代前端 `benefitPro1` 等静态 key
- 估算值必须带 `estimationBasisVersion`，便于后续统一调整换算口径

### 5.6 企业合同覆写：`EnterpriseContractOverride`

#### 目标职责

- 承载 Enterprise / 大客户差异化合同
- 支撑“不改标准套餐、但按企业覆写权益”的场景

#### 字段建议

```ts
type EnterpriseContractOverride = {
  enterpriseId: string;
  subscriptionId?: string;
  planVersionId: string;
  overrides: Partial<{
    // 容量与能力
    monthlyCredits: number;
    maxSeats: Partial<Record<"viewer" | "creator" | "admin", number>>;
    maxBots: number;
    maxConcurrentRuns: number;
    allowedTiers: string[];
    allowedPolicies: string[];
    policyId: string;
    overagePolicy: {
      type: "block" | "credits_only" | "pay_as_you_go";
      allowBurstConcurrency: boolean;
    };

    // 服务条款
    supportTier: "community" | "email" | "priority" | "dedicated_csm";
    slaTarget: "none" | "99.5" | "99.95" | "custom";

    // 治理与部署
    dataIsolation: "shared" | "logical" | "vpc" | "private";
    privateDeployment: boolean;
    byom: boolean;
    dedicatedConnectors: string[];
    customPolicy: boolean;
  }>;
  effectiveAt: string;
  expiresAt?: string;
  updatedAt: string;
};
```

#### 设计说明

- Enterprise 页的“联系销售”最终必须能落到真实 override，而不是只展示文案
- 订阅激活后解析企业权益时，需应用 override

### 5.7 员工体验投影：`EmployeeExperienceProjection`

#### 目标职责

- 表达员工真正感知到的执行体验
- 不作为套餐售卖真相直接维护
- 由企业权益 + 席位角色 + grant profile 投影得出

#### 字段建议

```ts
type EmployeeExperienceProjection = {
  enterpriseId: string;
  seatRole: "viewer" | "creator" | "admin";
  allowedModelIds: string[];
  workflowCapability: "none" | "single" | "multi";
  queuePriority: "standard" | "priority";
  governanceGuardLevel: "basic" | "advanced";
  connectorAccessLevel: "none" | "shared" | "dedicated";
};
```

#### 设计说明

- 员工不应直接看到企业购买了什么，而应看到自己实际能做什么
- 保留现有 `role-grant-profiles` 链路作为主投影路径

---

## 6. 平台管理端改造建议

### 6.1 套餐编辑页信息架构

建议将套餐管理页拆为 6 个编辑区块：

1. **价格与周期**
2. **容量权益**
3. **AI 能力**
4. **治理与部署**
5. **服务条款**
6. **经营分析**

### 6.2 平台写入口

继续以 `platform-plan-bundle.*` 作为统一写入口，扩展承载：

- `EntitlementSnapshot`
- `PlanServiceProfile`
- `PlanGovernanceProfile`
- `PlanOutcomeProfile`

禁止前端组合多个散 RPC 自行提交。

### 6.3 编辑流程要求

所有套餐编辑必须走：

```text
draft → diff → activate
```

具体要求：

- 不直接改生效版
- 展示价格 diff
- 展示权益 diff
- 展示治理/服务 diff
- 激活前执行一致性检查

### 6.4 平台套餐卡片展示改造

当前套餐卡片不应继续读按档位硬编码的 `SLOT_BENEFITS`。

新展示数据来源：

- `EntitlementSnapshot`
- `PlanServiceProfile`
- `PlanGovernanceProfile`
- `PlanOutcomeProfile`

展示规则：

- 容量组：席位、Bot、并发、Credits/业务额度
- 能力组：模型、工作流、连接器、BYOM、Custom Policy
- 服务组：支持、SLA、CSM、销售模式

### 6.5 平台“变更影响预览”

在套餐编辑保存前，平台端应提供：

- 影响企业数量
- 影响企业列表摘要
- 影响席位角色体验
- 可能触发的预警类型
- 预测毛利变化

### 6.6 平台经营分析联动

套餐管理与定价必须和经营分析联动：

- 显示套餐实际收入
- 显示供应商成本
- 显示 margin
- 显示 `targetMarginRate / guardMarginRate`
- 显示 forecast 风险命中率

目标是让运营在调整权益时，同步理解：

```text
这会让用户更好用
还是会让某个套餐亏钱
```

### 6.7 平台一致性检查

建议新增套餐一致性 doctor：

- 卡片展示权益是否都存在后端字段来源
- `displayHighlights` 是否能被真实权益解释
- `allowedTiers` / `allowedPolicies` / `policyId` 是否一致
- `Business` / `Enterprise` 是否满足设定的最低治理能力

---

## 7. 用户预警闭环设计

### 7.1 预警分层

本设计将预警分为三层：

1. 企业管理员预警
2. 员工使用者预警
3. 平台运营预警

### 7.2 企业管理员预警

#### 目标

- 让企业管理员提前知道触顶与超支风险
- 让管理员知道何时升级、加量或调整策略

#### 预警类型

| 类型         | 触发条件                                     | 严重度        |
| ------------ | -------------------------------------------- | ------------- |
| 席位触顶     | `seatUsed / seatQuota >= 0.8`                | medium / high |
| Bot 触顶     | `activeBots / maxBots >= 0.8`                | medium / high |
| 并发触顶     | `concurrencyPeak / maxConcurrentRuns >= 0.8` | medium / high |
| Credits 见底 | `creditsEtaDays <= 7`                        | medium / high |
| 预算超阈     | `forecastCost / budget >= 0.9`               | medium / high |
| 能力不匹配   | 高频请求的能力不在当前套餐内                 | medium        |
| 商务待办     | 待支付、待开票、待续费                       | info / medium |

#### 动作建议

- 升级套餐
- 购买加量包
- 调整预算与控制策略
- 调整并发或路由策略
- 联系销售 / 顾问

### 7.3 员工使用者预警

#### 目标

- 不暴露复杂财务口径
- 只提示“我为什么不能继续做”和“下一步怎么办”

#### 预警类型

| 类型           | 场景                        | 用户提示                 |
| -------------- | --------------------------- | ------------------------ |
| 模型无权       | 当前角色无该模型权限        | 申请更高席位或联系管理员 |
| 工作流能力不足 | 当前套餐/角色不支持多工作流 | 切换基础工作流或申请升级 |
| 并发拥塞       | 当前组织并发紧张            | 稍后重试 / 使用轻量模型  |
| 组织额度紧张   | Credits/预算临界            | 任务可能排队或延迟       |
| 连接器不可用   | 当前套餐无专属连接器权限    | 联系管理员或申请升级     |

#### 动作建议

- 申请权限
- 切换可用模型
- 稍后重试
- 联系管理员

### 7.4 平台运营预警

#### 目标

- 保证套餐毛利
- 发现低价档高成本侵蚀
- 发现套餐设计与实际用户行为不匹配

#### 预警类型

| 类型         | 场景                                 |
| ------------ | ------------------------------------ |
| 毛利预警     | `actualMarginRate < guardMarginRate` |
| 结构失衡     | 低价档使用高成本模型过多             |
| 风险集中     | 某档位大量企业触发容量/预算风险      |
| 服务成本偏离 | 高支持、高连接器成本未体现在定价     |
| 展示偏差     | 卡片展示权益与真实配置不一致         |

#### 动作建议

- 调价
- 调整权益
- 调整推荐档位
- 下调某档位可用 tier
- 引导企业升级

---

## 8. 预警状态机与落点

### 8.1 Alert 状态机

```ts
type EntitlementAlertStatus = "open" | "acknowledged" | "snoozed" | "resolved";
```

### 8.2 统一告警对象

```ts
type EntitlementAlert = {
  id: string;
  scope: "enterprise_admin" | "employee" | "platform_operator";
  enterpriseId?: string;
  userId?: string;
  planId?: string;
  planVersionId?: string;
  trigger:
    | "seat_quota"
    | "bot_quota"
    | "concurrency"
    | "credits"
    | "budget"
    | "capability_gap"
    | "margin"
    | "commercial_todo";
  severity: "info" | "low" | "medium" | "high";
  title: string;
  message: string;
  actions: Array<{ id: string; label: string; href?: string; command?: string }>;
  status: EntitlementAlertStatus;
  createdAt: string;
  updatedAt: string;
};
```

### 8.3 交付载体

企业管理员侧：

- 企业总览 Banner
- 订阅页 CTA
- 订单/付款待办
- 预算控制面板

员工侧：

- 运行时错误消息
- 工作台提示
- 权限申请入口

平台运营侧：

- pricing/economics dashboard
- plan margin panel
- forecast platform overview

---

## 9. 套餐卡片展示规则

### 9.1 必须满足的约束

任何写在套餐卡片上的权益，必须满足以下约束之一：

1. 后端有对应字段
2. 平台可配置
3. 可进入预警或经营分析链路

若三者都不满足，则不得作为核心权益卖点继续展示。

### 9.2 展示分组

套餐卡片建议按 3 组展示：

#### 容量组

- 席位
- Bot
- 并发
- 业务额度估算 / Credits

#### 能力组

- 模型层级
- 工作流能力
- 审计与治理
- 连接器 / BYOM / Custom Policy

#### 服务组

- 支持方式
- SLA
- CSM / 销售路径

### 9.3 展示规则建议

- 自助档统一显示核心容量边界
- `Trial` 应按体验限制展示，不发 Credits
- `Business` 与 `Enterprise` 的差异应主要体现在治理、部署、支持和合同覆盖
- `Enterprise` 不应用静态“联系销售”文案代替真实合同 override 能力

---

## 10. 与现有代码链路的对齐策略

### 10.1 保持可复用的现有链路

以下链路建议保留并扩展：

- `EntitlementSnapshot`
- `platform-plan-bundle.*`
- `enterprise-allocation.overview`
- `role-grant-profiles`
- `consumption-forecast.*`
- `package-margin`

### 10.2 需要新增的链路

建议新增：

- `PlanServiceProfileStore`
- `PlanGovernanceProfileStore`
- `PlanOutcomeProfileStore`
- `EnterpriseContractOverrideStore`
- `EntitlementAlertStore`

### 10.3 平台编辑链路

建议演进为：

```text
platform-plan-bundle.create/update/create-version
  ├─ PlanVersion.snapshot
  ├─ EntitlementSnapshot
  ├─ ServiceProfile
  ├─ GovernanceProfile
  └─ OutcomeProfile
```

### 10.4 企业运行时解析链路

```text
Subscription.planVersionId
  ├─ PlanVersion.snapshot
  ├─ EntitlementSnapshot
  ├─ ContractOverride
  └─ EmployeeExperienceProjection
```

---

## 11. 实施分期建议

### Phase 1 — Contract 分层

- 新增 `PlanServiceProfile`
- 新增 `PlanGovernanceProfile`
- 新增 `PlanOutcomeProfile`
- 保持 `EntitlementSnapshot` 聚焦组织硬边界

### Phase 2 — 平台管理端联动

- 套餐编辑页接入新 profile
- 套餐卡片改为 contract 驱动
- 增加权益 diff

### Phase 3 — 企业/员工预警

- 企业管理员预警接入总览
- 员工运行时能力提示接入工作台
- 平台运营预警接入 economics

### Phase 4 — Enterprise 合同覆盖

- 支持 per-enterprise override
- 支持合同级别 SLA / 支持 / 部署 / 连接器配置

### Phase 5 — 经营分析实时预览

- 在套餐编辑时实时预览价格/权益变更对毛利与风险的影响

---

## 12. 风险与缓解

| 风险                                 | 影响 | 缓解                              |
| ------------------------------------ | ---- | --------------------------------- |
| 继续使用静态权益文案                 | 高   | 卡片展示改为 contract 驱动        |
| 把服务条款塞进 `EntitlementSnapshot` | 中   | 明确分层建模                      |
| Enterprise 靠人工记忆管理合同        | 高   | 引入 `EnterpriseContractOverride` |
| 员工感知与企业购买权益错位           | 中   | 建立员工体验投影层                |
| 运营只能月底发现亏损                 | 高   | 接入 margin + forecast 实时预警   |

---

## 13. 验收标准

### 13.1 建模验收

- [ ] 套餐卡片核心权益全部有后端字段来源
- [ ] `PlanVersion.snapshot` 仍仅承载价格与计费
- [ ] 组织硬边界权益与服务/治理条款已分层
- [ ] Enterprise 合同覆写模型已定义

### 13.2 平台管理验收

- [ ] 平台端可编辑容量、能力、治理、服务、展示五类权益
- [ ] 编辑流程支持 draft → diff → activate
- [ ] 套餐页可展示权益、成本、毛利、风险的联动信息

### 13.3 用户预警验收

- [ ] 企业管理员能收到席位/Bot/并发/Credits/预算预警
- [ ] 员工被拒绝时能看到明确下一步动作
- [ ] 平台运营能看到毛利与风险预警

### 13.4 展示验收

- [ ] 套餐卡片不再依赖纯档位静态权益表
- [ ] 容量组 / 能力组 / 服务组展示清晰分层
- [ ] Business / Enterprise 差异可由后端 contract 解释

---

## 14. 与现有设计文档关系

本设计是对以下文档的收口与补强：

- `docs/design/platform-pricing-tiers-2026-06-16.md`
  - 保留其“卖业务能力而非卖 Credits”的产品方向
  - 将其静态价值维度进一步落成后端 contract

- `.kiro/specs/package-entitlement-v2/`
  - 保留并扩展 `EntitlementSnapshot`
  - 将其从“容量约束”提升为“组织权益 contract”的一部分

- `.kiro/specs/subscription-commerce/`
  - 不改变订单/支付/发票模型
  - 为商业卖点与服务条款提供更稳的 contract 承载

---

## 15. 变更记录

| 版本 | 日期       | 说明                                                     |
| ---- | ---------- | -------------------------------------------------------- |
| v1.0 | 2026-06-20 | 初稿：套餐权益 contract 分层、平台管理改造、三层预警闭环 |
