# 业务分析：员工端资产孵化、标准化与推广应用全生命周期

## 1. 背景与目标

本能力生命周期闭环模块，当前已经覆盖了“员工能力沉淀 → 企业能力管理 → 企业孵化 → 平台上行 → 员工市场回流”的主干路径，但现阶段更多是围绕 **skill / capability** 这一类资产展开，离“员工在使用机器人过程中自然产生 AI 资产，并逐步孵化为 agent、工作流、模版、prompt、知识库等企业与平台资产”的完整业务目标，还有一层抽象与统一模型需要补齐。

这份分析的目标是：

1. 统一梳理员工端、企业端、平台端当前已经落地的资产与能力管理现状
2. 抽象出“资产孵化 → 标准化 → 推广应用 → 反馈再沉淀”的完整业务闭环
3. 明确当前实现中的关键断点、命名不一致点、数据模型缺口
4. 给出一条基于现有代码底座演进的实现路线，而不是另起一套全新系统

---

## 2. 当前现状梳理

### 2.1 员工端：已经具备“个人资产沉淀”底座

当前员工侧已经具备个人能力沉淀链路，核心事实如下：

- `skill-lifecycle.extract` 已支持从机器人上下文提取可保存能力预览，见 `src/gateway/server-methods/skill-lifecycle.ts:59`
- `skill-lifecycle.save` 已支持把能力保存为个人资产，见 `src/gateway/server-methods/skill-lifecycle.ts:74`
- 个人资产存储层已经明确区分了业务层与运行层：
  - 业务层：`EmployeeSkillProfile`
  - 运行层：`SkillRuntimeDefinition`
  - 见 `src/gateway/skill-lifecycle-store.ts:8`
- 员工侧已具备个人资产编辑、共享、提交企业、安装到机器人等动作：
  - `personal-skills.edit`，见 `src/gateway/server-methods/skill-lifecycle.ts:114`
  - `personal-skills.share`，见 `src/gateway/server-methods/skill-lifecycle.ts:140`
  - `personal-skills.submit`，见 `src/gateway/server-methods/skill-lifecycle.ts:153`
  - `robot-skills.install`，见 `src/gateway/server-methods/skill-lifecycle.ts:220`
- 员工能力视图还存在一套更贴业务语言的接口：
  - `employee-capability.submit-to-enterprise`，见 `src/gateway/server-methods/employee-capability.ts:504`
  - `employee-capability.recommendations`，见 `src/gateway/server-methods/employee-capability.ts:533`

这说明员工端已经不是“从零开始”，而是已经具备：

1. 资产发现入口
2. 资产保存入口
3. 个人资产库
4. 小组共享能力
5. 向企业提交能力
6. 装配到机器人运行

### 2.2 企业端：已经具备“企业资产管理 + 孵化管理 + 使用治理”三层

企业侧当前已经拆成三块：

1. **企业能力中心**
   - 负责企业资产列表、详情、审核、安装、贡献、统计
   - 核心端点在 `enterprise-capability.*`
   - 见 `src/gateway/server-methods/enterprise-capability.ts`

2. **企业能力孵化中心**
   - 负责候选池、评分、晋升决策、效果追踪、上行状态
   - 核心端点在 `incubation.*` / `upstream.*`
   - 见 `src/gateway/server-methods/incubation.ts:217`

3. **企业能力使用管理**
   - 负责安装视图、机器人视图、分析与治理
   - 对运行时使用数据已有消费界面与控制器
   - 对应目录 `ui/src/ui/controllers/enterprise-capability-usage-management/`

此外，企业能力中心已经明确坚持一个非常重要的架构原则：

- 企业端只消费业务能力投影，不暴露运行时 prompt、workflow、provider、routing 等技术细节
- 见 `.kiro/specs/enterprise-capability-asset-library/design.md:12`

这说明企业端已经拥有“业务资产中心”的正确方向，只是当前资产类型仍偏单一。

### 2.3 平台端：已经具备“治理注册表 + 提案审批”底座

