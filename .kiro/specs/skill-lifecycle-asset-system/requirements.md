# 需求文档：员工端技能生命周期与资产积累系统

## 简介

本系统为 OpenBot 员工端构建完整的技能生命周期与资产积累体系。核心理念是：员工端不是技能开发平台，而是员工与机器人协作的工作台。员工应感知到"我的机器人越来越会干活了"，而非"我在开发技能"。技能以"弱显性"方式存在——从机器人工作中自然涌现，而非手动创建。

技能在系统内部是"稳定工作能力单元"，承载了 Prompt、工具链、工作流、知识引用、输入输出规范、权限、记忆策略、观测指标等完整要素；但在员工端界面上，这些运行时要素全部被隐藏，员工只接触业务层语言：名称、使用场景、输入说明、输出说明、效果。因此技能在本系统中采取**双层结构**：员工业务层（EmployeeSkillProfile）与系统运行层（SkillRuntimeDefinition）严格分离。

系统分三个阶段实施：

- **Phase 1**：机器人能力标签页（以自然语言描述能力）、极简保存 + Draft 态、个人技能资产库（仅业务层字段）、Skill 双层结构数据模型、基础健康度展示。
- **Phase 2**：技能版本管理、完整分享流转、企业审核机制（安全 + 质量 + 适用范围）、技能依赖图展示。
- **Phase 3**：稳定模式自动检测、智能推荐、自动标准化增强、健康度自动修复建议。

## 术语表

- **Skill（技能）**：机器人在协作过程中形成的稳定工作能力单元，对员工以业务语言呈现，内部由系统运行层维护完整执行细节
- **EmployeeSkillProfile（员工业务层）**：员工可见、可编辑的技能业务描述，字段包括 id、name、summary、usageExamples、inputDescription、outputDescription、tags、category、avatar、visibility
- **SkillRuntimeDefinition（系统运行层）**：系统内部维护的技能执行定义，字段包括 prompts、workflow、tools、memoryStrategy、routingHints、dependencies、modelPreferences、executionPolicies，对员工不可见
- **SkillHealth（技能健康度）**：追踪技能运行健康状况的指标集合，字段包括 status（healthy/warning/broken）、successRate、avgLatency、lastVerifiedAt、failureReasons
- **SkillDependencyGraph（技能依赖图）**：技能被使用和依赖关系的汇总视图，字段包括 installedRobots、sharedGroups、dependentSkills、enterpriseConsumers
- **Robot_Capability_Tab（机器人能力标签页）**：机器人详情页中以自然语言描述展示"机器人会做什么"的标签页
- **Save_Skill_Modal（保存技能弹窗）**：系统检测到稳定能力模式后，引导员工极简保存技能的模态对话框
- **Personal_Skill_Library（个人技能资产库）**：系统设置中员工管理个人技能资产的页面
- **Skill_Source（技能来源）**：技能的产出渠道，包括平台预置、企业资产库、个人创建三种
- **Skill_Status（技能状态）**：技能在生命周期中的状态，枚举值为 `draft | private | reviewing | approved | published | deprecated | retired | rejected`
- **Skill_Draft（技能草稿）**：员工极简保存后尚未标准化完成的技能初始状态
- **Skill_Autofill（系统辅助标准化）**：系统根据草稿自动补全分类、标签、输入输出说明、使用场景、摘要的后台过程
- **Robot_Skill_Relation（机器人技能关联）**：机器人与技能之间的多对多关系，记录启用状态、版本、使用统计、健康度反馈通道
- **Stable_Pattern（稳定模式）**：系统检测到的重复性工作模式，包括重复操作、稳定 Prompt、固定工作流、相同工具链、稳定输入输出
- **Collaboration_Group（协作小组）**：员工之间的协作组织单元
- **Enterprise_Asset_Library（企业资产库）**：企业级技能共享与治理的资产库
- **Applicable_Scope（适用范围）**：企业审核通过后技能的可发现范围，枚举值为 `enterprise | department | group | role`
- **Review_Dimension（审核维度）**：企业审核时的评估维度，包括安全审查（敏感信息、危险工具、外部调用、权限风险）与质量评分（稳定性、成功率、复用价值、标准化程度）
- **Workbench（工作台）**：员工端的核心工作界面

## 需求

