# 需求文档：企业能力中心（Enterprise Capability Asset Library）

## 简介

企业能力中心是企业 AI 能力沉淀系统的**企业资产层**（Enterprise Asset Layer）模块，面向企业管理员。它是员工端能力沉淀体系（skill-lifecycle-asset-system）的管理侧对等物。

本模块的核心定位：**企业AI能力沉淀中心 · 由员工贡献，经企业审核，沉淀为可复用、可治理的企业能力资产**

关键约束：

- 企业能力资产**不可由平台直接创建**，唯一来源路径为：员工机器人工作 → 员工保存能力 → 形成个人能力 → 员工提交企业 → 企业审核 → 企业资产化
- 企业端**不暴露**任何运行时技术细节（prompt、workflow json、toolchain、model routing、provider、memory strategy）
- 企业端以**业务能力视图**组织信息，而非运行时视图
- **EnterpriseCapabilityProjection（企业能力投影）** 是核心架构原则：统一投影层剥离所有运行时字段，确保企业端仅看到业务能力视图。所有从后端到企业前端的数据流必须经过此投影层。

本模块遵循三层严格分离架构：

- 员工能力层（Employee Capability Layer）：已由 skill-lifecycle-asset-system spec 覆盖
- **企业资产层（Enterprise Asset Layer）**：本 spec 的交付对象
- 平台运行时层（Platform Runtime Layer）：未来 spec

**内部模块名**：`enterprise-capability-asset-library`（代码包名不变）
**UI 展示名**：企业能力中心

## 术语表

- **Enterprise_Capability_Center（企业能力中心）**：企业管理员侧的能力资产管理主界面 UI 展示名称，展示企业已审核通过并资产化的全部 AI 能力
- **Enterprise_Capability_Asset_Library（企业能力资产库）**：内部模块/包名称，代码层面的标识符
- **EnterpriseCapabilityProjection（企业能力投影）**：核心架构原则——统一投影层，剥离所有运行时字段（prompt、workflow json、toolchain、model routing、provider、memory strategy、execution policy、routing hints、model preferences），确保企业端仅暴露业务能力视图
- **EnterpriseCapabilityValueSummary（企业能力价值摘要）**：能力资产的业务价值概览数据，包含 monthlyExecutions（本月调用次数）、departmentCoverageCount（覆盖部门数）、reuseGrowthRate30d（近30天复用增长率），必须以业务语言展示
- **CapabilityDomain（能力领域）**：业务领域分组，如销售、HR、客服、财务、法务、数据分析，用于构建"企业能力版图"视图
- **Enterprise_Admin（企业管理员）**：拥有企业能力资产库管理权限的用户角色
- **Capability_Asset（能力资产）**：经过员工提交、企业审核后正式进入企业资产库的能力记录
- **Capability_Name（能力名称）**：能力的业务名称，如"招聘JD生成""客户投诉分类""销售周报整理""商机优先级判断"
- **Capability_Description（能力说明）**：描述该能力可以完成什么工作的自然语言文本
- **Usage_Scenario（使用场景）**：能力适用的业务场景标签，如销售、客服、HR、财务
- **Applicable_Target（适用对象）**：能力的发布覆盖范围，枚举为 `全企业 | 某部门 | 某协作小组 | 某角色`
- **Capability_Maturity（能力成熟度）**：能力资产的成熟度分级，枚举为 `初步形成 | 稳定使用 | 多人复用 | 企业认证 | 企业标准 | 核心资产`
- **Capability_Health_Status（能力健康状态）**：能力效果状况的业务语言标签，枚举为 `效果稳定 | 偶尔结果不理想 | 建议重新整理 | 已不适合继续推广`
- **Enterprise_Reuse_Data（企业复用数据）**：能力在企业内的复用统计，包含使用机器人数、使用员工数、覆盖部门数、增长趋势
- **Credibility_Indicators（可信度指标）**：能力资产的可信度证据，包含 verifiedDepartments（已验证使用部门列表）和 productionUsageDays（生产环境使用天数）
- **Source_Employee（来源员工）**：贡献该能力的员工
- **Source_Robot（来源机器人）**：能力最初形成时所在的机器人
- **Source_Task（来源任务）**：能力最初形成时对应的工作任务
- **Contribution_History（贡献历史）**：记录能力从员工端到企业端的完整贡献链路
- **Review_History（审核历史）**：记录能力经历的所有审核事件
- **Statistics_Dashboard（统计仪表盘）**：页面顶部的统计卡片区域，展示能力总数、已发布能力、覆盖员工数、覆盖机器人数、本月使用次数等关键指标
- **Capability_Install（能力安装）**：将企业能力资产安装到指定机器人的操作
- **Capability_Contribution_Record（能力贡献记录）**：记录员工向企业提交能力的完整历史
- **Install_Management（能力安装管理）**：管理已安装能力的分配与状态的功能入口
- **Quick_Entry_Sidebar（快捷入口侧边栏）**：页面左侧的快捷导航区域

## 需求

### 需求 1：数据来源约束与溯源完整性

**用户故事：** 作为企业管理员，我需要确保每个企业能力资产都有完整的来源链路，以便追溯能力形成过程并确保资产质量可控。

#### 验收标准