平台侧当前真正的底座并不是 `enterprise-capability.promote-to-standard` 本身，而是 `capabilities.governance.*` 这组治理接口：

- `capabilities.governance.listProposals`
- `capabilities.governance.listRegistry`
- `capabilities.governance.submitProposal`
- `capabilities.governance.approveProposal`
- `capabilities.governance.rejectProposal`
- `capabilities.governance.updateDistribution`
- `capabilities.governance.updateLifecycle`
- `capabilities.governance.updateManifest`

见 `src/gateway/server-methods/capability-governance.ts:20`

其底层存储模型也已经具备：

- 提案 `GovernanceProposal`
- 注册表项 `GovernanceRegistryEntry`
- 分发策略 `GovernanceDistributionPolicy`
- 生命周期 `GovernanceLifecycleState`

见 `src/gateway/capability-governance-store.ts:16`

这意味着平台端已经有了“平台能力市场 / 治理中心”的核心底盘，只是目前和企业孵化链路之间还是弱耦合桥接，不是同一个统一资产模型。

---

## 3. 当前系统已经形成的主干业务链

基于现有代码，当前已经存在一条可运行但尚不完整的链路：

1. 员工从机器人使用中提取能力预览
2. 员工保存为个人能力资产
3. 员工编辑、补充、共享到协作小组
4. 员工提交到企业审核
5. 企业形成能力资产视图并进行审核/发布
6. 企业从已沉淀资产中挑选高价值能力进入孵化候选池
7. 企业管理员做“继续孵化 / 推荐上报 / 不适合晋升”决策
8. 企业向平台发起标准化上报
9. 平台通过治理提案与注册表完成收录
10. 平台标准能力再通过员工市场回流给员工安装使用

如果用一句话概括：

**当前系统已经具备闭环骨架，但还没有真正实现“多资产类型统一孵化”和“企业孵化链路与平台治理链路完全打通”。**

---

## 4. 业务上真正要解决的问题

你提出的目标不是单纯做“企业能力中心”，而是做一套 **员工工作过程中的 AI 资产工厂**。这个目标比当前实现大一层，核心不是“再多一个页面”，而是要解决以下 5 个问题：

### 4.1 资产从哪里来

资产不能只靠员工手工新建。真正高价值的资产，应来自：

1. 机器人在真实业务任务中的成功完成记录
2. 员工多次复用的提示词片段
3. 稳定重复的任务执行链路
4. 员工上传并反复使用的知识材料
5. 对同类问题长期有效的回复模版
6. 在多个机器人之间被重复安装和复用的能力组合

### 4.2 资产如何被抽象

员工日常产生的是“碎片”，不是标准资产。系统需要把碎片自动抽象为不同类型：

- `prompt asset`
- `template asset`
- `workflow asset`
- `agent asset`
- `knowledge asset`
- `tool recipe asset`

### 4.3 资产如何从“个人技巧”变成“企业标准”

高价值资产不能停留在个人草稿。它需要经过：

1. 个人补全
2. 小组共创
3. 企业标准化
4. 企业推广
5. 平台认证

### 4.4 资产如何推广

资产价值不在于被“收录”，而在于被“复用”。所以推广应用必须是闭环中的核心环节，而不是附属动作：

1. 给谁推荐
2. 如何安装
3. 如何启用
4. 是否有效
5. 是否扩散
6. 是否退化

### 4.5 资产如何形成正反馈

真正的闭环不是“上传成功”，而是：

**推广后效果更好 → 继续沉淀改进 → 再次标准化 → 更大范围推广**

---

## 5. 建议的全生命周期业务逻辑

建议把全生命周期拆成 8 个阶段。

### 阶段 A：资产发现（Discovery）

目标：从员工与机器人的真实协作过程中，自动发现“可沉淀资产”。

输入信号：

1. 高频重复任务
2. 高成功率对话片段
3. 稳定的工具调用顺序
4. 高复用提示词
5. 反复命中的知识资料
6. 员工主动保存或收藏动作

输出对象：

- 资产候选片段 `AssetCandidate`