### 需求 1：机器人能力标签页（以自然语言描述呈现）

**用户故事：** 作为员工，我希望在机器人详情页看到"这个机器人会做什么"，以自然语言描述其能力，以便直观理解机器人的工作价值，而不需要理解版本、插件等技术概念。

#### 验收标准

1. WHEN 员工打开机器人详情页, THE Robot_Capability_Tab SHALL 以"机器人能力 / 会做什么"作为标签页标题出现在现有标签页序列中
2. THE Robot_Capability_Tab SHALL 以自然语言条目形式展示机器人已掌握的能力列表，每条记录的默认视觉仅包含：能力名称（EmployeeSkillProfile.name）、一句话描述（EmployeeSkillProfile.summary）、健康状态图标（SkillHealth.status）
3. THE Robot_Capability_Tab SHALL 在默认视图中隐藏版本号、升级提示、来源标签、技术元数据
4. WHEN 能力列表为空, THE Robot_Capability_Tab SHALL 展示空状态引导，使用面向员工的自然语言说明"能力将从机器人日常工作中自然积累"
5. WHEN 员工点击某条能力项, THE Robot_Capability_Tab SHALL 展开或进入详情视图，展示使用场景（usageExamples）、输入说明（inputDescription）、输出说明（outputDescription）、健康状态详情
6. THE Robot_Capability_Tab SHALL 将启用/禁用、升级版本、替换、移除操作作为二级操作入口（通过"更多"或折叠菜单触达），不作为能力列表的主视觉按钮
7. WHEN 员工通过二级菜单执行启用操作, THE Robot_Capability_Tab SHALL 将该能力状态切换为启用并立即生效
8. WHEN 员工通过二级菜单执行禁用操作, THE Robot_Capability_Tab SHALL 将该能力状态切换为禁用并立即停止该技能的调用
9. WHEN 员工通过二级菜单执行移除操作, THE Robot_Capability_Tab SHALL 解除该技能与当前机器人的 Robot_Skill_Relation，但保留技能本身在 Personal_Skill_Library 中
10. WHEN 机器人安装的技能有新版本可用, THE Robot_Capability_Tab SHALL 仅在详情视图中提示"有更新的版本可切换"，不在列表主视觉中展示升级角标

### 需求 2：极简保存与草稿态

**用户故事：** 作为员工，我希望保存技能的动作足够轻量，只需填写名称和一句话描述即可完成，以便在工作节奏中顺手完成，而不被复杂表单打断。

#### 验收标准

1. WHEN 系统检测到 Stable_Pattern, THE Save_Skill_Modal SHALL 向员工展示非侵入提示，措辞为"检测到一个可复用的能力，是否保存？"
2. WHEN 员工触发保存技能操作, THE Save_Skill_Modal SHALL 以极简表单呈现，默认仅包含两个必填字段：名称（name）、一句话描述（summary）
3. WHEN 员工完成极简表单并提交, THE Save_Skill_Modal SHALL 立即完成保存，技能 Skill_Status 初始化为 `draft`
4. WHEN 技能保存成功, THE Save_Skill_Modal SHALL 自动建立该技能与来源机器人的 Robot_Skill_Relation
5. THE Save_Skill_Modal SHALL 在极简表单中不展示工作流、工具链、输入输出结构、依赖项、推荐模型等运行层字段
6. THE Save_Skill_Modal SHALL 将"分享到协作小组"与"提交到企业资产库"作为次级操作入口提供，不与极简保存主按钮强耦合
7. WHEN 员工在极简保存后选择"继续完善"或稍后打开详情页, THE Personal_Skill_Library SHALL 允许员工补充 usageExamples、inputDescription、outputDescription、tags、category 等业务层字段
8. IF 技能保存失败, THEN THE Save_Skill_Modal SHALL 展示具体错误信息并保留用户已填写的表单数据

### 需求 3：个人技能资产库（仅展示业务层字段）

**用户故事：** 作为员工，我希望在系统设置中拥有一个个人技能资产库，以便集中管理、查看和复用我积累的技能，而无需接触系统运行层的技术细节。

#### 验收标准