1. IF 能力资产未通过员工提交审核流程（即非经由员工端"提交到企业资产库"动作发起）, THEN THE Enterprise_Capability_Asset_Library SHALL 拒绝该创建操作并向调用方返回错误提示，说明仅接受员工提交路径
2. WHEN 能力资产进入企业资产库, THE Enterprise_Capability_Asset_Library SHALL 强制要求该资产包含完整溯源信息：Source_Employee（提交员工 ID + 姓名）、Source_Robot（来源机器人 ID + 名称）、Source_Task（来源任务 ID + 员工语言摘要）、Contribution_History（贡献记录列表，至少包含一条初始提交记录）、Review_History（审核记录列表，允许在提交阶段为空，进入 reviewing 后必须非空）
3. IF 能力资产的溯源信息不完整（Source_Employee、Source_Robot、Source_Task 任一为空，或 Contribution_History 为空列表）, THEN THE Enterprise_Capability_Asset_Library SHALL 拒绝该资产进入已发布状态，并向管理员展示提示信息说明哪些溯源字段缺失
4. WHEN 管理员查看能力资产详情页, THE Enterprise_Capability_Asset_Library SHALL 以独立区域展示完整溯源链路：来源员工姓名、来源机器人名称、来源任务摘要、贡献时间线（按时间正序排列）
5. WHEN 同一能力资产有多位员工贡献, THE Enterprise_Capability_Asset_Library SHALL 在 Contribution_History 中按时间正序记录每条贡献，每条记录包含：贡献员工（ID + 姓名）、贡献时间戳、贡献类型（初始提交 / 内容修改 / 场景补充）、贡献摘要（不超过 200 字的员工语言描述）
6. WHEN 溯源信息被写入能力资产记录后, THE Enterprise_Capability_Asset_Library SHALL 禁止对 Source_Employee、Source_Robot、Source_Task 及已有 Contribution_History 条目进行修改或删除，仅允许追加新的贡献记录

### 需求 2：企业能力中心主页面布局

**用户故事：** 作为企业管理员，我需要一个清晰的主页面来总览企业所有 AI 能力资产的状态，以便快速了解企业能力沉淀情况并进行管理操作。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 以"企业能力中心"作为页面标题，并在副标题展示"企业AI能力沉淀中心 · 由员工贡献，经企业审核，沉淀为可复用、可治理的企业能力资产"
2. THE Enterprise_Capability_Asset_Library SHALL 在页面头部右侧提供两个操作按钮："能力贡献记录"（次要样式）和"能力安装管理"（主要样式），点击后分别导航至对应的管理子页面
3. THE Enterprise_Capability_Asset_Library SHALL 将主页面划分为三屏优先级布局：第一屏为"企业能力概览"（能力概览卡片区），第二屏为"能力领域分布"（按 CapabilityDomain 聚合的领域视图），第三屏为"高价值能力卡片流"（高价值能力资产卡片），表格视图移至"查看全部能力"二级入口
4. THE Enterprise_Capability_Asset_Library SHALL 在第一屏"企业能力概览"区域以横向卡片行展示 Statistics_Dashboard，包含五个统计指标：能力总数、已发布能力、覆盖员工数、覆盖机器人数、本月使用次数，数值以整数形式展示并使用千位分隔符
5. WHILE Statistics_Dashboard 数据正在加载, THE Enterprise_Capability_Asset_Library SHALL 在每个统计卡片位置展示加载占位状态，直至数据返回或超时（10 秒）
6. WHEN Statistics_Dashboard 数据加载完成, THE Enterprise_Capability_Asset_Library SHALL 在每个统计卡片中展示当前数值与较上月同期的环比变化（增减数值或百分比），正增长配合向上箭头，负增长配合向下箭头，零变化不展示箭头
7. IF Statistics_Dashboard 数据加载失败或超时, THEN THE Enterprise_Capability_Asset_Library SHALL 在统计区域展示加载失败提示并提供重试操作入口
8. THE Enterprise_Capability_Asset_Library SHALL 在页面左侧提供 Quick_Entry_Sidebar，包含三个快捷入口：我的安装能力、我贡献的能力、能力安装管理，每个入口点击后导航至对应功能页面
9. THE Enterprise_Capability_Asset_Library SHALL 采用白色背景、蓝色主色调的企业管理后台视觉风格，通过布局结构与配色方案与员工端工作台形成明确视觉区分
10. THE Enterprise_Capability_Asset_Library SHALL 在第三屏"高价值能力卡片流"中以卡片形式展示成熟度为"企业认证"及以上的能力资产，每张卡片包含能力名称、EnterpriseCapabilityValueSummary（业务语言格式）、所属 CapabilityDomain 标签
11. THE Enterprise_Capability_Asset_Library SHALL 提供"查看全部能力"入口，点击后进入完整的能力资产表格视图（含筛选、排序、分页功能）

### 需求 3：能力资产列表与筛选

**用户故事：** 作为企业管理员，我需要通过多维度筛选快速定位目标能力资产，以便在资产规模扩大时仍能高效管理。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 提供关键词搜索功能，支持按能力名称或能力说明进行包含匹配（输入关键词为子串即命中），关键词最少 1 个字符即可触发搜索，搜索结果高亮匹配片段
2. THE Enterprise_Capability_Asset_Library SHALL 提供五个下拉筛选器：使用场景（默认"全部场景"）、适用对象（默认"全部对象"）、能力成熟度（默认"全部"）、健康状态（默认"全部状态"）、能力领域（默认"全部领域"）；多个筛选器之间为 AND 关系，即结果须同时满足所有已选条件
3. THE Enterprise_Capability_Asset_Library SHALL 提供"只看我可安装"开关，启用后仅展示当前管理员根据其角色与适用范围（ApplicableScope）有权安装的能力资产
4. THE Enterprise_Capability_Asset_Library SHALL 提供"重置"按钮，点击后将所有筛选器恢复为各自的"全部"默认选项、清空搜索关键词、关闭"只看我可安装"开关
5. WHEN 筛选条件变更, THE Enterprise_Capability_Asset_Library SHALL 在 500 毫秒内更新列表结果，无需手动触发搜索
6. THE Enterprise_Capability_Asset_Library SHALL 以分页表格形式展示能力资产列表，每页默认展示 10 条，支持切换为 20、50 条每页，并在底部展示总资产数量与页码导航
7. IF 当前筛选与搜索条件下无匹配结果, THEN THE Enterprise_Capability_Asset_Library SHALL 展示空状态提示，说明无匹配资产并建议调整筛选条件

### 需求 4：能力资产表格列定义

