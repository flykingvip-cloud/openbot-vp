# 平台套餐与模型绑定一体化改造方案（2026-06-09）

## 文档目的

本文用于指导 OpenBot 平台端“套餐与定价”与“套餐版本对应模型集合”之间的一体化改造实施。

本文聚焦以下问题：

- 当前套餐与模型在数据层如何关联
- 当前平台操作层为什么仍然呈现割裂体验
- 哪些结论是当前代码已成立的事实，哪些只是目标态语义
- 应如何在不破坏既有 billing 版本锁定语义的前提下，补齐统一操作面、数据约束与一致性保障

本文不是概念草稿，而是执行团队可直接据此拆任务、联调、测试和灰度上线的实施方案。

## 执行状态更新（2026-06-12）

经代码核对与测试验证，本文对应方案目前处于“部分已执行，部分待继续”状态。

已确认完成：

- 平台后端已有 `platform-model-binding.overview`
- 平台后端已新增 `platform-plan-bundle.overview`
- 平台后端已新增 `platform-plan-bundle.create`
- 平台后端已新增 `platform-plan-bundle.create-version`
- `PlanVersionModelBindingStore` 已补 `deletePlanVersionModelBinding`
- `platform-model-binding.set` 已补版本存在性与目录合法性校验
- `platform-pricing.create-version` 已补模型绑定继承
- `platform-pricing.activate` 已补 binding ready 校验
- `platform-pricing.delete-version` 已补 binding 清理
- pricing 页已切到 `platform-plan-bundle.overview`
- pricing 页创建套餐已切到 `platform-plan-bundle.create`
- pricing 页创建/保存草稿已切到 `platform-plan-bundle.create-version`
- 版本编辑器已内嵌模型选择、模型额度、AOR 策略编辑
- 激活确认已同时展示 pricing diff 与 model binding diff
- 版本列表已展示 binding health 与 activation blockers
- 底部独立“套餐 · 可用模型”区块已从主页面移除

已通过的针对性测试：

- `src/gateway/model-entitlement/plan-version-model-binding-store.test.ts`
- `src/gateway/server-methods/model-entitlement-management.test.ts`
- `src/gateway/server-methods/billing.test.ts`
- `src/gateway/server-methods/platform-plan-bundle.test.ts`
- `src/gateway/server-methods.domain-guard.test.ts`
- `ui/src/ui/ports/platform/pricing/page.browser.test.ts`

仍待继续的大项：

- `platform-plan-bundle.update` / `save-draft` / `activate` / `get` / `list` 等统一接口尚未补齐
- 平台读模型仍保留部分旧 RPC 依赖（例如激活、删除、diff）
- 首次创建套餐主路径虽然已支持模型/额度/AOR 编辑，但浏览器测试目前只稳定覆盖“表单能力存在”，未完整断言整条创建提交载荷
- `doctor` 已补 plan-version / binding 一致性检查，但修复脚本仍只覆盖 orphan binding 删除
- 灰度/回滚运行手册

## 结论摘要

### 当前判断

1. 套餐与模型在数据层并未真正脱钩。
   `PlanVersion` 与 `PlanVersionModelBinding` 通过 `planVersionId` 关联，企业 entitlement 由订阅锁定的 `planVersionId` 投影得出。

2. 当前“分离感”主要来自操作层与 UI 演进中的历史阶段，而不是基础数据链路缺失。
   当前代码已具备统一后端读写接口，也已把套餐版本、模型集合、额度和 AOR 基本并入同一页面主流程；剩余缺口主要在接口收口完整性、doctor/修复脚本和灰度治理。

3. 当前实现已补齐多项关键缺口，但尚未完全收官。
   主要剩余缺口包括：
   - `platform-plan-bundle.*` 只覆盖了 `overview/create/create-version`
   - `doctor` 尚未扩展到 plan-version / binding 一致性专项检查
   - 修复脚本与灰度/回滚运行手册尚未落地

### 改造总原则

1. 保持数据层解耦。
   不把模型集合、模型额度、AOR 策略直接塞回 `billing/types.ts` 的 `PlanVersion`。

2. 在控制面上实现一体化。
   平台管理员应在“套餐与定价”页面内直接管理该套餐版本的模型集合、可选额度和 AOR 策略，而不是分别调用两个独立入口。

3. 后端统一收口，而不是前端串两个 RPC。
   “一次保存”必须由服务端组合接口承接，确保跨 store 操作的一致性与幂等性。