1. THE Personal_Skill_Library SHALL 作为"系统设置 → 我的技能"入口提供访问，不作为顶级导航项
2. THE Personal_Skill_Library SHALL 以列表形式展示员工的所有技能，每条记录包含：名称（name）、一句话描述（summary）、来源机器人、使用次数、最近使用时间、状态（Skill_Status）、健康状态（SkillHealth.status）
3. THE Personal_Skill_Library SHALL 在列表视图中不展示版本号、Prompt、工作流、工具链等运行层字段
4. THE Personal_Skill_Library SHALL 提供按关键词搜索技能的功能
5. THE Personal_Skill_Library SHALL 提供按标签（tags）筛选技能的功能
6. THE Personal_Skill_Library SHALL 提供按分类（category）筛选技能的功能
7. WHEN 员工选择某个技能, THE Personal_Skill_Library SHALL 展示技能详情页，按 EmployeeSkillProfile 字段组织内容：名称、一句话描述、使用场景示例（usageExamples）、输入说明（inputDescription，自然语言）、输出说明（outputDescription，自然语言）、标签、分类、头像、来源机器人、已安装机器人列表、使用统计、健康状态详情
8. WHEN 员工在详情页执行编辑, THE Personal_Skill_Library SHALL 仅允许修改 EmployeeSkillProfile 的业务层字段，不暴露 SkillRuntimeDefinition 的任何字段
9. WHEN 员工查看技能详情, THE Personal_Skill_Library SHALL 在详情页独立区域展示当前版本号与版本历史入口，但不在列表页展示版本号
10. WHEN 员工执行编辑或删除操作, THE Personal_Skill_Library SHALL 先展示 SkillDependencyGraph 所反映的影响范围（参见需求 8）

### 需求 4：技能双层结构数据模型与关联关系

**用户故事：** 作为系统，我需要按照员工业务层与系统运行层分离的原则维护技能数据模型，并维护机器人与技能的多对多关联及健康度反馈通道，以便支持员工友好的 UI 呈现、资产治理、健康跟踪与企业审核。

#### 验收标准

1. THE Skill SHALL 由两层数据结构组成：EmployeeSkillProfile（员工业务层）与 SkillRuntimeDefinition（系统运行层），二者通过同一个技能 id 关联
2. THE EmployeeSkillProfile SHALL 至少包含字段：id、name、summary、usageExamples、inputDescription、outputDescription、tags、category、avatar、visibility
3. THE SkillRuntimeDefinition SHALL 至少包含字段：prompts、workflow、tools、memoryStrategy、routingHints、dependencies、modelPreferences、executionPolicies
4. THE Workbench SHALL 在所有员工端界面中仅读取和呈现 EmployeeSkillProfile 字段，不向员工输出 SkillRuntimeDefinition 字段
5. IF 任一员工端视图的渲染输入中包含 SkillRuntimeDefinition 字段, THEN THE Workbench SHALL 在数据适配层将该字段剥离，不得透传至 UI 渲染树
6. THE Robot_Skill_Relation SHALL 支持一个机器人关联多个技能的数据结构
7. THE Robot_Skill_Relation SHALL 支持一个技能被多个机器人安装的数据结构
8. THE Robot_Skill_Relation SHALL 记录每条关联的创建时间、启用状态、已安装版本、最近调用时间、累计使用次数
9. WHEN 技能被保存时, THE Robot_Skill_Relation SHALL 自动建立该技能与来源机器人的关联
10. WHEN 技能被安装到新机器人时, THE Robot_Skill_Relation SHALL 创建新的关联记录并初始化使用统计
11. WHEN 机器人完成一次技能调用, THE Robot_Skill_Relation SHALL 通过健康度反馈通道向该技能的 SkillHealth 回传本次调用的成功/失败、耗时、失败原因

### 需求 5：信息架构约束与术语黑名单

**用户故事：** 作为产品设计者，我需要确保技能系统的员工端信息架构与措辞严格符合员工视角，以便保持界面简洁、避免暴露任何工程师视角的运行层术语。

#### 验收标准

