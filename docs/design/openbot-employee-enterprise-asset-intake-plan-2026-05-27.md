# OpenBot 员工端资产包提交与企业端承接治理方案

## 1. 目标

本方案用于解决一个关键问题：

- 员工端已经可以把“我的资产”提交给企业
- 企业端也已有审核、入库、安装、孵化等能力
- 但两端之间当前只对接了“一个能力条目”，没有对接“一个企业可经营的资产包”

目标是把员工在对话中形成的成熟操作经验，整理为可复用、可审核、可发布、可安装、可治理的企业资产包，并保证方案能基于当前代码结构落地。

本方案以“公众号文章编辑与发布”作为典型案例，但不绑定单一业务场景。

## 2. 当前代码现状

### 2.1 员工端已有能力

员工端系统设置中的“我的资产”已经具备以下动作：

- 编辑资产
- 删除资产
- 共享到协作小组
- 提交到企业

关键入口：

- `ui/src/ui/ports/employee/render-model.ts:2695-2798`
- `ui/src/ui/views/my-accumulation.ts:301`
- `ui/src/ui/views/my-accumulation.ts:479`

员工端后端提交企业的 RPC 已存在：

- `src/gateway/server-methods/employee-capability.ts:940-980`

生命周期切换也已存在：

- `src/gateway/skill-lifecycle-store.ts:1041-1048`

当前提交企业后，后端会：

1. 把员工资产生命周期切到 `reviewing`
2. 生成或复用 proposal
3. 返回“审核中”或“已进入企业资产库”

### 2.2 员工端“自动整理为资产”已有雏形

当前员工端已经具备对话中自动识别“可资产化内容”的雏形：

- 资产建议触发器：
  - `ui/src/ui/controllers/asset-suggestion-trigger.ts`
- 对话内容抽取预览：
  - `src/gateway/server-methods/skill-lifecycle.ts:60-72`
  - `src/gateway/skill-lifecycle-store.ts:735-738`
- 保存为资产草稿弹层：
  - `ui/src/ui/views/save-skill-modal.ts`
  - `ui/src/ui/controllers/skill-lifecycle.ts`
- 快速保存能力弹层：
  - `ui/src/ui/views/quick-capability-save-modal.ts`
  - `ui/src/ui/controllers/quick-capability-save.ts`

### 2.3 员工端当前最大不足

无论是 `skill-lifecycle.save` 还是 `employee-capability.quick-save`，目前都只适合保存“轻量能力条目”。

当前快速保存只包含：

- `name`
- `summary`

见：

- `ui/src/ui/capability/employee-capability/types.ts:77-80`
- `ui/src/ui/controllers/quick-capability-save.ts:56-94`
- `ui/src/ui/views/quick-capability-save-modal.ts:31-68`

这不足以表达“公众号文章编辑与发布”这类复合资产。

### 2.4 企业端已有能力

企业端能力中心已经接了以下真实治理链：

- 首页跳转：
  - 审核队列
  - 企业资产库
  - 安装管理
  - 贡献记录
  - 孵化中心
- 路由分发：
  - `ui/src/ui/ports/enterprise/views/enterprise-capability-center-surface.ts:1172-1181`
- 审核动作：
  - `通过`
  - `拒绝`
  - `需修改`
  - `ui/src/ui/controllers/enterprise-asset-library/review-queue.ts:132-245`
- 安装管理动作：
  - 卸载
  - `ui/src/ui/views/enterprise-asset-library/install-management-page.ts:305`
  - `src/gateway/server-methods/enterprise-capability.ts:1358-1439`
- 孵化与上报：
  - `ui/src/ui/ports/enterprise/views/enterprise-capability-center-surface.ts:1477-1560`

### 2.5 企业端“能力应用管理”已有能力

企业端能力应用管理已有四个子页：

- `机器人视图`
- `安装关系`
- `效果分析`
- `应用治理`

见：

- `ui/src/ui/views/enterprise-capability-usage-management/usage-management-page.ts:60-65`

其中：

- `安装关系` 具备真实卸载动作
  - `ui/src/ui/views/enterprise-capability-usage-management/install-management-dual-view-page.ts:161-257`
  - `ui/src/ui/controllers/enterprise-capability-usage-management/install-management-dual-view.ts:223-257`
- `应用治理` 有阈值更新和建议动作雏形，但没有完整执行闭环
  - `ui/src/ui/views/enterprise-capability-usage-management/usage-governance-page.ts:73-169`
  - `ui/src/ui/controllers/enterprise-capability-usage-management/usage-governance.ts:94-154`

## 3. 核心问题定义

当前系统的主要问题不是“没有提交流程”，而是：

1. 员工端提交的是“单条能力”，不是“企业资产包”
2. 企业端承接的是“审核队列项”，不是“员工资产承接单”
3. 资产进入企业后，与安装、运行、优化、回流之间的关系仍然松散
4. 员工端提交时缺乏足够的业务上下文与风险信息

## 4. 最终业务模型

### 4.1 新概念：企业资产包

建议引入统一概念：`EnterpriseAssetPackage`

含义：

- 它不是单一 prompt / template / capability
- 它是一组围绕某个业务场景形成的复合资产