4. 区分“当前事实”和“目标语义”。
   当前代码中 `PlanVersion -> ModelBinding` 关系实际是 `0..1`，且 binding 仍可覆盖更新；本次改造目标是把它收敛到受控的“版本有且仅有一份生效 binding”的管理语义。

## 一、当前现状核对

### 1.1 数据层现状

#### 计费 core

平台套餐与定价由 billing store 承载：

- `src/gateway/billing/plans-store.ts`
- 落盘文件：`openbot-billing-plans.json`

`PlanVersion` 当前只包含：

- `basePriceCents`
- `seatQuota`
- `botQuota`
- `pricing`

不包含模型策略字段。

代码依据：

- `src/gateway/billing/types.ts:78`
- `src/gateway/billing/plans-store.ts:15`

#### 套餐版本 -> 模型绑定旁路表

模型绑定存放在独立 store：

- `src/gateway/model-entitlement/plan-version-model-binding-store.ts`
- 落盘文件：`openbot-plan-model-binding.json`

数据形态：

- `planVersionId`
- `allowedModelIds`
- `modelQuota?`
- `aorExecution?`

代码依据：

- `src/gateway/model-entitlement/plan-version-model-binding-store.ts:2`
- `src/gateway/model-entitlement/types.ts:46`

#### 企业 entitlement 投影

企业 entitlement 不是手工长期维护的独立真源，而是由“当前 active 订阅锁定的 `planVersionId`”投影得出：

- `subscription.planVersionId`
- `getPlanVersionModelBinding(planVersionId)`
- `binding.allowedModelIds -> EnterpriseModelEntitlement.allowedModelIds`

代码依据：

- `src/gateway/model-entitlement/entitlement-projection.ts:6`
- `src/gateway/model-entitlement/entitlement-projection.ts:74`

#### 运行时有效模型集合

运行时最终允许员工使用的模型集合为：

`EnterpriseModelEntitlement ∩ Seat/Employee Grant ∩ Active Catalog`

代码依据：

- `src/gateway/model-entitlement/effective-set.ts:6`
- `src/gateway/model-entitlement/effective-set.ts:75`

### 1.2 平台操作层现状

#### 套餐管理 UI

平台“套餐与定价”页面当前已管理：

- 套餐创建
- 价格编辑
- 版本草稿
- 版本激活 / 废弃 / 删除
- pricing diff
- model binding diff
- 版本级模型选择
- 版本级模型额度
- 版本级 AOR 策略

代码依据：

- `ui/src/ui/ports/platform/pricing/page.ts:1`

#### 模型绑定后端 RPC

平台已有以下模型绑定 RPC：

- `platform-model-binding.set`
- `platform-model-binding.get`
- `platform-model-binding.list`
- `platform-model-binding.overview`

其中 `overview` 已经把 billing plan、当前版本 binding、平台目录、模型反向索引聚合为统一视图。

代码依据：

- `src/gateway/server-methods/model-entitlement-management.ts:103`
- `src/gateway/server-methods/model-entitlement-management.ts:159`

#### UI 接入状态

当前前端能力模块除原有 `platform-model-binding.*` 外，还新增了：

- `platform-plan-bundle.overview`
- `platform-plan-bundle.create`
- `platform-plan-bundle.create-version`

历史说明：

- `bindingSet`
- `bindingGet`
- `bindingList`

旧的 `platform-plan-model-binding-section` 现在已不再作为主页面入口；主流程已迁移到 pricing 页内部的版本编辑器与激活确认流。

企业端已有“模型授权”操作面，员工端已有“我的可用模型”只读面，但这两者是企业/员工侧，不是平台套餐绑模入口。

代码依据：

- `ui/src/ui/capability/model-authorization/endpoints.ts:23`
- `ui/src/ui/views/model-authorization-section.ts:1`

### 1.3 当前已知实现缺口

#### 缺口 A：模型绑定写入 referential validation 已补齐

`platform-model-binding.set` 当前只校验：

- `planVersionId` 非空
- `allowedModelIds` 是字符串数组
- `aorExecution` 结构合法

当前已补：

- `planVersionId` 存在性校验
- `allowedModelIds` 目录合法性校验

当前仍未补：

- 目标版本所属 plan 一致性显式校验
- 版本状态写入约束显式校验

代码依据：