**用户故事：** 作为企业管理员，我需要在列表中一目了然地看到每个能力资产的关键业务信息，以便快速评估能力价值与状态。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 在表格中展示以下列：能力名称与说明、使用场景、适用对象、能力领域、能力成熟度、健康状态、企业复用数据、操作
2. THE Enterprise_Capability_Asset_Library SHALL 在"能力名称与说明"列中展示：能力图标、能力名称（最多显示 30 个字符，超出截断并以省略号结尾）、成熟度徽章、一句话描述（最多显示 50 个字符，超出截断并以省略号结尾）、来源员工信息（格式为"来源：员工姓名"）
3. THE Enterprise_Capability_Asset_Library SHALL 在"使用场景"列中以标签形式展示该能力适用的业务场景（如 HR招聘、客服管理、销售管理），最多展示 3 个标签，超出部分以"+N"形式折叠展示剩余数量
4. THE Enterprise_Capability_Asset_Library SHALL 在"适用对象"列中以图标加文字形式展示 ApplicableScope 覆盖范围（全企业、某部门名称、某协作组、某角色）
5. THE Enterprise_Capability_Asset_Library SHALL 在"能力领域"列中展示该能力所属的 CapabilityDomain 标签（如销售、HR、客服、财务、法务、数据分析）
6. THE Enterprise_Capability_Asset_Library SHALL 在"能力成熟度"列中以圆点指示器形式展示成熟度等级（1-6 个圆点），映射规则为：初步形成=1、稳定使用=2、多人复用=3、企业认证=4、企业标准=5、核心资产=6，填充圆点数量对应成熟度级别
7. THE Enterprise_Capability_Asset_Library SHALL 在"健康状态"列中以颜色编码徽章展示状态：效果稳定（绿色）、偶尔结果不理想（黄色）、建议重新整理（橙色）、已不适合继续推广（灰色）
8. THE Enterprise_Capability_Asset_Library SHALL 在"企业复用数据"列中以业务语言展示 EnterpriseCapabilityValueSummary：格式为"本月已被调用 N 次"、"已覆盖 N 个部门"、"近 30 天复用增长 +N%"，并附带近 30 天的迷你趋势折线图
9. WHILE 能力的 AssetLifecycle 为 published, THE Enterprise_Capability_Asset_Library SHALL 在"操作"列中提供"安装到机器人"按钮（蓝色主要样式）和"查看详情"链接
10. IF 能力的 AssetLifecycle 为 deprecated 或 retired, THEN THE Enterprise_Capability_Asset_Library SHALL 在"操作"列中展示"已停用"禁用状态标识，不提供安装操作
11. IF 能力列表为空, THEN THE Enterprise_Capability_Asset_Library SHALL 展示空状态占位提示，说明当前无能力资产

### 需求 5：能力成熟度计算与展示

**用户故事：** 作为企业管理员，我需要通过成熟度分级快速识别哪些能力已经成为企业核心资产，以便优先推广高价值能力。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 为每个能力资产计算 Capability_Maturity，分级为：初步形成（等级1）、稳定使用（等级2）、多人复用（等级3）、企业认证（等级4）、企业标准（等级5）、核心资产（等级6）；新进入企业资产库的能力初始等级为"初步形成"
2. THE Enterprise_Capability_Asset_Library SHALL 基于以下维度自动计算成熟度等级晋升：使用次数、使用人数、复用率（被不同机器人安装的比例）、成功率、企业采用率（覆盖部门或角色的比例），各维度均需满足对应等级的阈值条件方可晋升至下一等级
3. WHEN 能力资产的调用记录新增或成功率指标更新, THE Enterprise_Capability_Asset_Library SHALL 自动重新计算 Capability_Maturity 并更新展示
4. IF 能力资产的成功率或复用率持续下降且低于当前等级的维持阈值, THEN THE Enterprise_Capability_Asset_Library SHALL 将 Capability_Maturity 降级至符合当前数据的等级
5. THE Enterprise_Capability_Asset_Library SHALL 将 Capability_Maturity 作为企业资产库的核心排序指标，默认按成熟度从高到低排列；同等级内按 CapabilityReuseValueScore 从高到低排列
6. THE Enterprise_Capability_Asset_Library SHALL 在能力名称旁以徽章形式展示当前成熟度等级标签（如"多人复用""企业认证""企业标准"）
7. THE Enterprise_Capability_Asset_Library SHALL 在列表的成熟度列以 1-6 个圆点可视化展示等级，其中初步形成为 1 个圆点，核心资产为 6 个圆点
8. WHEN 企业管理员将能力标记为"企业认证", THE Enterprise_Capability_Asset_Library SHALL 将该能力的 Capability_Maturity 提升至"企业认证"等级；该等级需企业管理员主动授予，表示企业已审批认可该能力
9. IF 能力尚未达到"稳定使用"等级的自动计算条件（使用次数、成功率、使用人数均未达到等级2阈值）, THEN THE Enterprise_Capability_Asset_Library SHALL 拒绝企业管理员的"企业认证"标记操作并提示原因
10. WHEN 企业管理员将能力标记为"企业标准", THE Enterprise_Capability_Asset_Library SHALL 将该能力的 Capability_Maturity 提升至"企业标准"等级；该等级表示企业正在主动推广该能力的采用，前提条件为能力已达到"企业认证"等级

### 需求 6：能力健康状态管理

**用户故事：** 作为企业管理员，我需要清楚了解每个能力资产的效果状况，以便及时发现问题能力并采取治理措施。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 使用业务效果语言展示 Capability_Health_Status，枚举为：效果稳定、偶尔结果不理想、建议重新整理、已不适合继续推广
2. THE Enterprise_Capability_Asset_Library SHALL 在健康状态展示中不使用任何工程术语（如 healthy、warning、broken、error rate、latency、稳定运行、偶发异常）
3. WHEN 能力的运行时健康遥测数据发生变化（新的 SkillHealthTelemetry 事件到达或指标阈值被跨越）, THE Enterprise_Capability_Asset_Library SHALL 在 60 秒内通过投影映射自动更新 Capability_Health_Status，映射规则为：最近 24 小时窗口内成功率 ≥ 95% 且无连续失败 → 效果稳定；成功率 70%–94% 或存在间歇性失败但无连续 3 次以上失败 → 偶尔结果不理想；成功率 50%–69% 或存在已知可改进模式 → 建议重新整理；管理员主动标记或成功率 < 50% 或关键依赖持续不可用 → 已不适合继续推广
4. WHILE 能力的 Capability_Health_Status 为"已不适合继续推广", THE Enterprise_Capability_Asset_Library SHALL 在操作列展示"已停用"禁用按钮，阻止新的安装操作
5. WHEN Enterprise_Admin 将能力标记为"已不适合继续推广", THE Enterprise_Capability_Asset_Library SHALL 在 5 分钟内通知所有正在使用该能力的机器人（即 Robot_Skill_Relation 中存在活跃关联的机器人）所属员工，通过员工端展示"即将下线"提示
6. WHEN Enterprise_Admin 手动调整能力的 Capability_Health_Status 并提交调整原因（长度为 1–500 字符）, THE Enterprise_Capability_Asset_Library SHALL 记录调整操作（含操作人、调整前状态、调整后状态、调整原因、时间戳），且手动调整后的状态不被后续自动遥测映射覆盖，直到管理员主动解除手动锁定或重新启用自动映射
7. IF 能力尚无运行时健康遥测数据（新上架或从未被调用）, THEN THE Enterprise_Capability_Asset_Library SHALL 将其 Capability_Health_Status 默认展示为"效果稳定"并附加"暂无运行数据"标识