1. THE Workbench SHALL 保持现有主导航结构不变：机器人、协作小组、知识空间、系统设置
2. THE Workbench SHALL 仅通过两个入口暴露技能功能：机器人模块内部（Robot_Capability_Tab）、系统设置中的"我的技能"（Personal_Skill_Library）
3. THE Workbench SHALL 在所有员工端技能相关界面中禁止出现以下术语黑名单：`workflow`、`schema`、`toolchain`、`dependency`、`provider`、`model`、`routing`、`prompt`、`memory strategy`、`execution policy`、`capability governance`、`registry`、`asset lifecycle`、`OpenAI`、`Anthropic`、`模型路由`、`路由策略`
4. THE Workbench SHALL 在员工端技能相关界面中仅使用以下术语白名单：`能力`、`机器人会做什么`、`使用场景`、`输入说明`、`输出说明`、`效果`、`健康状态`、`使用次数`、`最近使用`、`更新记录`、`来源机器人`、`已装机器人`
5. THE Workbench SHALL 在技能相关界面的文案中采用面向员工的自然语言，描述"这个能力能做什么"与"在什么场景下使用"，而非工程师视角的"如何实现"
6. IF 员工端某界面必须展示版本、来源、已安装机器人等结构化信息, THEN THE Workbench SHALL 使用员工友好的措辞（例如"更新记录""来源机器人""已装机器人"），而不是原始字段名

### 需求 6：技能草稿态与系统辅助标准化

**用户故事：** 作为员工，我希望极简保存的技能能自动被系统补全基础描述信息，以便我不必一次性填完所有字段，而可以在后续逐步完善。

#### 验收标准

1. THE Skill_Status SHALL 支持 `draft` 状态作为极简保存后的初始状态
2. WHILE 技能处于 `draft` 状态, THE Workbench SHALL 标记技能为"草稿"，并在 Personal_Skill_Library 列表与详情页以明显标识提醒员工"尚未完成整理"
3. WHEN 技能进入 `draft` 状态, THE Skill_Autofill SHALL 异步启动系统辅助标准化流程
4. THE Skill_Autofill SHALL 基于来源机器人的工作上下文、历史会话与稳定模式，自动补全以下 EmployeeSkillProfile 字段的推荐值：category、tags、inputDescription、outputDescription、usageExamples、avatar，并对员工在极简保存时填写的 summary 生成更完整的精修建议
5. WHEN Skill_Autofill 完成推荐补全, THE Personal_Skill_Library SHALL 将补全结果作为"系统推荐"呈现给员工，员工可以一键接受、逐项调整或忽略，summary 的精修建议默认不覆盖员工原值，须员工确认后生效
6. WHEN 员工接受或修改推荐值并确认完成整理, THE Personal_Skill_Library SHALL 将技能 Skill_Status 从 `draft` 变更为 `private`
7. WHILE 技能处于 `draft` 状态, THE Workbench SHALL 允许该技能被来源机器人继续调用，但不得被分享到协作小组或提交到企业资产库
8. IF Skill_Autofill 无法生成任何推荐值, THEN THE Personal_Skill_Library SHALL 提示员工手动补充，并保持技能停留在 `draft` 状态

### 需求 7：技能健康度（SkillHealth）

**用户故事：** 作为员工，我希望了解每个技能当前是否还能正常工作，以便及时发现因 Prompt 老化、工具变更、API 失效、机器人升级或数据源变化导致的失效，避免资产库变成"僵尸技能仓库"。

#### 验收标准

1. THE Skill SHALL 关联一个 SkillHealth 记录，字段包括 status、successRate、avgLatency、lastVerifiedAt、failureReasons
2. THE SkillHealth.status SHALL 仅允许以下三级枚举值：`healthy`、`warning`、`broken`
3. WHEN 机器人完成一次技能调用, THE Robot_Skill_Relation SHALL 通过健康度反馈通道自动回传本次调用的成功/失败、耗时、失败原因，由系统更新对应 SkillHealth 的 successRate、avgLatency、lastVerifiedAt、failureReasons
4. WHEN successRate 在滑动窗口内低于预设阈值或出现连续多次失败, THE Workbench SHALL 将 SkillHealth.status 置为 `warning`
5. WHEN 技能在滑动窗口内连续调用全部失败或关键依赖已失效, THE Workbench SHALL 将 SkillHealth.status 置为 `broken`
6. THE Robot_Capability_Tab SHALL 在每条能力条目上以健康状态图标呈现 SkillHealth.status，措辞使用员工语言（例如"运行正常"、"偶尔出错"、"已失效"）
7. THE Personal_Skill_Library SHALL 在列表与详情页展示 SkillHealth.status、最近验证时间、常见失败原因（以员工语言表达），不直接暴露技术堆栈或错误码
8. IF SkillHealth.status 为 `broken`, THEN THE Personal_Skill_Library SHALL 在详情页提示员工"此能力暂时失效"，并引导查看失败原因