- `src/gateway/server-methods/model-entitlement-management.ts:104`

#### 缺口 B：新版本自动继承上一版 binding 已补齐

`createPlanVersion` 会继承上一版 pricing、seatQuota、botQuota，但不会复制上一版模型绑定。

这会导致新建草稿版本后，平台管理员如果忘记重新绑定模型，激活后可能出现“套餐版本已生效但 entitlement 为空”的情况。

代码依据：

- `src/gateway/billing/plans-store.ts:176`

#### 缺口 C：删除版本同步清理 binding 已补齐

`deletePlanVersion` 只删除 billing store 中的版本记录，不会同步删除 `planVersionModelBinding` store 中对应条目。

当前 binding store 已有 delete API。

代码依据：

- `src/gateway/billing/plans-store.ts:388`
- `src/gateway/model-entitlement/plan-version-model-binding-store.ts:75`

#### 缺口 D：binding 当前不是严格不可变快照

同一个 `planVersionId` 的 binding 可以被反复 `upsert` 覆盖。

因此当前代码里“订阅锁定 planVersionId”对 billing 快照成立，但对模型集合历史并不等同于“强不可变”。

代码依据：

- `src/gateway/model-entitlement/plan-version-model-binding-store.ts:88`

#### 缺口 E：当前语义上 `PlanVersion -> ModelBinding` 不是强制 1:1

当前读取行为允许 version 没有 binding：

- `binding = null`
- entitlement 投影结果为 `allowedModelIds=[]`

因此当前实现更接近 `0..1`，不是硬约束意义上的 `1:1`。

代码依据：

- `src/gateway/model-entitlement/entitlement-projection.ts:43`

## 二、目标态定义

### 2.1 目标心智模型

平台目录是全量模型上界。

每个套餐版本从平台目录中选择一个允许子集，并为该子集定义可选的：

- 模型额度
- AOR 执行策略

企业订阅某个套餐版本后，自动拿到该套餐版本绑定出的 entitlement 上限；企业再在该上限内做 seat/employee 级授权。

### 2.2 目标关系模型

#### 数据关系

- `Plan -> PlanVersion`：`1:N`
- `PlanVersion -> PlanVersionModelBinding`：目标态管理语义为 `1:1`
- `PlanVersionModelBinding.allowedModelIds -> Platform Catalog`：目标态写入约束为“必须属于 active catalog”
- `EnterpriseModelEntitlement`：由 active subscription 的 `planVersionId` 投影
- `SeatModelGrant / EmployeeModelGrant`：必须为 entitlement 子集

#### 操作关系

平台管理员在一个统一入口中完成：

1. 创建或编辑套餐版本
2. 配置该版本价格
3. 配置该版本可用模型
4. 配置可选模型额度
5. 配置可选 AOR 策略
6. 保存并触发 entitlement 刷新

### 2.3 目标非功能要求

1. 不破坏 billing 版本锁定语义
2. 不把模型策略字段并入 billing core 类型
3. 不允许出现跨 store 半成功状态
4. 不允许平台写入无效 `planVersionId`
5. 不允许绑定目录外模型
6. 激活版本前必须满足“版本已具备合法 binding”
7. 删除版本后不得留下孤儿 binding

## 三、改造总体方案

### 3.1 总体策略

本次改造分为三层：

1. 后端约束层补齐
2. 后端统一写接口补齐
3. 平台 UI 一体化补齐

### 3.2 实施原则

#### 原则一：先补后端约束，再上统一 UI

如果先做 UI，而后端仍允许写入无效 binding、保留孤儿数据、跨 store 半成功，那么统一界面只会把问题隐藏起来。

#### 原则二：新增组合 RPC，不复用前端串联两个旧接口

不要让前端执行：

1. `platform-plans.create/update/create-version`
2. `platform-model-binding.set`

这种串联方式在第二步失败时会留下不一致状态。

#### 原则三：兼容现有分离接口，但将其降级为底层能力

现有 `platform-model-binding.set/get/list/overview` 保留，供：

- 调试
- 迁移脚本
- 低层管理工具

但平台主 UI 应切到新的组合接口。

## 四、后端改造方案

### 4.1 阶段 1：补齐 binding store 基础能力

#### 目标

为后续统一操作面提供完整的 CRUD 和校验基础。

#### 改造项