例如“公众号文章编辑与发布”资产包可以包含：

- 流程资产
- 模板资产
- 知识资产
- 运行资产

### 4.2 资产包分类

建议新增 `assetPackageType`：

- `single_capability`
- `template_pack`
- `workflow_pack`
- `knowledge_pack`
- `automation_pack`
- `composite_pack`

### 4.3 资产包执行方式

建议新增 `executionMode`：

- `assistive`
- `semi_automatic`
- `automatic`

### 4.4 资产包风险标签

建议新增 `riskTags`：

- `external_publish`
- `credential_required`
- `brand_risk`
- `customer_data`
- `manual_review_required`

## 5. 员工端实现方案

### 5.1 保留当前“我的资产”入口，但升级提交形态

不改变员工端“我的资产”的大结构，继续复用：

- `ui/src/ui/views/my-accumulation.ts`
- `ui/src/ui/ports/employee/render-model.ts`

但要把“提交到企业”升级成：

- `提交企业资产包`

### 5.2 员工端新增“资产包整理向导”

建议在 `employee-capability.submit-to-enterprise` 之前增加一个整理向导。

#### 自动生成字段

- `packageTitle`
- `packageSummary`
- `assetPackageType`
- `businessScenario`
- `inputArtifacts`
- `outputArtifacts`
- `dependencies`
- `executionMode`
- `riskTags`
- `suggestedScope`

#### 员工补充字段

- `verifiedInProduction`
- `promotionIntent`
- `targetTeams`
- `needsEnterpriseSecrets`
- `notes`

### 5.3 员工端字段模型

建议新增类型：

- 文件：
  - `ui/src/ui/capability/employee-capability/types.ts`

新增：

```ts
export type AssetPackageType =
  | "single_capability"
  | "template_pack"
  | "workflow_pack"
  | "knowledge_pack"
  | "automation_pack"
  | "composite_pack";

export type ExecutionMode = "assistive" | "semi_automatic" | "automatic";

export type RiskTag =
  | "external_publish"
  | "credential_required"
  | "brand_risk"
  | "customer_data"
  | "manual_review_required";

export type EnterpriseAssetPackageDraft = {
  packageTitle: string;
  packageSummary: string;
  assetPackageType: AssetPackageType;
  businessScenario: string;
  inputArtifacts: string[];
  outputArtifacts: string[];
  dependencies: string[];
  executionMode: ExecutionMode;
  riskTags: RiskTag[];
  targetTeams: string[];
  verifiedInProduction: boolean;
  promotionIntent: "internal_reuse" | "pilot" | "enterprise_standard" | "platform_candidate";
  needsEnterpriseSecrets: boolean;
  notes: string;
};
```

### 5.4 自动识别与预填充

当前可复用的入口：

- `asset-suggestion-trigger.ts`
- `skill-lifecycle.extract`
- `save-skill-modal.ts`

建议扩展：

- `ExtractedSkillPreview` 不再只给 `suggestedName / suggestedSummary`
- 增加：
  - `suggestedAssetPackageType`
  - `suggestedScenario`
  - `suggestedExecutionMode`
  - `suggestedRiskTags`
  - `suggestedDependencies`

涉及文件：

- `src/gateway/skill-lifecycle-store.ts`
- `src/gateway/server-methods/skill-lifecycle.ts`
- `ui/src/ui/controllers/skill-lifecycle.ts`
- `ui/src/ui/views/save-skill-modal.ts`

### 5.5 员工端“提交企业”载荷升级

当前载荷只有：

- `capabilityId`
- `scope`

见：

- `ui/src/ui/ports/employee/render-model.ts:2785-2789`

建议改成：

```ts
{
  capabilityId,
  packageDraft,
  submissionMeta: {
    sourceAgentId,
    sourceContextId,
    submittedFrom: "my-accumulation",
  }
}
```

## 6. 企业端承接方案

### 6.1 企业端新增“资产承接单”视图

位置建议：

- `企业能力中心` 首页第一屏

不是直接看能力列表，而是先看：

- `待审核承接单`
- `待入库承接单`
- `待试点推广`
- `待孵化评估`

### 6.2 承接单字段模型

建议在 proposal manifest 扩展字段，不另造完全独立存储。

当前治理 manifest 允许扩展字段：

- `src/gateway/capability-governance-store.ts:37-56`

可以直接在 `manifest` 上增加：

```ts
enterpriseAssetPackage?: {
  packageType: AssetPackageType;
  businessScenario: string;
  inputArtifacts: string[];
  outputArtifacts: string[];
  dependencies: string[];
  executionMode: ExecutionMode;
  riskTags: RiskTag[];
  targetTeams: string[];
  verifiedInProduction: boolean;
  promotionIntent: string;
  needsEnterpriseSecrets: boolean;
  notes: string;
};
```

### 6.3 企业审核队列需要展示的新信息

当前审核队列主要围绕：

- 名称
- 场景
- 来源员工
- 来源机器人
- 安全/质量评估

见：

- `src/gateway/server-methods/enterprise-capability.ts:978-1020`

应新增承接信息：