关键业务规则：

1. 每个候选片段都必须保留来源追踪：来源机器人、来源会话、来源任务、来源员工
2. 每个候选片段都必须标注候选类型，而不是一律视为 skill
3. 系统自动发现与员工主动保存可以并存，员工主动保存优先级更高

### 阶段 B：资产提取与结构化（Extraction）

目标：把候选片段转成可编辑的资产草稿。

输出对象：

- 资产草稿 `AssetDraft`

统一要抽出的结构：

1. 资产名称
2. 一句话价值描述
3. 适用场景
4. 输入说明
5. 输出说明
6. 标签 / 领域
7. 预期效果
8. 依赖内容
9. 来源血缘
10. 运行时定义

其中：

- 员工端只看业务描述
- 系统端保留运行时定义
- 企业端默认看业务视图，按权限查看部分技术视图

### 阶段 C：个人孵化（Personal Incubation）

目标：让员工先把碎片打磨成“可复用个人资产”。

业务动作：

1. 保存草稿
2. 自动补全
3. 多版本编辑
4. 加示例
5. 加边界条件
6. 绑定到机器人继续试用

阶段出口标准：

1. 至少有明确名称与描述
2. 至少有一个适用场景
3. 至少经过一次真实使用验证
4. 能被当前员工稳定复用

### 阶段 D：小组共享与共创（Team Sharing）

目标：把个人资产变成团队资产。

业务动作：

1. 共享到协作小组
2. 允许组内安装与试用
3. 收集团队内反馈
4. 观察复用人数与适配岗位

阶段出口标准：

1. 不只个人使用
2. 至少在一个小组内形成复用
3. 有明确使用反馈
4. 初步形成领域归属

### 阶段 E：企业标准化（Enterprise Standardization）

目标：把“有人在用”变成“企业可推广资产”。

业务动作：

1. 企业审核
2. 业务领域归类
3. 权限范围定义
4. 质量补全
5. 风险检查
6. 生命周期评级
7. 企业级命名规范与描述规范
8. 形成企业版本

阶段出口标准：

1. 元数据完整
2. 权限范围清晰
3. 质量可验证
4. 可以向部门 / 角色 / 全员推广

### 阶段 F：企业孵化与推广（Enterprise Incubation & Adoption）

目标：筛出高潜资产，扩大应用，验证推广效果。

业务动作：

1. 候选池检测
2. 多维评分
3. 晋升决策
4. 安装推荐
5. 使用监控
6. 效果追踪
7. 退化预警

这一阶段不是“做审批”，而是做 **企业内部市场验证**。

它的核心问题是：

1. 这个资产能不能跨团队稳定复用
2. 推广后效果是否持续
3. 是否值得升级为企业标准资产或平台标准资产

### 阶段 G：平台标准化与上架（Platform Standardization）

目标：把企业高价值资产升级为平台可复用能力。

业务动作：

1. 企业发起提案
2. 平台审核
3. 平台规范补齐
4. 分发策略配置
5. 市场上架
6. 版本发布

阶段出口标准：

1. 跨企业通用
2. 描述与交付规范完整
3. 风险与分发边界明确
4. 可被市场发现、安装、升级、下架

### 阶段 H：反馈回流与再孵化（Feedback Loop）

目标：让推广应用结果重新回到资产演进体系。

反馈来源：

1. 安装率
2. 启用率
3. 留存率
4. 成功率
5. 复用广度
6. 用户评分 / 评价
7. 失败原因
8. 替代资产出现情况

反馈结果：

1. 升级版本
2. 修订说明
3. 调整适用范围
4. 重新孵化
5. 退役

---

## 6. 资产类型建议：从“能力”扩展到“统一资产模型”

当前代码中的主资产载体是 `skill / capability`。为了实现你的目标，建议保留现有能力模型，但在上层引入统一资产分类。

建议的一级资产类型：

1. `agent`
2. `workflow`
3. `template`
4. `prompt`
5. `knowledge`
6. `capability`

建议的设计原则：