- [x] 在 `src/gateway/model-entitlement/plan-version-model-binding-store.ts` 增加删除能力
- [x] 新增 `deletePlanVersionModelBinding(planVersionId)`
- [ ] 新增 `hasPlanVersionModelBinding(planVersionId)` 或复用 `get`
- [x] 为 store 单测补充 delete 场景

#### 验收

- [x] 可删除指定 `planVersionId` binding
- [x] 删除不存在 binding 时返回稳定结果
- [x] 不影响现有 get/list/upsert 行为

### 4.2 阶段 2：补齐 binding 写入校验

#### 目标

把当前“运行时兜底”前移为“写入时防错”。

#### 改造项

在 `src/gateway/server-methods/model-entitlement-management.ts` 中补充：

- [x] 校验 `planVersionId` 对应版本存在
- [ ] 校验目标版本属于某个真实 plan
- [ ] 校验版本状态是否允许绑定
- [x] 校验 `allowedModelIds` 全部存在于当前 active catalog
- [ ] 可选：校验 `modelQuota` 的 key 只能来自 `allowedModelIds`
- [ ] 可选：校验 `aorExecution` 仅在配置模式允许时写入

#### 建议状态约束

建议允许以下状态写 binding：

- `draft`
- `active`
- `deprecated`

但平台主 UI 只允许编辑：

- 新建套餐首版本
- `draft`
- 当前 `active` 版本的受控修改路径

说明：

后端可稍宽，方便迁移和修复；UI 应更严格，避免运营误操作。

#### 验收

- [x] 写入不存在的 `planVersionId` 被拒绝
- [x] 写入目录外模型被拒绝
- [x] 错误信息明确指出非法模型 id
- [x] 现有投影链路不受影响

### 4.3 阶段 3：补齐版本生命周期与 binding 同步规则

#### 目标

让套餐版本生命周期和模型绑定生命周期保持一致。

#### 改造项

##### A. 新建版本自动继承上一版 binding

在 `createPlanVersion` 对应的服务端流程中增加：

- [x] 如果当前 active version 有 binding，则新 draft version 自动复制一份
- [x] 复制内容包括 `allowedModelIds`
- [ ] 可选复制 `modelQuota`
- [ ] 可选复制 `aorExecution`
- [x] 复制应记录新的 `updatedAt`

注意：

不建议把该逻辑直接写死在 billing store 文件内部，因为 billing 模块应继续保持对 model-entitlement 无感知。

推荐做法：

- 在 server method 层或新 service 层实现“创建套餐版本 + 继承 binding”的组合流程

##### B. 删除版本同步删除 binding

在 `platform-pricing.delete-version` 流程中增加：

- [x] 删除 billing version 成功后，删除对应 binding
- [ ] 任一步失败要返回一致错误
- [x] 需要防止“删了 version 但 binding 残留”

##### C. 激活前校验 binding 存在且合法

在 `platform-pricing.activate` 前增加：

- [x] 校验目标 `versionId` 已存在 binding
- [x] 校验 binding 非空或符合当前产品策略
- [x] 校验 binding 中模型均仍在 active catalog

关于“允许空 binding”建议：

- 默认不允许平台激活一个没有 binding 的版本
- 若确有“套餐禁用所有模型”的产品场景，应通过显式开关或特殊计划类型建模，而不是靠漏配实现

#### 验收

- [x] 新草稿默认继承上一版 binding
- [x] 激活前缺 binding 会被拦截
- [x] 删除版本后无孤儿 binding

### 4.4 阶段 4：新增统一写接口

#### 目标

把“套餐版本 + 模型绑定”改造为服务端一次保存。

#### 推荐新增 RPC

建议新增一组组合接口：

- [x] `platform-plan-bundle.create`
- [ ] `platform-plan-bundle.update`
- [x] `platform-plan-bundle.create-version`
- [ ] `platform-plan-bundle.save-draft`
- [ ] `platform-plan-bundle.activate`
- [ ] `platform-plan-bundle.get`
- [ ] `platform-plan-bundle.list`

命名可调整，但建议与现有 `platform-plans.*` / `platform-pricing.*` 区分开，表达“组合对象”。

#### 请求对象建议