### 需求 7：企业复用数据与价值摘要展示

**用户故事：** 作为企业管理员，我需要直观了解每个能力在企业内的实际复用情况和业务价值，以便评估能力的推广价值和覆盖效果。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 为每个能力资产维护 EnterpriseCapabilityValueSummary，包含三个字段：monthlyExecutions（本月调用次数）、departmentCoverageCount（覆盖部门数）、reuseGrowthRate30d（近30天复用增长率百分比）
2. THE Enterprise_Capability_Asset_Library SHALL 在所有展示 EnterpriseCapabilityValueSummary 的界面中使用业务语言格式：monthlyExecutions 展示为"本月已被调用 N 次"（N 使用千位分隔符）、departmentCoverageCount 展示为"已覆盖 N 个部门"、reuseGrowthRate30d 展示为"近 30 天复用增长 +N%"（负增长展示为"-N%"）
3. THE Enterprise_Capability_Asset_Library SHALL 在任何界面中不以原始字段名或纯数字形式展示价值数据（禁止展示如"monthlyExecutions: 1284"或"1284"等非业务语言格式）
4. THE Enterprise_Capability_Asset_Library SHALL 为每个能力资产展示 Enterprise_Reuse_Data，包含四个维度：使用机器人数、使用员工数、覆盖部门数、近30天增长趋势
5. THE Enterprise_Capability_Asset_Library SHALL 在列表的复用数据列中附带迷你趋势折线图，展示近30天内按天聚合的使用量变化走势
6. THE Enterprise_Capability_Asset_Library SHALL 在复用数据列中展示与上一个30天周期对比的增长百分比（如 +12%），正增长使用绿色，负增长使用红色，零增长使用默认文本色
7. WHEN Enterprise_Admin 点击查看能力详情, THE Enterprise_Capability_Asset_Library SHALL 展示完整的复用数据面板，包含按部门分布的使用统计、近30天按天的使用趋势图、Top 10 使用机器人列表（按调用次数降序排列）
8. IF 能力资产尚无任何使用记录, THEN THE Enterprise_Capability_Asset_Library SHALL 在复用数据列展示"暂无使用数据"占位状态，趋势折线图与增长百分比不展示

### 需求 8：能力安装双路径机制（管理员推送 + 员工自主安装）

**用户故事：** 作为企业管理员，我需要将企业能力资产批量推送到指定机器人（"推"路径）；作为员工，我需要在自己机器人的能力推荐中看到企业认证能力并自主安装（"拉"路径），以便兼顾企业统一部署与员工个性化需求。

#### 验收标准

**发布与可见性（安装前提）**

1. WHEN 能力审核通过并指定 ApplicableScope, THE Enterprise_Capability_Asset_Library SHALL 将该能力对 ApplicableScope 范围内的所有员工可见，员工可在其机器人的能力推荐列表中看到该能力
2. THE Enterprise_Capability_Asset_Library SHALL 确保能力安装的前提条件为：AssetLifecycle = `published`；不满足此条件的能力不可被任何路径安装
3. IF 能力的 AssetLifecycle 为 `deprecated` 或 `retired`, THEN THE Enterprise_Capability_Asset_Library SHALL 禁止所有安装操作（管理员推送与员工自主安装均不可用），并展示提示说明该能力已不推荐使用或已下线

**路径一：管理员批量推送（企业端"安装到机器人"按钮）**

4. WHEN Enterprise_Admin 点击"安装到机器人"按钮, THE Enterprise_Capability_Asset_Library SHALL 展示机器人选择器，列出当前管理员有权管理的机器人，支持多选，单次最多选择 20 个机器人
5. THE Enterprise_Capability_Asset_Library SHALL 在机器人选择器中将已安装该能力的机器人标记为"已安装"并禁用其选择操作，禁止重复安装
6. WHEN Enterprise_Admin 确认安装, THE Enterprise_Capability_Asset_Library SHALL 为每个选中的目标机器人建立能力关联（Robot_Skill_Relation），并将能力设置为启用状态
7. WHEN 安装完成, THE Enterprise_Capability_Asset_Library SHALL 更新该能力的复用统计数据（使用机器人数按实际新增关联数累加），并向管理员展示安装结果摘要（成功数量与失败数量）
8. IF 安装过程中部分或全部机器人关联失败, THEN THE Enterprise_Capability_Asset_Library SHALL 展示失败机器人列表及错误提示，已成功的关联不受影响

**路径二：员工自主安装（员工端机器人能力推荐）**

9. WHEN 员工浏览 Robot_Capability_Tab, THE Workbench SHALL 在能力推荐区展示当前员工 ApplicableScope 范围内的已发布企业能力，员工可选择安装到当前机器人
10. WHEN 员工选择安装推荐能力, THE Workbench SHALL 建立该能力与当前机器人的关联（Robot_Skill_Relation），并将能力设置为启用状态
11. THE Workbench SHALL 在员工端安装操作中不暴露 AssetLifecycle、ApplicableScope 等企业层枚举，仅以"企业推荐能力"标签标识来源