### 需求 8：技能依赖图（SkillDependencyGraph）

**用户故事：** 作为员工或企业管理员，我希望在修改或删除一个技能前，清楚看到这个技能被哪些机器人、哪些协作小组、哪些技能、哪些企业场景使用，以便避免改动影响到其他人的工作。

#### 验收标准

1. THE Skill SHALL 关联一个 SkillDependencyGraph 视图，字段包括 installedRobots、sharedGroups、dependentSkills、enterpriseConsumers
2. WHEN 员工在 Personal_Skill_Library 详情页触发编辑操作, THE Personal_Skill_Library SHALL 在进入编辑前展示 SkillDependencyGraph 摘要，说明本次编辑将影响的范围
3. WHEN 员工在 Personal_Skill_Library 详情页触发删除操作, THE Personal_Skill_Library SHALL 在确认删除前强制展示 SkillDependencyGraph，并要求员工二次确认
4. THE Personal_Skill_Library SHALL 支持员工从 SkillDependencyGraph 摘要中钻取查看具体实体，包括：已安装该技能的机器人列表、共享该技能的协作小组列表、依赖该技能的其他技能列表、企业端使用该技能的场景列表
5. THE Robot_Capability_Tab SHALL 在员工通过二级菜单执行"移除"操作前展示该技能在当前机器人上的使用影响提示
6. IF SkillDependencyGraph 中 installedRobots、sharedGroups、dependentSkills、enterpriseConsumers 全部为空, THEN THE Personal_Skill_Library SHALL 允许员工直接编辑或删除，不强制额外确认
7. THE SkillDependencyGraph SHALL 在技能被安装、共享、引用、企业发布、取消安装等事件发生时自动更新，保持与实际使用关系一致

### 需求 9：技能版本管理（Phase 2）

**用户故事：** 作为员工，我希望能够编辑技能并管理版本，以便持续优化技能的效果，同时对不同机器人保留选择使用哪个版本的能力。

#### 验收标准

1. WHEN 员工在 Personal_Skill_Library 详情页修改 EmployeeSkillProfile 字段并保存, THE Personal_Skill_Library SHALL 生成新的版本号并保存为独立版本
2. THE Personal_Skill_Library SHALL 在详情页的"更新记录"区域展示版本历史列表，包含版本号、修改时间、修改摘要
3. WHEN 员工选择历史版本, THE Personal_Skill_Library SHALL 展示该版本的 EmployeeSkillProfile 完整内容供查看与对比，不展示 SkillRuntimeDefinition
4. WHEN 机器人安装的技能有新版本可用, THE Robot_Capability_Tab SHALL 仅在能力详情视图中以员工语言提示"有更新的版本"，不在主列表展示版本角标
5. THE Robot_Capability_Tab SHALL 在二级操作入口中提供"切换到新版本"的操作项，替代"升级"术语

### 需求 10：企业审核机制与完整生命周期（Phase 2）

**用户故事：** 作为企业管理员与员工，我希望企业级技能发布流程具备完整生命周期、明确的安全与质量审核维度、可控的适用范围，以便让优秀技能真正复用到组织里，同时杜绝安全隐患与低质量资产。

#### 验收标准

1. THE Skill_Status SHALL 支持完整生命周期枚举值：`draft | private | reviewing | approved | published | deprecated | retired | rejected`
2. WHEN 员工对私有技能执行"分享到协作小组"操作, THE Personal_Skill_Library SHALL 使该技能对目标 Collaboration_Group 成员可见，并在 SkillDependencyGraph.sharedGroups 中登记
3. WHEN 员工对私有技能执行"提交到企业资产库"操作, THE Personal_Skill_Library SHALL 要求员工指定 Applicable_Scope（全企业 / 某部门 / 某协作组 / 某角色），随后将技能 Skill_Status 变更为 `reviewing`
4. THE Enterprise_Asset_Library SHALL 在审核流程中按以下 Review_Dimension 评估技能：
   - 安全审查：是否泄露敏感信息、是否使用危险工具、是否存在外部调用、是否存在权限风险
   - 质量评分：稳定性、成功率、复用价值、标准化程度