```ts
type PlanVersionModelBindingDraft = {
  allowedModelIds: string[];
  modelQuota?: Record<string, { maxRequests?: number; maxTokens?: number }>;
  aorExecution?: {
    taskTypeId: string;
    selectorStrategy: "cheapest" | "best_quality" | "balanced" | "bandit";
    evaluatorMode: string;
  };
};

type PlanBundleDraft = {
  planId?: string;
  versionId?: string;
  name: string;
  billingCycle: "monthly";
  basePriceCents: number;
  seatQuota: Record<string, number>;
  botQuota: number;
  pricing: Array<{ type: "seat" | "usage" | "extra"; key: string; priceCents: number }>;
  modelBinding: PlanVersionModelBindingDraft;
};
```

#### 写入顺序建议

统一保存流程建议为：

1. 校验 plan draft 输入
2. 校验 binding 输入
3. 写 billing version
4. 写 binding
5. 如目标版本已被订阅，则刷新 entitlement
6. 返回组合视图

#### 一致性建议

当前 repo 仍是 JSON store，没有跨文件事务。

建议采用以下策略之一：

##### 方案 A：补偿式提交

- 先写 billing
- 再写 binding
- binding 失败时尝试回滚本次新建的 version

优点：

- 改动相对小

缺点：

- 需要小心回滚失败场景

##### 方案 B：引入服务层逻辑锁 + staged write

- 在服务层同一把 async lock 下完成完整流程
- 所有输入先校验
- 确认能写后再依次落盘
- 对“新建草稿失败”提供显式修复脚本

优点：

- 实现更稳

缺点：

- 仍非真正数据库事务

本轮建议采用方案 B，并辅以 doctor 检查和修复脚本。

### 4.5 阶段 5：扩展统一读接口

#### 目标

让 UI 一次拉到“套餐 + 当前版本 + 当前 binding + 目录候选 + 反向引用”。

#### 当前基础

当前已新增 `platform-plan-bundle.overview`，并已返回：

- plan 列表
- version 列表
- 绑定状态字段
- `activationReady`
- `activationBlockers`
- catalog 候选列表

当前仍未覆盖：

- 反向索引
- 独立 `get/list` 形态

#### 建议新增或扩展返回

- [x] 每个 plan 的全部 versions
- [x] 每个 version 的 binding 概览
- [x] 每个 version 的 binding 状态
- [x] catalog 候选列表
- [ ] reverseIndex
- [x] UI 直接可用的治理标记

#### 建议派生字段

- `bindingState: "missing" | "valid" | "invalid_catalog" | "empty"`
- `activationReady: boolean`
- `activationBlockers: string[]`

## 五、前端改造方案

### 5.1 改造目标

以 `ui/src/ui/ports/platform/pricing/page.ts` 为主入口，把“套餐与定价”升级为“套餐版本与模型绑定”的统一控制面。

### 5.2 为什么放在 pricing 页面

当前平台 models 页面中的 `taskPlans` 是另一套“任务方案/模型路由”概念，不等于 billing 套餐。

如果把套餐绑模入口塞进 models 页，会混淆：

- 计费套餐版本
- AOR 任务方案
- 路由策略 plan

代码依据：

- `ui/src/ui/ports/platform/models/snapshot-types.ts:142`
- `src/gateway/models/platform-models-snapshot.ts:88`

因此统一入口应放在：

- `ui/src/ui/ports/platform/pricing/page.ts`

### 5.3 页面形态建议

#### 一级结构

- 套餐列表
- 套餐详情
- 版本列表
- 版本编辑器

#### 在版本编辑器内新增分区

1. 基础信息
   - 套餐名
   - basePrice
   - seatQuota
   - botQuota

2. 定价规则
   - seat / usage / extra pricing rows

3. 可用模型
   - 从 catalog 多选
   - 支持搜索
   - 支持按 provider / 状态筛选

4. 模型额度
   - 仅对已选模型展示额度输入

5. AOR 策略
   - 可选 taskTypeId
   - selectorStrategy
   - evaluatorMode

6. 激活检查
   - 缺 binding
   - 含目录外模型
   - 空模型集合
   - entitlement 刷新影响范围预览

执行状态（2026-06-12）：

- 价格编辑：已并入
- 可用模型：已并入
- 模型额度：已并入
- AOR 策略：已并入
- 激活检查：已部分并入（阻断状态、pricing diff、model diff 已有；entitlement 刷新影响范围预览仍未做）

### 5.4 页面交互建议

#### 新建套餐

流程：

1. 填基础信息
2. 填价格
3. 选模型
4. 保存

保存后应同时创建：

- `Plan`
- 初始 `PlanVersion`
- 初始 `PlanVersionModelBinding`