**通用规则（两条路径共享）**

12. THE Enterprise_Capability_Asset_Library SHALL 确保能力安装的最终载体为具体机器人（一个或多个），不支持"安装到员工"或"安装到部门"等非机器人目标
13. WHEN 安装完成（无论哪条路径）, THE Enterprise_Capability_Asset_Library SHALL 记录安装事件到能力的操作日志，包含操作人、操作时间、目标机器人列表、安装来源（管理员推送 / 员工自主安装）、安装结果（成功/失败）
14. THE Enterprise_Capability_Asset_Library SHALL 在安装管理页面统一展示两条路径产生的所有安装关系，并标注安装来源（管理员推送 / 员工自主安装）

### 需求 9：能力安装管理

**用户故事：** 作为企业管理员，我需要集中管理已安装能力的分配情况，以便了解企业能力的部署全景并进行调整。

#### 验收标准

1. WHEN Enterprise_Admin 点击"能力安装管理"入口, THE Enterprise_Capability_Asset_Library SHALL 展示安装管理页面，以分页列表形式（每页最多 50 条）列出所有已安装的能力与对应机器人的关联关系，每条记录包含：能力名称、机器人名称、安装时间、安装来源（管理员推送 / 员工自主安装）、安装状态
2. THE Enterprise_Capability_Asset_Library SHALL 在安装管理页面支持按能力名称（模糊匹配）、机器人名称（模糊匹配）、安装时间范围、安装来源进行搜索和筛选，搜索输入最大长度为 100 个字符
3. THE Enterprise_Capability_Asset_Library SHALL 支持从安装管理页面卸载已安装的能力（解除能力与机器人的关联），无论安装来源为管理员推送还是员工自主安装
4. WHEN Enterprise_Admin 执行卸载操作, THE Enterprise_Capability_Asset_Library SHALL 要求二次确认并展示影响说明，包含：目标机器人名称、将失去的能力名称、当前该能力在该机器人上的调用状态、安装来源
5. IF 卸载操作执行失败, THEN THE Enterprise_Capability_Asset_Library SHALL 展示错误提示说明卸载未成功，保留原有安装关系不变
6. THE Enterprise_Capability_Asset_Library SHALL 在安装管理页面展示每个安装关系的状态，枚举为：`正常运行`（能力已启用且最近调用成功）、`已暂停`（能力被手动关闭调用）、`待更新`（平台侧存在新版本尚未同步）
7. THE Enterprise_Capability_Asset_Library SHALL 在安装管理页面提供按安装来源的统计摘要：管理员推送安装总数、员工自主安装总数

### 需求 10：能力贡献记录

**用户故事：** 作为企业管理员，我需要查看员工向企业提交能力的完整历史，以便了解能力贡献趋势并识别活跃贡献者。

#### 验收标准

1. WHEN Enterprise_Admin 点击"能力贡献记录"入口, THE Enterprise_Capability_Asset_Library SHALL 展示贡献记录页面，按提交时间倒序分页列出所有员工提交的能力，每页默认展示 20 条记录
2. THE Enterprise_Capability_Asset_Library SHALL 在贡献记录中展示：提交时间（精确到分钟，格式为 YYYY-MM-DD HH:mm）、提交员工（姓名）、能力名称、来源机器人（名称）、当前审核状态（业务语言标签）
3. THE Enterprise_Capability_Asset_Library SHALL 在贡献记录页面支持按员工、时间范围、审核状态进行筛选，筛选后结果仍按提交时间倒序排列
4. THE Enterprise_Capability_Asset_Library SHALL 在贡献记录中展示审核状态的业务语言标签：待审核、审核中、已通过、已拒绝、需修改；其中与 AssetLifecycle 的映射关系为：submitted → 待审核、reviewing → 审核中、approved/published → 已通过、rejected → 已拒绝、rejected 附带修改建议时 → 需修改
5. WHEN Enterprise_Admin 点击某条贡献记录, THE Enterprise_Capability_Asset_Library SHALL 跳转到对应能力的审核详情页
6. IF 贡献记录为空（尚无任何员工提交能力）, THEN THE Enterprise_Capability_Asset_Library SHALL 展示空状态提示，说明当前无贡献记录

### 需求 11：能力贡献绩效评价

**用户故事：** 作为企业管理员，我需要统计哪些员工贡献了更多高质量的能力资产，以便识别活跃贡献者、激励能力沉淀文化、为绩效评价提供数据支撑。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 提供"贡献绩效"分析视图，按员工维度聚合展示贡献数据
2. THE Enterprise_Capability_Asset_Library SHALL 为每位贡献员工计算以下指标：贡献能力总数、审核通过数、审核通过率、贡献能力的平均成熟度等级、贡献能力被复用的总机器人数、贡献能力被复用的总员工数、贡献能力的平均成功率
3. THE Enterprise_Capability_Asset_Library SHALL 支持按贡献数量、审核通过率、复用价值（贡献能力的总复用机器人数）对员工进行排序，默认按贡献数量降序排列
4. THE Enterprise_Capability_Asset_Library SHALL 支持按部门、时间范围（本周 / 本月 / 本季度 / 自定义）筛选贡献绩效数据
5. THE Enterprise_Capability_Asset_Library SHALL 展示贡献排行榜（Top 贡献者列表），每条记录包含：员工姓名、所属部门、贡献能力数、审核通过数、贡献能力被复用总次数
6. THE Enterprise_Capability_Asset_Library SHALL 在贡献排行榜中区分"数量贡献"与"质量贡献"两个维度：数量贡献按提交总数排序，质量贡献按贡献能力的平均成熟度与复用价值综合排序
7. WHEN Enterprise_Admin 点击某位员工的贡献详情, THE Enterprise_Capability_Asset_Library SHALL 展示该员工贡献的所有能力列表，包含每个能力的名称、提交时间、当前成熟度、当前复用数据、审核状态
8. THE Enterprise_Capability_Asset_Library SHALL 支持导出贡献绩效数据为报表（CSV 格式），包含员工姓名、部门、各项贡献指标，供企业绩效评价体系使用
9. THE Enterprise_Capability_Asset_Library SHALL 在统计仪表盘区域提供"本月活跃贡献者"快捷入口，展示本月贡献数量 Top 5 员工