1. **生命周期统一**
   - 不同资产类型走同一条孵化、标准化、推广链路
2. **标准化规则分型**
   - 不同资产类型有不同的补全项与质量门槛
3. **运行时定义隔离**
   - 员工端、企业端、平台端默认看业务视图，不直接暴露底层运行结构

建议的二层模型：

1. **Asset Business View**
   - 名称、简介、场景、价值、标签、适用范围、可信度、成熟度
2. **Asset Runtime View**
   - prompt、workflow、toolchain、memory、routing、provider、kb source、template params 等

这与当前 `EmployeeSkillProfile + SkillRuntimeDefinition` 的思路是一致的，属于延续，不是推翻。

---

## 7. 基于现状的关键差距

### 7.1 资产类型还是单一的

当前存储模型基本围绕 `skill` 展开，见 `src/gateway/skill-lifecycle-store.ts:114`。  
它能承载一部分 prompt / workflow / tool 相关定义，但在业务上仍然只被当成“技能/能力”。

问题：

1. agent、workflow、template、prompt、knowledge 不是一等公民
2. 标准化规则无法按资产类型差异化
3. 平台市场也只能以“能力”视角分发

### 7.2 命名与端点存在双轨并存

当前同时存在：

1. `skill-lifecycle.*`
2. `personal-skills.*`
3. `robot-skills.*`
4. `employee-capability.*`
5. `enterprise-capability.*`
6. `capabilities.governance.*`

这说明系统正在从“skill 模型”向“capability 模型”演进，但还没有完全收口。

业务风险：

1. 同一动作在不同命名空间下重复存在
2. 个人资产、员工能力、企业能力、平台能力之间的语义映射不够显式
3. 前端设计文档与后端真实可用接口有不一致风险

### 7.3 员工市场推荐链路有接口不一致风险

设计文档里多次写明复用 `skill-recommendations.list`，见 `.kiro/specs/capability-lifecycle-closure/requirements.md:134`。  
但当前后端已明确实现的是 `employee-capability.recommendations`，见 `src/gateway/server-methods/employee-capability.ts:533`。  
同时前端推荐控制器又在请求 `skill-recommendations.list`，见 `ui/src/ui/controllers/skill-recommendations.ts:109`。

这意味着：

1. 设计契约与实现契约并未完全统一
2. 员工市场回流链路虽然方向正确，但接口收口还不彻底

### 7.4 企业孵化中心评分仍是“近似估算”

当前孵化中心实现中：

1. `departmentCount` 近似等于机器人数量，见 `src/gateway/server-methods/incubation.ts:130`
2. `employeeCount` 近似等于机器人数量，见 `src/gateway/server-methods/incubation.ts:167`
3. `employeeSatisfaction` 目前恒为 `null`，见 `src/gateway/server-methods/incubation.ts:186`
4. `newThisMonth` 和 `platformApprovedCount` 也还是简化值，见 `src/gateway/server-methods/incubation.ts:262`

所以当前孵化中心更像“可运行原型”，还不是企业级评分引擎。

### 7.5 企业上行与平台治理之间是“弱桥接”，不是统一状态机

> **已解决（Path Unification, 2026-07）**：孤儿旁路 `upstream.*`（写 `incubation-store` upload-report、状态永不推进）已删除；平台上行统一走脱敏提交通路 `enterprise-capability.submit-to-platform` → `platform-capability.enterprise-submissions/review/publish` → `registerCapability()` 落治理注册表，孵化中心上报追踪改读 `enterprise-capability.platform-submissions`。此外 `enterprise-capability.certify` / `promote-to-standard` 已从「只校验」升级为持久化「企业认证 / 企业标准」授予（`manualMaturityGrant`）。下文为修订前的现状记录。

当前：

- `enterprise-capability.promote-to-standard` 更多是在做资格校验，见 `src/gateway/server-methods/enterprise-capability.ts:1225`
- `enterprise-capability.certify` 也主要是能力等级准入校验，见 `src/gateway/server-methods/enterprise-capability.ts:1200`
- 真正的平台提案与注册仍在 `capabilities.governance.*`