#### 新建草稿版本

流程：

1. 点击“新建草稿版本”
2. 自动继承当前 active version 的定价与 binding
3. 用户在同一编辑器中调整价格和模型
4. 保存草稿
5. 查看激活 diff
6. 激活

#### 激活确认

现有激活确认基于 pricing diff。

应扩展为双 diff：

- pricing diff
- model binding diff

模型 diff 至少展示：

- 新增模型
- 移除模型
- 额度变化
- AOR 策略变化

### 5.5 页面状态建议

#### 版本卡片状态

- `Draft`
- `Active`
- `Deprecated`
- `Binding Missing`
- `Binding Invalid`
- `Ready To Activate`

#### 目录外模型提示

如果历史 binding 中有已下线模型：

- 在编辑器中单独列出
- 不允许直接激活
- 引导管理员替换或移除

#### 反向视图

在平台目录或模型详情侧增加：

- “已被哪些套餐版本包含”
- “被哪些 active 套餐包含”

后端已有 `reverseIndex` 基础，但需按 version 维度增强。

## 六、数据一致性与治理方案

### 6.1 统一约束

建议建立以下治理规则：

1. 新创建的 `PlanVersion` 必须在保存完成前具备 binding
2. 激活前版本必须具备合法 binding
3. binding 中不得含目录外模型
4. 删除 version 时必须清理 binding
5. 当前 active version 的 binding 改动必须触发 entitlement 刷新

### 6.2 对 active version 改 binding 的处理策略

当前后端已允许对同一 `planVersionId` 直接改 binding，并刷新所有锁定该版本的租户 entitlement。

代码依据：

- `src/gateway/server-methods/model-entitlement-management.ts:127`

本轮需要明确产品策略。建议二选一：

#### 方案 1：允许改 active version binding

优点：

- 响应快
- 运营可即时修正

缺点：

- 严格意义上破坏“版本快照不可变”直觉
- 历史可解释性稍弱

#### 方案 2：禁止直接改 active version binding，只能新建 draft version 再激活

优点：

- 与 billing 版本快照语义最一致
- 审计和回放最清晰

缺点：

- 运营操作更重

本轮建议：

- UI 默认走方案 2
- 后端底层接口可保留方案 1 作为修复通道
- 平台主流程一律通过“新 draft version -> 激活”完成正式变更

### 6.3 doctor 与修复脚本

建议新增/扩展 doctor 检查项：

- [ ] plan version 存在但 binding 缺失
- [ ] binding 指向不存在的 planVersionId
- [ ] binding 含目录外模型
- [ ] deprecated / deleted version 残留 binding
- [ ] active plan currentVersionId 对应版本缺 binding

建议新增修复脚本：

- [x] 扫描并列出 orphan bindings
- [ ] 为新草稿批量复制上一版 binding
- [x] 清理已删除版本的 binding（当前脚本仅支持 orphan binding 删除）

## 七、测试方案

### 7.1 后端单元测试

- [x] `plan-version-model-binding-store.test.ts` 增 delete / orphan 清理场景
- [x] `model-entitlement-management.test.ts` 增 planVersion 存在性校验
- [x] `model-entitlement-management.test.ts` 增 catalog 校验
- [x] 新增组合 RPC 测试：成功保存、激活前校验

### 7.2 集成测试

- [ ] 新建套餐并绑定模型后，订阅企业可拿到 entitlement
- [x] 创建新草稿版本自动继承 binding
- [x] 激活新版本后，新订阅和存量订阅投影正确
- [x] 删除未引用版本后，binding 被同步删除

### 7.3 前端浏览器测试

- [x] pricing 页面渲染模型绑定分区
- [x] 新建套餐时一次保存价格与模型
- [x] 草稿版本能看到继承的模型集合
- [x] 激活前可见 pricing diff + model diff
- [x] 缺 binding / 目录外模型时显示阻断提示

### 7.4 回归测试重点

- [ ] 现有企业端模型授权页面不受影响
- [ ] 员工端“我的可用模型”不受影响
- [ ] 现有 pricing 页面版本生命周期不回退
- [ ] `refreshEntitlementsForPlanVersion` 在新流程中仍正确触发

## 八、灰度与上线方案

### 8.1 发布顺序

1. 先发后端校验与 doctor
2. 再发组合读接口
3. 再发组合写接口
4. 最后发平台 UI