5. WHEN 审核通过, THE Enterprise_Asset_Library SHALL 将技能 Skill_Status 变更为 `approved`，等待发布动作
6. WHEN 技能由 `approved` 正式发布, THE Enterprise_Asset_Library SHALL 将 Skill_Status 变更为 `published`，并仅在指定的 Applicable_Scope 范围内对员工可发现、可安装
7. WHEN 审核被拒绝, THE Personal_Skill_Library SHALL 将 Skill_Status 变更为 `rejected`，并展示拒绝原因与改进建议
8. WHEN 企业管理员对已发布技能标记弃用, THE Enterprise_Asset_Library SHALL 将 Skill_Status 变更为 `deprecated`，并在 Robot_Capability_Tab 与 Personal_Skill_Library 中提示该技能即将下线
9. WHEN 企业管理员对技能执行下线操作, THE Enterprise_Asset_Library SHALL 将 Skill_Status 变更为 `retired`，该技能不再可被发现、安装或调用，但保留历史审计记录
10. THE Enterprise_Asset_Library SHALL 支持的合法状态流转路径为：`draft → private → reviewing → approved → published → deprecated → retired`，以及 `reviewing → rejected`；不在合法路径上的流转应被拒绝
11. IF 员工尝试将处于 `draft` 的技能直接提交到企业资产库, THEN THE Personal_Skill_Library SHALL 拒绝该操作并提示员工先完成整理

### 需求 11：自动技能提取（Phase 3）

**用户故事：** 作为员工，我希望系统能自动识别机器人工作中的稳定模式并建议保存为能力，以便无需手动发现和提取能力模式。

#### 验收标准

1. WHILE 机器人执行工作任务, THE Workbench SHALL 持续监测并识别 Stable_Pattern（重复工作模式、稳定 Prompt 使用、固定工作流执行、重复操作序列、相同工具链调用、稳定输入输出模式）
2. WHEN 系统识别到满足阈值的 Stable_Pattern, THE Workbench SHALL 生成能力保存建议并以非侵入方式通知员工
3. WHEN 员工确认建议, THE Save_Skill_Modal SHALL 按需求 2 的极简表单方式呈现，技能直接进入 `draft` 状态并触发 Skill_Autofill
4. THE Workbench SHALL 在 Skill_Autofill 中增强自动标准化能力，优先复用同类技能的 tags、category、usageExamples 模式，减少员工手动调整

### 需求 12：技能智能推荐（Phase 3）

**用户故事：** 作为员工，我希望系统能根据机器人的工作场景推荐合适的能力，以便快速增强机器人的能力。

#### 验收标准

1. WHEN 员工浏览 Robot_Capability_Tab, THE Workbench SHALL 基于机器人当前工作场景和已有能力推荐可安装的相关技能
2. THE Workbench SHALL 从协作小组共享技能和 Enterprise_Asset_Library 中 Skill_Status 为 `published` 且 Applicable_Scope 覆盖当前员工的技能中筛选推荐候选
3. WHEN 员工选择安装推荐能力, THE Robot_Capability_Tab SHALL 建立 Robot_Skill_Relation 并将技能设置为启用状态

### 需求 13：健康度自动修复建议（Phase 3）

**用户故事：** 作为员工，我希望系统在技能出现健康问题时主动给出修复建议，以便持续提升机器人的工作质量。

#### 验收标准

1. WHEN SkillHealth.status 变更为 `warning` 或 `broken`, THE Personal_Skill_Library SHALL 在技能详情页展示面向员工的修复建议，措辞使用员工语言（例如"建议调整使用场景"、"建议更换输入方式"）
2. THE Personal_Skill_Library SHALL 在修复建议中基于 failureReasons 与历史健康轨迹提供具体改进方向，不直接展示原始错误堆栈或技术术语
3. WHEN 员工采纳建议并更新 EmployeeSkillProfile, THE Personal_Skill_Library SHALL 在下一次成功调用后自动更新 SkillHealth 指标并在达到健康阈值时将 status 恢复为 `healthy`
4. THE Personal_Skill_Library SHALL 支持技能自动分类与自动标签功能，根据技能内容和使用场景持续优化 tags 与 category 推荐