- 资产包类型
- 执行方式
- 依赖项
- 风险标签
- 是否涉及凭证
- 目标团队
- 是否已在生产验证

### 6.4 企业管理员新增动作

当前已有：

- `通过`
- `拒绝`
- `需修改`

建议补充：

- `拆分入库`
- `仅内部试点`
- `指定资产负责人`
- `要求补充凭证方案`
- `标记仅辅助使用`
- `允许自动执行`
- `加入孵化`

## 7. “公众号文章编辑与发布”资产包示例

员工端自动识别时，建议机器人生成如下结构：

```json
{
  "packageTitle": "公众号文章编辑与发布",
  "packageSummary": "用于完成公众号文章编辑、封面生成、素材上传与正式发布的复合资产包。",
  "assetPackageType": "composite_pack",
  "businessScenario": "公众号文章编辑与发布",
  "inputArtifacts": ["文章标题", "正文 Markdown", "作者信息", "封面图素材"],
  "outputArtifacts": ["已发布公众号文章", "封面 media_id", "发布结果记录"],
  "dependencies": ["publish.js", "gen_cover.sh", "wechat-config.md", "微信公众号接口"],
  "executionMode": "semi_automatic",
  "riskTags": ["external_publish", "credential_required", "brand_risk"],
  "targetTeams": ["市场", "内容运营", "新媒体"],
  "verifiedInProduction": true,
  "promotionIntent": "enterprise_standard",
  "needsEnterpriseSecrets": true,
  "notes": "已形成可复用脚本与配置说明，需企业统一托管公众号凭证。"
}
```

## 8. 企业能力中心与能力应用管理的分工

### 企业能力中心

负责：

- 承接员工提交
- 审核
- 入库
- 贡献回溯
- 孵化升级

当前可复用实现：

- 审核队列：
  - `ui/src/ui/controllers/enterprise-asset-library/review-queue.ts`
- 安装管理跳转：
  - `ui/src/ui/views/enterprise-asset-library/enterprise-capability-center-page.ts:251-258`
- 孵化中心：
  - `ui/src/ui/ports/enterprise/views/enterprise-capability-center-surface.ts:1477-1560`

### 能力应用管理

负责：

- 安装投放
- 使用效果
- 异常治理
- 反馈回流

当前可复用实现：

- 子路由壳：
  - `ui/src/ui/views/enterprise-capability-usage-management/usage-management-page.ts`
- 安装关系治理：
  - `install-management-dual-view-page.ts`
- 使用治理：
  - `usage-governance-page.ts`

## 9. 代码级实施顺序

### Phase 1：补员工端资产包提交模型

修改文件：

- `ui/src/ui/capability/employee-capability/types.ts`
- `ui/src/ui/controllers/skill-lifecycle.ts`
- `ui/src/ui/views/save-skill-modal.ts`
- `ui/src/ui/ports/employee/render-model.ts`
- `src/gateway/server-methods/skill-lifecycle.ts`
- `src/gateway/server-methods/employee-capability.ts`
- `src/gateway/skill-lifecycle-store.ts`

目标：

- 员工端可生成并编辑 `EnterpriseAssetPackageDraft`
- 提交企业时带上完整包信息

### Phase 2：补企业端承接单展示

修改文件：

- `src/gateway/server-methods/enterprise-capability.ts`
- `ui/src/ui/capability/enterprise-capability/endpoints.ts`
- `ui/src/ui/views/enterprise-asset-library/review-queue-page.ts`
- `ui/src/ui/ports/enterprise/views/enterprise-capability-center-surface.ts`

目标：

- 审核队列展示资产包关键信息
- 企业能力中心首页出现承接单工作台

### Phase 3：补治理动作闭环

修改文件：

- `ui/src/ui/views/enterprise-capability-usage-management/usage-governance-page.ts`
- `ui/src/ui/controllers/enterprise-capability-usage-management/usage-governance.ts`

目标：

- 阈值配置面板可编辑
- 建议动作有执行确认链
- 能回流到能力详情/安装关系

### Phase 4：补员工回流状态

修改文件：

- `ui/src/ui/ports/employee/render-model.ts`
- `ui/src/ui/views/my-accumulation.ts`
- `src/gateway/server-methods/employee-capability.ts`

目标：

- 员工端不只看到“审核中/已进入企业资产库”
- 还能看到企业反馈、是否进入试点、是否被要求补充

## 10. 方案边界

本阶段不做：

- 平台端商业化定价
- 企业资产包的支付/分成
- 多级审批流引擎
- 复杂组织级 RBAC 扩展

本阶段先保证：

- 员工端可标准化提交
- 企业端可承接
- 企业管理员可审核和治理
- 应用反馈可回流

## 11. 最终判断

当前代码已经具备这套方案的关键基础：

- 员工端资产沉淀：有
- 员工提交企业：有
- 企业审核：有
- 企业安装管理：有
- 企业孵化上报：有

缺的不是底座，而是：

- 提交内容太轻
- 企业承接语义太弱
- 治理动作链不完整

因此，本方案在代码层面是可落地的，且可以分阶段渐进实施，而不需要推翻现有能力中心与能力应用管理结构。