这会导致一个业务问题：

**企业上报成功 ≠ 平台提案真正落地到注册表生命周期。**

也就是说，平台标准化在业务上已经存在，在系统状态机上还没有完全串成一条主线。

### 7.6 知识库、模版、Agent 还缺少专属标准化规则

当前能力标准化主要围绕：

1. 名称
2. 描述
3. 使用场景
4. 标签
5. 成熟度
6. 健康状态

但如果是：

- `knowledge`
- `prompt`
- `template`
- `workflow`
- `agent`

还需要各自额外的结构化标准。例如：

- knowledge 需要来源、时效、权限、知识切片策略
- template 需要参数槽位、渲染约束、示例
- workflow 需要步骤定义、失败处理、依赖工具
- agent 需要职责边界、协作方式、记忆策略、评估指标

---

## 8. 面向实现的统一业务模型建议

建议新增一个统一概念：

### 8.1 `Asset`

字段建议：

1. `assetId`
2. `assetType`
3. `businessProfile`
4. `runtimeSpec`
5. `lineage`
6. `owner`
7. `scope`
8. `lifecycle`
9. `maturity`
10. `health`
11. `qualityChecklist`
12. `distribution`
13. `version`

### 8.2 `AssetType`

枚举建议：

1. `capability`
2. `agent`
3. `workflow`
4. `template`
5. `prompt`
6. `knowledge`

### 8.3 `AssetLifecycle`

统一状态建议：

1. `discovered`
2. `draft`
3. `enriched`
4. `shared`
5. `enterprise_reviewing`
6. `enterprise_published`
7. `enterprise_certified`
8. `enterprise_standard`
9. `platform_proposed`
10. `platform_reviewing`
11. `platform_published`
12. `deprecated`
13. `retired`

### 8.4 `AssetLineage`

必须保留：

1. 来源员工
2. 来源机器人
3. 来源会话 / 任务
4. 来源资产
5. 生成时间
6. 被哪些资产引用

这是后续“贡献归因、质量追责、回滚、再训练、合规审计”的基础。

---

## 9. 三端协同的实现策略

### 9.1 员工端：做“资产生成与个人孵化工作台”

员工端不应该只是“保存技能”，而应扩展成“资产发现与整理工作台”。

建议新增能力：

1. 资产候选收件箱
2. 按资产类型保存
3. 草稿补全助手
4. 资产版本记录
5. 资产血缘查看
6. 一键共享 / 一键提交企业

但仍然要保留当前的员工语言策略：

1. 不暴露 workflow / routing / provider 等技术术语
2. 员工看到的是“机器人会做什么”“可复用做法”“知识材料”“标准模版”

### 9.2 企业端：做“资产标准化与推广中台”

企业端的重点不是简单收录，而是三件事：

1. 标准化
2. 推广应用
3. 复盘治理

建议企业端未来按两个面板协同：

1. **资产中心**
   - 看资产库存、质量、分类、权限、版本
2. **推广中心**
   - 看安装、启用、效果、覆盖面、退化风险

当前 `enterprise-capability-asset-library` 与 `enterprise-capability-usage-management` 已经有这个雏形，后面应该逐步统一到“资产视角”，而不是只用“能力视角”。

### 9.3 平台端：做“能力市场与平台治理中心”

平台端要承担的不是企业内管理，而是：

1. 跨企业标准化
2. 审核与准入
3. 市场分发
4. 生态运营

建议平台侧围绕当前 `capabilities.governance.*` 继续扩展：

1. 提案审核流
2. 资产注册表
3. 分发策略
4. 市场陈列
5. 跨企业反馈数据

---

## 10. 推荐的落地顺序

### 第一阶段：统一模型，不推翻现有链路

目标：先把现在这几套模型在概念层收口。

建议做法：

1. 明确 `skill / capability / asset` 三者关系
2. 在规格层新增统一资产模型
3. 定义资产类型枚举与统一生命周期状态
4. 把员工端、企业端、平台端的状态映射整理出来