### 需求 12：企业端信息边界约束与 EnterpriseCapabilityProjection

**用户故事：** 作为产品架构师，我需要确保企业能力中心严格遵守业务能力视图，通过 EnterpriseCapabilityProjection 统一投影层剥离所有运行时技术细节。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 通过 EnterpriseCapabilityProjection 投影层处理所有从后端到企业前端的数据流，确保在所有企业管理员可访问的界面（列表页、详情页、搜索结果、导出视图）中不展示以下运行时字段：prompt、workflow json、toolchain、model routing、provider、memory strategy、execution policy、routing hints、model preferences
2. THE Enterprise_Capability_Asset_Library SHALL 仅展示业务能力视图信息：能力名称、能力说明、使用场景、适用对象、能力领域（CapabilityDomain）、能力成熟度（CapabilityMaturity 枚举标签）、健康状态（业务效果语言标签）、企业复用数据（使用员工数、使用机器人数、复用率百分比、覆盖部门数）、价值摘要（EnterpriseCapabilityValueSummary，业务语言格式）
3. THE Enterprise_Capability_Asset_Library SHALL 在能力详情页不提供"查看运行时配置""查看 Prompt""查看工作流""查看模型路由""查看执行策略"等任何直接暴露平台运行时层数据的操作入口
4. THE Enterprise_Capability_Asset_Library SHALL 在所有界面中使用以下业务语言描述能力状态：已提交 → 对应 submitted、审核中 → 对应 reviewing、已通过 → 对应 approved、已发布 → 对应 published、即将下线 → 对应 deprecated、已下线 → 对应 retired；不使用 healthy、warning、broken 等内部枚举原文，健康状态统一使用"效果稳定 / 偶尔结果不理想 / 建议重新整理 / 已不适合继续推广"
5. IF 企业管理员需要了解能力的技术实现细节, THEN THE Enterprise_Capability_Asset_Library SHALL 在能力详情页提供明确的跳转链接（标注为"前往平台治理台查看技术详情"），跳转至平台运行时层的独立治理台，不在本模块内内嵌或展开任何运行时技术信息
6. IF Enterprise_Capability_Asset_Library 的 API 响应中包含运行时层字段, THEN THE EnterpriseCapabilityProjection SHALL 在数据投影层过滤这些字段，确保不透传至企业管理员界面的渲染树
7. FOR ALL EnterpriseCapabilityAsset 对象经过 EnterpriseCapabilityProjection 处理后, THE Enterprise_Capability_Asset_Library SHALL 保证输出中不包含任何运行时字段，且此属性可通过属性测试（Projection Property Test）验证：对任意包含运行时字段的输入，投影输出的字段集合与运行时字段集合的交集为空

### 需求 13：能力资产详情页

**用户故事：** 作为企业管理员，我需要查看单个能力资产的完整信息，以便进行深入评估和管理决策。

#### 验收标准

1. WHEN Enterprise_Admin 点击"查看详情", THE Enterprise_Capability_Asset_Library SHALL 展示能力资产详情页，包含以下区域：基本信息、价值摘要、可信度指标、溯源信息、复用数据、审核历史、安装记录
2. THE Enterprise_Capability_Asset_Library SHALL 在基本信息区展示：能力名称、能力说明、使用场景标签、适用对象、能力领域（CapabilityDomain）、能力成熟度、健康状态、创建时间、最近更新时间
3. THE Enterprise_Capability_Asset_Library SHALL 在价值摘要区以业务语言展示 EnterpriseCapabilityValueSummary："本月已被调用 N 次"、"已覆盖 N 个部门"、"近 30 天复用增长 +N%"
4. THE Enterprise_Capability_Asset_Library SHALL 在可信度指标区展示 Credibility_Indicators：verifiedDepartments（已验证使用部门列表，展示为"已在以下部门验证使用：部门A、部门B、部门C"）和 productionUsageDays（生产环境使用天数，展示为"已在生产环境稳定运行 N 天"）
5. THE Enterprise_Capability_Asset_Library SHALL 在溯源信息区展示：来源员工列表（支持多人，展示员工姓名与贡献时间）、来源机器人、来源任务描述、贡献时间线（按时间倒序展示每次能力沉淀、编辑、共享、提交审核等关键事件）
6. THE Enterprise_Capability_Asset_Library SHALL 在复用数据区展示 Enterprise_Reuse_Data：使用机器人列表、使用员工统计（总人数与活跃人数）、部门分布图、使用趋势图（默认展示最近 30 天，支持切换为 7 天 / 90 天 / 180 天）
7. THE Enterprise_Capability_Asset_Library SHALL 在审核历史区按时间倒序展示所有审核事件：审核时间、审核人、审核结果、审核意见
8. THE Enterprise_Capability_Asset_Library SHALL 在安装记录区按安装时间倒序展示该能力已安装到的所有机器人列表，每条记录包含机器人名称与安装时间
9. IF 详情页某区域数据为空, THEN THE Enterprise_Capability_Asset_Library SHALL 在该区域展示对应的空状态说明（例如审核历史区展示"暂无审核记录"、安装记录区展示"暂未安装到任何机器人"）
10. IF 详情页数据加载失败, THEN THE Enterprise_Capability_Asset_Library SHALL 展示错误提示并提供重试操作入口，已加载成功的区域保持展示

### 需求 14：能力审核流程（企业管理员操作）

**用户故事：** 作为企业管理员，我需要对员工提交的能力进行安全与质量审核，以便确保进入企业资产库的能力符合企业标准。

#### 验收标准