### 8.2 灰度策略

- 第一步仅新增后端能力，不切 UI
- 第二步让 UI 支持新旧接口双栈
- 第三步在平台管理员范围灰度新页面
- 稳定后把旧分离操作入口降为内部工具

### 8.3 回滚策略

#### UI 回滚

可直接回退到旧的 pricing 页面，不影响后端数据。

#### 后端回滚

需保留：

- 现有 `platform-plans.*`
- 现有 `platform-pricing.*`
- 现有 `platform-model-binding.*`

这样即使组合 RPC 回滚，旧接口仍可操作。

## 九、任务拆分建议

### 工作流 1：后端约束

- 负责人：Gateway / Billing
- 范围：
  - binding delete
  - referential validation
  - catalog validation
  - activation guard

### 工作流 2：后端组合服务

- 负责人：Gateway / Platform Control Plane
- 范围：
  - 组合 RPC
  - 新版本继承 binding
  - version 删除清理 binding
  - 组合 overview 接口

### 工作流 3：平台前端

- 负责人：Platform UI
- 范围：
  - pricing 页面重构
  - model binding editor
  - 双 diff 激活确认
  - 状态标记与阻断提示

### 工作流 4：治理与上线

- 负责人：QA / Platform Ops
- 范围：
  - doctor 扩展
  - 修复脚本
  - 回归测试
  - 灰度与回滚预案

## 十、建议实施顺序

### Phase A：后端收口

- [x] A1. binding store 增 delete 能力
- [x] A2. `platform-model-binding.set` 增 referential validation
- [x] A3. `platform-pricing.activate` 增 binding ready 校验
- [x] A4. `platform-pricing.delete-version` 增 binding 清理

### Phase B：组合服务

- [x] B1. 新增组合 save RPC（create / create-version）
- [x] B2. 新增 create-version 自动继承 binding
- [x] B3. 新增组合 overview RPC
- [x] B4. 增组合接口集成测试

### Phase C：平台 UI

- [x] C1. pricing 页面接组合读接口
- [x] C2. 版本编辑器新增“可用模型”分区
- [x] C3. 激活确认新增 model diff
- [x] C4. 版本状态新增 binding health 标记

### Phase D：治理上线

- [ ] D1. doctor 扩展
- [ ] D2. 修复脚本
- [ ] D3. 灰度发布
- [ ] D4. 旧操作路径降级

## 十一、最终验收标准

### 功能验收

- [x] 平台管理员可在一个页面完成“套餐版本 + 模型集合”配置
- [ ] 新建草稿版本自动继承上一版模型绑定
- [x] 激活前可见完整差异与阻断项
- [ ] 激活后 entitlement 正确刷新到受影响租户

### 数据验收

- [ ] 不存在引用不存在 version 的 binding
- [ ] 不存在已删除 version 的孤儿 binding
- [ ] 不存在含目录外模型的 active binding
- [ ] active version 均有合法 binding

### 运行时验收

- [ ] 员工实际可用模型仍然受 entitlement ∩ grant ∩ active catalog 约束
- [ ] 企业端授权不越权
- [ ] 平台模型下线后，相关套餐版本会被识别为待修复而非静默带病激活

## 附录：当前代码依据

- `src/gateway/billing/types.ts:78`
- `src/gateway/billing/plans-store.ts:15`
- `src/gateway/billing/plans-store.ts:176`
- `src/gateway/billing/plans-store.ts:388`
- `src/gateway/model-entitlement/plan-version-model-binding-store.ts:2`
- `src/gateway/model-entitlement/plan-version-model-binding-store.ts:88`
- `src/gateway/model-entitlement/entitlement-projection.ts:43`
- `src/gateway/model-entitlement/entitlement-projection.ts:74`
- `src/gateway/model-entitlement/effective-set.ts:6`
- `src/gateway/model-entitlement/effective-set.ts:75`
- `src/gateway/server-methods/model-entitlement-management.ts:103`
- `src/gateway/server-methods/model-entitlement-management.ts:159`
- `ui/src/ui/ports/platform/pricing/page.ts:1`
- `ui/src/ui/capability/model-authorization/endpoints.ts:23`
- `ui/src/ui/views/model-authorization-section.ts:1`
- `ui/src/ui/ports/platform/models/snapshot-types.ts:142`
- `src/gateway/models/platform-models-snapshot.ts:88`