这是最重要的第一步，否则后面越做越分叉。

### 第二阶段：把员工端“能力沉淀”升级为“资产沉淀”

目标：让员工端从“保存一个能力”变成“保存一种资产”。

优先做：

1. 资产候选提取分类
2. 多类型草稿保存
3. 统一资产详情页
4. 提交企业的标准化入口

### 第三阶段：把企业孵化中心升级为“资产孵化中心”

目标：企业孵化对象不再局限于 capability。

优先做：

1. 候选池支持多资产类型
2. 分类型评分规则
3. 分类型质量检查表
4. 统一推广与效果追踪

### 第四阶段：打通企业上行与平台治理状态机

目标：消除“企业上报”和“平台治理”之间的断层。

优先做：

1. 企业上报动作直接生成平台 proposal
2. proposal 状态同步回企业资产
3. 平台批准后直接生成 registry entry
4. 企业与员工两侧收到统一的生命周期回流

### 第五阶段：构建平台市场反馈回路

目标：让平台分发结果反向促进企业与员工资产演进。

优先做：

1. 安装率与启用率回传
2. 评分与评价回传
3. 失败原因聚合
4. 资产迭代建议

---

## 11. 结合当前代码现状的具体建议

### 11.1 先做契约统一

优先统一以下接口与命名：

1. `employee-capability.recommendations` 与 `skill-recommendations.list`
2. `personal-skills.submit` 与 `employee-capability.submit-to-enterprise`
3. `robot-skills.install` 与 `employee-capability.install-to-robot`

这一步不是大改逻辑，而是消除“文档说一套、实现跑一套”的风险。

### 11.2 保留“双层投影”原则，不要在 UI 暴露运行时细节

当前员工端和企业端都已经有对运行时字段的隔离理念，这是非常正确的，不应因为要支持更多资产类型而破坏。

要坚持：

1. 员工端只看业务价值
2. 企业端默认看业务视图
3. 平台治理端按权限看运行时定义

### 11.3 用现有 `skill-lifecycle-store` 作为统一资产存储的演进起点

不要新起一个完全平行的 `asset-store` 再慢慢迁移。  
更稳妥的做法是：

1. 先给现有 skill 模型补 `assetType`
2. 先从 capability / prompt / template 三类开始
3. 后续再逐步拓展 workflow / agent / knowledge

### 11.4 用现有 `capability-governance-store` 作为平台治理底座

平台端已经有：

1. proposal
2. registry
3. lifecycle
4. distribution

建议继续沿用，只是在 manifest 层支持更多资产类型，而不是重做一套平台市场存储。

### 11.5 把孵化评分的数据源从“近似值”升级为“真实组织数据”

当前评分可以继续作为占位逻辑，但要尽快升级：

1. 部门数不应再用机器人数量近似
2. 员工满意度要引入真实安装、启用、持续使用数据
3. 平台通过数与新增候选数要来自真实记录

否则企业孵化中心会停留在展示层，不足以支撑真正决策。

---

## 12. 结论

基于当前仓库现状，可以得出三个明确结论：

1. **底座已经有了**
   - 员工端已有个人资产沉淀
   - 企业端已有资产中心、孵化中心、使用治理
   - 平台端已有治理提案与注册表

2. **闭环骨架已经形成，但还没有统一成“多资产类型”的完整系统**
   - 现在主要还是 capability / skill 驱动
   - 还没有把 agent、workflow、template、prompt、knowledge 升级为同等资产对象

3. **最佳路径不是重做，而是在现有三端底座上做统一模型收口**
   - 先统一资产模型与状态机
   - 再把员工端从“能力沉淀”升级为“资产沉淀”
   - 再把企业端从“能力孵化”升级为“资产孵化”
   - 最后打通平台治理与市场分发反馈

换句话说，下一步最值得做的不是直接补 UI，而是先把：

- 资产类型
- 生命周期状态
- 三端映射关系
- 关键接口契约

这四件事定义清楚。

做完这一步，后面的实现才会真正稳。