1. WHEN 员工提交能力到企业资产库, THE Enterprise_Capability_Asset_Library SHALL 在待审核队列中创建审核任务，队列按提交时间先后排序展示
2. THE Enterprise_Capability_Asset_Library SHALL 在审核界面展示能力的业务信息：名称、一句话描述（summary）、使用场景（usageExamples）、来源员工、来源机器人、来源任务摘要、使用次数、使用机器人数、最近使用时间
3. THE Enterprise_Capability_Asset_Library SHALL 支持审核结果为三种：通过、拒绝、需修改
4. WHEN Enterprise_Admin 审核通过, THE Enterprise_Capability_Asset_Library SHALL 要求指定 ApplicableScope（全企业 / 某部门 / 某协作小组 / 某角色）和 CapabilityDomain（能力领域）后将能力发布为企业资产，并以员工语言通知提交员工审核已通过
5. WHEN Enterprise_Admin 审核拒绝或标记为需修改, THE Enterprise_Capability_Asset_Library SHALL 要求填写至少 10 个字符的审核意见，并以员工语言通知提交员工（含审核意见内容）
6. WHILE 能力处于审核中状态, THE Enterprise_Capability_Asset_Library SHALL 按以下维度向审核人展示评估信息：安全性（是否涉及敏感信息、是否包含危险操作、是否存在外部调用、是否存在权限风险）、质量（近 30 天成功率、使用机器人数、复用员工数、是否符合企业能力命名与描述规范）
7. THE Enterprise_Capability_Asset_Library SHALL 记录 Review_History，每条记录包含：审核时间、审核人 ID、审核人名称、审核结果（通过/拒绝/需修改）、审核意见
8. WHEN Enterprise_Admin 标记能力为需修改且员工收到通知后, THE Enterprise_Capability_Asset_Library SHALL 允许员工修改能力后重新提交，重新提交后创建新的审核任务进入待审核队列
9. IF 同一能力已有审核任务处于待审核状态时员工再次提交, THEN THE Enterprise_Capability_Asset_Library SHALL 拒绝重复提交并提示员工当前已有审核任务进行中

### 需求 15：统计仪表盘数据

**用户故事：** 作为企业管理员，我需要通过关键指标快速了解企业能力资产的整体状况和增长趋势。

#### 验收标准

1. THE Statistics_Dashboard SHALL 展示五个核心指标卡片：能力总数、已发布能力数、覆盖员工数、覆盖机器人数、本月使用次数
2. THE Statistics_Dashboard SHALL 为每个指标展示环比变化：能力总数展示较上周增减数值，已发布能力数展示较上周增减数值，覆盖员工数展示较上月增减百分比，覆盖机器人数展示较上周增减数值，本月使用次数展示较上月增减百分比
3. THE Statistics_Dashboard SHALL 对正增长使用向上箭头（↑）标识，对负增长使用向下箭头（↓）标识，对零增长不展示箭头仅显示"持平"文本
4. WHEN 页面加载时, THE Statistics_Dashboard SHALL 在 3 秒内从后端获取最新统计数据并渲染完成
5. IF 统计数据加载失败, THEN THE Statistics_Dashboard SHALL 展示上次缓存数据并标注"数据更新时间：YYYY-MM-DD HH:mm"
6. IF 统计数据加载失败且无缓存数据可用, THEN THE Statistics_Dashboard SHALL 在各指标卡片位置展示"暂无数据"占位状态并提供手动刷新操作入口

### 需求 16：快捷入口侧边栏

**用户故事：** 作为企业管理员，我需要快捷入口来快速访问常用功能，以便提升日常管理效率。

#### 验收标准

1. THE Quick_Entry_Sidebar SHALL 在页面左侧固定展示，包含三个快捷入口：我的安装能力、我贡献的能力、能力安装管理；页面加载时默认选中"我的安装能力"入口
2. WHEN Enterprise_Admin 点击"我的安装能力", THE Quick_Entry_Sidebar SHALL 筛选主内容区域的能力列表，仅展示当前管理员已安装到其管理机器人的能力
3. WHEN Enterprise_Admin 点击"我贡献的能力", THE Quick_Entry_Sidebar SHALL 筛选主内容区域的能力列表，仅展示当前管理员作为来源员工贡献的能力
4. WHEN Enterprise_Admin 点击"能力安装管理", THE Quick_Entry_Sidebar SHALL 跳转到能力安装管理页面
5. THE Quick_Entry_Sidebar SHALL 在当前激活的入口项上展示视觉高亮状态，且同一时刻仅有一个入口项处于激活态
6. IF "我的安装能力"或"我贡献的能力"筛选结果为空, THEN THE Quick_Entry_Sidebar SHALL 在主内容区域展示空状态提示，说明当前筛选条件下无匹配能力

### 需求 17：分页与数据加载

**用户故事：** 作为企业管理员，我需要在大量能力资产中流畅浏览，以便在资产规模增长后仍能高效操作。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 在列表底部展示分页控件，包含：总资产数量文本（如"共 128 项能力资产"）、页码导航、每页条数选择器
2. THE Enterprise_Capability_Asset_Library SHALL 支持每页条数切换：10条/页、20条/页、50条/页，默认每页条数为 10 条
3. WHEN 页码或每页条数变更, THE Enterprise_Capability_Asset_Library SHALL 在 5 秒内重新加载对应页数据并保持当前筛选条件与排序状态不变
4. WHEN 每页条数增大导致当前页码超出总页数, THE Enterprise_Capability_Asset_Library SHALL 自动跳转至最后一页并加载该页数据
5. WHILE 数据加载中, THE Enterprise_Capability_Asset_Library SHALL 在 200 毫秒后展示加载状态指示器（骨架屏或加载动画），不展示空白页面
6. IF 数据加载超过 10 秒未返回结果, THEN THE Enterprise_Capability_Asset_Library SHALL 展示加载失败提示并提供重试操作入口
7. IF 筛选结果为空, THEN THE Enterprise_Capability_Asset_Library SHALL 展示空状态提示，包含说明文案指示用户调整筛选条件

### 需求 18：UI 视觉规范与技术栈

**用户故事：** 作为前端开发者，我需要明确的视觉规范和技术约束，以便实现与设计稿一致的企业管理后台界面。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 使用 React + TypeScript + Tailwind CSS 技术栈实现
2. THE Enterprise_Capability_Asset_Library SHALL 采用白色背景、蓝色主色调的企业管理后台浅色主题
3. THE Enterprise_Capability_Asset_Library SHALL 确保表格、筛选器、按钮、徽章、卡片等组件遵循统一的设计语言，具体表现为：所有同类组件使用相同的圆角半径、间距比例、字体层级（不超过 4 级）、颜色 Token，且同一类型组件在不同页面中视觉表现一致
4. WHILE 视口宽度大于等于 1280px, THE Enterprise_Capability_Asset_Library SHALL 完整展示表格所有列且无水平滚动条
5. WHILE 视口宽度小于 1280px, THE Enterprise_Capability_Asset_Library SHALL 对表格区域提供水平滚动，确保所有列内容可通过滚动访问
6. THE Enterprise_Capability_Asset_Library SHALL 确保所有交互元素（按钮、链接、筛选器）在 hover 状态下产生至少一项可观察的视觉变化（背景色、边框色、文字色或透明度），且在 active 状态下产生与 hover 状态可区分的进一步视觉变化
7. THE Enterprise_Capability_Asset_Library SHALL 确保颜色编码的健康状态徽章同时提供文字标签，不仅依赖颜色传达信息（无障碍合规）
8. THE Enterprise_Capability_Asset_Library SHALL 确保所有可点击交互元素的最小点击区域不小于 32×32 像素

### 需求 19：能力领域（CapabilityDomain）与企业能力版图

**用户故事：** 作为企业管理员，我需要按业务领域查看企业能力的分布情况，以便了解哪些业务领域已有充分的 AI 能力覆盖，哪些领域仍有空白。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 定义 CapabilityDomain 枚举，包含以下业务领域：销售、HR、客服、财务、法务、数据分析，并支持企业管理员扩展自定义领域
2. THE Enterprise_Capability_Asset_Library SHALL 为每个能力资产关联一个 CapabilityDomain，在审核通过时由管理员指定
3. THE Enterprise_Capability_Asset_Library SHALL 在主页面第二屏提供"能力领域分布"视图，按 CapabilityDomain 聚合展示每个领域下的能力数量、代表性能力名称（最多展示 3 个）、领域覆盖率
4. WHEN Enterprise_Admin 点击某个 CapabilityDomain 卡片, THE Enterprise_Capability_Asset_Library SHALL 筛选能力列表仅展示该领域下的所有能力资产
5. THE Enterprise_Capability_Asset_Library SHALL 在"能力领域分布"视图中展示领域聚合示例：销售 → 商机评分、客户分类、周报整理；HR → JD生成、面试总结；客服 → 投诉分类、话术推荐
6. THE Enterprise_Capability_Asset_Library SHALL 支持在筛选栏中按 CapabilityDomain 筛选能力资产
7. IF 某个 CapabilityDomain 下尚无任何能力资产, THEN THE Enterprise_Capability_Asset_Library SHALL 在该领域卡片中展示"暂无能力"占位状态

### 需求 20：可信度指标（Credibility Indicators）

**用户故事：** 作为企业管理员，我需要了解每个能力资产在真实业务场景中的验证情况，以便判断该能力是否值得进一步推广。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 为每个能力资产维护 Credibility_Indicators，包含两个字段：verifiedDepartments（已验证使用部门列表，类型为 string[]）和 productionUsageDays（生产环境使用天数，类型为 number）
2. THE Enterprise_Capability_Asset_Library SHALL 在能力详情页的可信度指标区展示：verifiedDepartments 以"已在以下部门验证使用：部门A、部门B、部门C"格式展示，productionUsageDays 以"已在生产环境稳定运行 N 天"格式展示
3. THE Enterprise_Capability_Asset_Library SHALL 基于实际安装关系和调用记录自动更新 Credibility_Indicators：当某部门的机器人成功调用该能力超过 7 天，该部门自动加入 verifiedDepartments；productionUsageDays 从首次成功调用日期开始累计
4. IF 能力资产尚无任何验证记录, THEN THE Enterprise_Capability_Asset_Library SHALL 在可信度指标区展示"暂无验证数据"占位状态
5. THE Enterprise_Capability_Asset_Library SHALL 在高价值能力卡片流中展示 Credibility_Indicators 摘要（如"已在 3 个部门验证，运行 45 天"），帮助管理员快速判断能力可信度

### 需求 21：EnterpriseCapabilityProjection 投影属性测试

**用户故事：** 作为开发者，我需要确保 EnterpriseCapabilityProjection 投影层的正确性可通过属性测试验证，以便在任何代码变更后自动检测投影层是否泄露运行时字段。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 提供 Projection Property Test，验证：对任意包含运行时字段的 EnterpriseCapabilityAsset 输入，经过 EnterpriseCapabilityProjection 处理后的输出字段集合与运行时字段集合（prompt、workflow json、toolchain、model routing、provider、memory strategy、execution policy、routing hints、model preferences）的交集为空
2. THE Enterprise_Capability_Asset_Library SHALL 确保 Projection Property Test 覆盖以下场景：输入包含全部运行时字段、输入包含部分运行时字段、输入不包含运行时字段、输入包含嵌套对象中的运行时字段
3. THE Enterprise_Capability_Asset_Library SHALL 将 Projection Property Test 作为 CI 必须通过的测试，任何导致投影层泄露运行时字段的代码变更将被阻止合并

### 需求 22：属性测试范围界定

**用户故事：** 作为开发者，我需要明确哪些逻辑适合属性测试、哪些适合单元/快照测试，以便降低测试维护成本并保持测试有效性。

#### 验收标准

1. THE Enterprise_Capability_Asset_Library SHALL 使用属性测试（Property-Based Testing）覆盖以下核心逻辑：生命周期状态机不变量、审核流程约束、可见性/投影层正确性（EnterpriseCapabilityProjection）、适用范围可见性规则、安装约束验证、成熟度状态机转换
2. THE Enterprise_Capability_Asset_Library SHALL 使用单元测试或快照测试覆盖以下展示逻辑：文本截断显示、标签溢出显示、增长指标显示格式、EnterpriseCapabilityValueSummary 业务语言格式化
3. THE Enterprise_Capability_Asset_Library SHALL 确保属性测试聚焦于"对任意有效输入都必须成立的不变量"，而非"特定输入产生特定输出"的示例验证
