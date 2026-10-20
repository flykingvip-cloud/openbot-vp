# 需求文档：能力生命周期闭环（Capability Lifecycle Closure）

## 简介

能力生命周期闭环系统是 OpenBot 企业能力体系的**闭环增长层**，补全从"企业资产沉淀"到"平台标准化"再到"员工能力市场"的完整循环路径。本模块解决三个核心问题：

1. **企业孵化中心**：企业内部能力资产如何通过候选池检测、评估评分、晋升决策、效果追踪形成标准化能力
2. **平台上行通道**：企业优质能力如何通过手动上报 + 提案审批流程晋升为平台标准能力
3. **员工能力市场**：员工如何在 Robot_Capability_Tab 内发现并安装来自平台的标准能力

关键约束：

- 通信协议使用 **Gateway RPC**（非 REST）
- 前端技术栈使用 **Lit**（非 React）
- 数据持久化使用 **File Store**（非 PostgreSQL）
- 复用已有端点：`enterprise-capability.promote-to-standard`、`enterprise-capability.certify`、`employee-capability.recommendations`
- 术语黑名单机制继续执行（员工端禁止暴露运行时术语）
- 候选池检测方式为**实时按需计算**（管理员打开页面时查询，非后台定时任务）

实施优先级：孵化中心 → 平台上行 → 能力市场

## 架构收口修订（Path Unification, 2026-07）

初版实现里"平台上行"曾有两条并行通路：孵化中心自带的 `upstream.*`（`upstream.submit/report-list/proposal-status/supplement`，写 `incubation-store` 的 upload-report）与真正落到治理注册表的脱敏提交通路。前者是**孤儿旁路**——不脱敏、不进注册表、状态永不推进。现已收口为**唯一可靠通路**：

1. **平台上行的唯一通路**：孵化中心「推荐上报平台」→ `enterprise-capability.sanitization-preview` → `sanitization-confirm`（脱敏产物）→ `enterprise-capability.submit-to-platform`（P0-5 脱敏门禁）→ `createEnterpriseSubmission`（共享提交库）→ 平台侧 `platform-capability.enterprise-submissions / review-enterprise-submission / publish-enterprise-capability`（或 reject / return-for-modification / approve-enterprise-only）→ `registerCapability()` 落治理注册表 → 员工市场回流。
2. **孵化中心的上报追踪**：改读 `enterprise-capability.platform-submissions`（按企业隔离读取真实 `EnterpriseSubmission` 状态），替代已删除的 `upstream.report-list`。
3. **已删除**：`upstream.submit/report-list/proposal-status/supplement` 端点、`incubation-store` 的 upload-report 类型与 CRUD、以及孤立视图 `upstream-report-form.ts` / `proposal-timeline.ts` / `incubation-center-page.ts` 与控制器 `proposal-status.ts`。
4. **企业标准化落库**：`enterprise-capability.certify` / `promote-to-standard` 不再仅做资格校验——通过后会把「企业认证 / 企业标准」授予持久化到治理注册表条目（`manualMaturityGrant`），作为成熟度的下限并反映到列表/详情投影。

下文 §5（平台上行）、§6（提案审批）、§11（端点契约）中涉及 `upstream.*` 与 `UploadReportRecord` 的描述以本节为准。

## 术语表

- **Incubation_Center（孵化中心）**：企业管理员侧的能力孵化管理界面，用于检测候选能力、评估评分、决策晋升、追踪效果
- **Candidate_Pool（候选池）**：满足晋升候选条件的企业能力资产集合，通过实时按需计算生成（管理员打开页面时查询）
- **Incubation_Score（孵化评分）**：对候选能力的多维度量化评估，包含复用广度、效果稳定性、业务覆盖度、员工满意度四个维度
- **Promotion_Decision（晋升决策）**：企业管理员对候选能力做出的晋升判定，结果为"推荐上报平台"或"继续孵化"或"不适合晋升"
- **Effect_Tracking（效果追踪）**：对已晋升能力在晋升后的持续效果监测，包含晋升前后对比数据
- **Platform_Upstream_Channel（平台上行通道）**：企业向平台上报优质能力的正式通道，包含手动上报与提案审批两个环节
- **Upload_Report（上报记录）**：企业管理员向平台提交能力上报的完整记录
- **Proposal（提案）**：平台侧对企业上报能力的审批单据，包含提案状态与审批意见
- **Employee_Capability_Marketplace（员工能力市场）**：嵌入 Robot_Capability_Tab 的"探索更多能力"入口，员工可浏览并安装平台标准能力
- **Platform_Standard_Capability（平台标准能力）**：经平台审批认证的标准化能力，可被所有企业的员工发现与安装
- **Enterprise_Admin（企业管理员）**：拥有企业能力管理权限的用户角色
- **Capability_Maturity（能力成熟度）**：能力资产的成熟度分级，枚举为初步形成、稳定使用、多人复用、企业认证、企业标准、核心资产
- **Robot_Capability_Tab（机器人能力标签页）**：机器人详情页中展示"机器人会做什么"的标签页
- **GatewayBrowserClient（网关浏览器客户端）**：前端与后端通信的 RPC 客户端
- **File_Store（文件存储）**：系统数据持久化层，基于文件系统实现

## 需求

### 需求 1：候选池实时按需检测

**用户故事：** 作为企业管理员，我希望打开孵化中心页面时系统自动计算并展示满足晋升候选条件的能力列表，以便我无需手动筛选即可发现高潜力能力。

#### 验收标准

1. WHEN Enterprise_Admin 打开 Incubation_Center 页面, THE Incubation_Center SHALL 向后端发起 Gateway RPC 请求实时计算 Candidate_Pool，不依赖后台定时任务或预计算缓存
2. THE Incubation_Center SHALL 基于以下条件筛选候选能力：Capability_Maturity 达到"企业认证"及以上、近 30 天月调用次数 ≥ 100、覆盖部门数 ≥ 2、成功率 ≥ 80%
3. WHEN Candidate_Pool 计算完成, THE Incubation_Center SHALL 以卡片列表形式展示候选能力，每张卡片包含能力名称、当前成熟度、近 30 天调用次数、覆盖部门数、成功率
4. WHILE Candidate_Pool 数据正在加载, THE Incubation_Center SHALL 展示加载骨架屏占位状态
5. IF Candidate_Pool 计算超时（10 秒未返回）, THEN THE Incubation_Center SHALL 展示加载失败提示并提供重试操作入口
6. IF Candidate_Pool 为空（无满足条件的能力）, THEN THE Incubation_Center SHALL 展示空状态提示，说明当前无满足晋升候选条件的能力并展示候选条件说明
7. THE Incubation_Center SHALL 支持按能力领域（CapabilityDomain）筛选候选池结果
8. THE Incubation_Center SHALL 默认按近 30 天调用次数降序排列候选能力列表

### 需求 2：孵化评分体系

**用户故事：** 作为企业管理员，我希望系统对每个候选能力提供多维度量化评分，以便我基于客观数据做出晋升决策而非主观判断。

#### 验收标准

1. THE Incubation_Center SHALL 为 Candidate_Pool 中每个能力计算 Incubation_Score，包含四个维度：复用广度（0-100）、效果稳定性（0-100）、业务覆盖度（0-100）、员工满意度（0-100）
2. THE Incubation_Center SHALL 按以下规则计算各维度分数：复用广度基于使用机器人数与使用员工数加权计算、效果稳定性基于近 30 天成功率与成功率波动幅度计算、业务覆盖度基于覆盖部门数与覆盖角色数计算、员工满意度基于员工主动安装率与持续使用天数计算
3. THE Incubation_Center SHALL 计算 Incubation_Score 综合分（四维度加权平均，权重为复用广度 30%、效果稳定性 30%、业务覆盖度 20%、员工满意度 20%）
4. THE Incubation_Center SHALL 在候选能力卡片中以雷达图形式展示四维度评分，并在雷达图下方展示综合分数值
5. THE Incubation_Center SHALL 支持按综合分降序排列候选能力列表
6. IF 某维度数据不足以计算评分（如员工满意度无数据）, THEN THE Incubation_Center SHALL 将该维度标记为"数据不足"并在综合分计算中排除该维度、重新分配权重至其余维度

### 需求 3：晋升决策与记录

**用户故事：** 作为企业管理员，我希望对候选能力做出明确的晋升决策并记录决策理由，以便形成可追溯的决策历史。

#### 验收标准

1. WHEN Enterprise_Admin 查看候选能力详情, THE Incubation_Center SHALL 提供三个决策按钮："推荐上报平台"（主要样式）、"继续孵化"（次要样式）、"不适合晋升"（警告样式）
2. WHEN Enterprise_Admin 选择"推荐上报平台", THE Incubation_Center SHALL 要求填写推荐理由（10-500 字符）并确认后将该能力标记为"待上报"状态
3. WHEN Enterprise_Admin 选择"继续孵化", THE Incubation_Center SHALL 要求填写孵化建议（10-500 字符），说明需要改进的方向
4. WHEN Enterprise_Admin 选择"不适合晋升", THE Incubation_Center SHALL 要求填写不适合原因（10-500 字符）
5. THE Incubation_Center SHALL 记录每次 Promotion_Decision，包含决策时间、决策人、决策结果、决策理由、决策时的 Incubation_Score 快照
6. WHEN Enterprise_Admin 查看候选能力详情, THE Incubation_Center SHALL 展示该能力的历史决策记录列表（按时间倒序）
7. THE Incubation_Center SHALL 允许对"继续孵化"状态的能力在后续满足条件时重新进入候选池并再次决策

### 需求 4：晋升效果追踪

**用户故事：** 作为企业管理员，我希望追踪已推荐上报能力在晋升后的效果变化，以便验证晋升决策的正确性并持续优化孵化标准。

#### 验收标准

1. WHEN 能力被标记为"待上报"或已完成平台上报, THE Incubation_Center SHALL 开始记录该能力的 Effect_Tracking 数据
2. THE Incubation_Center SHALL 在效果追踪面板展示晋升前后对比数据：晋升前 30 天平均调用次数 vs 晋升后 30 天平均调用次数、晋升前覆盖部门数 vs 晋升后覆盖部门数、晋升前成功率 vs 晋升后成功率
3. THE Incubation_Center SHALL 以折线图形式展示能力在晋升前后 60 天（前 30 天 + 后 30 天）的调用量趋势，晋升时间点以竖线标记
4. IF 晋升后 30 天内调用量或覆盖部门数下降超过 20%, THEN THE Incubation_Center SHALL 在效果追踪面板展示"效果下降"警告提示
5. THE Incubation_Center SHALL 提供"已上报能力"列表视图，展示所有已推荐上报的能力及其当前效果追踪状态
6. IF 能力晋升后数据不足 30 天, THEN THE Incubation_Center SHALL 展示已有天数的数据并标注"追踪中，数据将在 N 天后完整"

### 需求 5：平台上行通道 — 手动上报

**用户故事：** 作为企业管理员，我希望将经过孵化评估的优质能力正式上报到平台，以便该能力有机会成为平台标准能力供所有企业使用。

#### 验收标准

1. WHEN Enterprise_Admin 对"待上报"状态的能力点击"上报到平台", THE Platform_Upstream_Channel SHALL 展示上报表单，包含以下必填字段：能力名称、能力说明、适用场景描述（50-1000 字符）、预期受益企业类型、推荐理由
2. THE Platform_Upstream_Channel SHALL 在上报表单中自动填充来自企业能力资产库的已有信息（名称、说明、使用场景），Enterprise_Admin 可修改后提交
3. WHEN Enterprise_Admin 提交上报表单, THE Platform_Upstream_Channel SHALL 通过 Gateway RPC 调用 `enterprise-capability.promote-to-standard` 端点创建上报记录
4. WHEN 上报提交成功, THE Platform_Upstream_Channel SHALL 将能力状态更新为"已上报待审批"并向管理员展示提交成功提示，包含预计审批周期说明
5. THE Platform_Upstream_Channel SHALL 记录 Upload_Report，包含上报时间、上报人、能力 ID、上报时的 Incubation_Score 快照、上报表单内容
6. IF 上报提交失败（网络错误或后端拒绝）, THEN THE Platform_Upstream_Channel SHALL 展示错误提示并保留表单已填写内容，支持重新提交
7. IF 同一能力已有进行中的上报记录（状态为"已上报待审批"）, THEN THE Platform_Upstream_Channel SHALL 拒绝重复上报并提示管理员当前已有审批进行中
8. THE Platform_Upstream_Channel SHALL 在孵化中心页面提供"上报记录"入口，展示所有已上报能力的列表及其当前审批状态

### 需求 6：平台上行通道 — 提案审批

**用户故事：** 作为企业管理员，我希望追踪已上报能力在平台侧的审批进度，以便及时了解审批结果并做出后续安排。

#### 验收标准

1. THE Platform_Upstream_Channel SHALL 展示 Proposal 状态枚举：待审批、审批中、已通过、已拒绝、需补充材料
2. WHEN 平台侧审批状态变更, THE Platform_Upstream_Channel SHALL 在管理员下次打开上报记录页面时通过 Gateway RPC 查询最新状态并更新展示
3. THE Platform_Upstream_Channel SHALL 在上报记录列表中以颜色编码徽章展示审批状态：待审批（灰色）、审批中（蓝色）、已通过（绿色）、已拒绝（红色）、需补充材料（橙色）
4. WHEN Proposal 状态变更为"已通过", THE Platform_Upstream_Channel SHALL 在上报记录中展示"已晋升为平台标准能力"标识，并调用 `enterprise-capability.certify` 端点更新能力认证状态
5. WHEN Proposal 状态变更为"已拒绝", THE Platform_Upstream_Channel SHALL 展示平台审批意见，并允许管理员查看拒绝原因
6. WHEN Proposal 状态变更为"需补充材料", THE Platform_Upstream_Channel SHALL 展示平台要求的补充内容说明，并提供"补充材料"操作入口
7. WHEN Enterprise_Admin 提交补充材料, THE Platform_Upstream_Channel SHALL 通过 Gateway RPC 将补充内容发送至平台并将 Proposal 状态更新为"审批中"
8. THE Platform_Upstream_Channel SHALL 在上报记录详情页展示完整的审批时间线（按时间正序），包含每次状态变更的时间、操作方、备注

### 需求 7：员工能力市场 — 入口与浏览

**用户故事：** 作为员工，我希望在机器人能力标签页中发现并浏览平台标准能力，以便为我的机器人增加经过平台认证的高质量能力。

#### 验收标准

1. THE Robot_Capability_Tab SHALL 在能力列表下方提供"探索更多能力"入口按钮，点击后展开或跳转至 Employee_Capability_Marketplace 视图
2. THE Employee_Capability_Marketplace SHALL 通过 Gateway RPC 调用 `employee-capability.recommendations` 端点获取当前机器人可安装的聚合能力推荐列表
3. THE Employee_Capability_Marketplace SHALL 以卡片网格形式展示可安装能力，每张卡片包含：能力名称、一句话描述、使用场景标签（最多 3 个）、"平台认证"徽章、安装按钮
4. THE Employee_Capability_Marketplace SHALL 支持按使用场景标签筛选可安装能力
5. THE Employee_Capability_Marketplace SHALL 支持按能力名称关键词搜索（最少 1 个字符触发）
6. WHILE 能力列表数据正在加载, THE Employee_Capability_Marketplace SHALL 展示加载骨架屏占位状态
7. IF 可安装能力列表为空, THEN THE Employee_Capability_Marketplace SHALL 展示空状态提示，说明当前无可安装的平台标准能力
8. THE Employee_Capability_Marketplace SHALL 将已安装到当前机器人的能力标记为"已安装"并禁用其安装按钮
9. THE Employee_Capability_Marketplace SHALL 在所有界面中遵守术语黑名单约束，不展示 workflow、schema、toolchain、dependency、provider、model、routing、prompt 等运行时术语

### 需求 8：员工能力市场 — 安装与反馈

**用户故事：** 作为员工，我希望一键安装平台标准能力到我的机器人，并在安装后获得明确的反馈，以便快速增强机器人的工作能力。

#### 验收标准

1. WHEN 员工点击能力卡片的"安装"按钮, THE Employee_Capability_Marketplace SHALL 通过 Gateway RPC 建立该能力与当前机器人的 Robot_Skill_Relation 并将能力设置为启用状态
2. WHEN 安装成功, THE Employee_Capability_Marketplace SHALL 将该能力卡片状态更新为"已安装"、禁用安装按钮，并展示安装成功提示（持续 3 秒后自动消失）
3. WHEN 安装成功, THE Robot_Capability_Tab SHALL 在能力列表中立即展示新安装的能力条目（无需刷新页面）
4. IF 安装失败, THEN THE Employee_Capability_Marketplace SHALL 展示错误提示说明安装未成功，保留安装按钮为可点击状态以支持重试
5. THE Employee_Capability_Marketplace SHALL 在安装操作中不暴露 AssetLifecycle、ApplicableScope、CapabilityDomain 等企业层枚举，仅以"平台认证能力"标签标识来源
6. WHEN 安装完成, THE Employee_Capability_Marketplace SHALL 记录安装事件，包含操作人、操作时间、目标机器人、能力 ID、安装来源（员工能力市场）

### 需求 9：孵化中心页面布局

**用户故事：** 作为企业管理员，我希望孵化中心页面结构清晰、信息层次分明，以便高效完成候选能力的评估与决策工作。

#### 验收标准

1. THE Incubation_Center SHALL 以"企业能力孵化中心"作为页面标题，副标题展示"发现高潜力能力 · 评估孵化价值 · 推动平台标准化"
2. THE Incubation_Center SHALL 将页面划分为三个功能区域：候选池概览（顶部统计卡片）、候选能力列表（主体区域）、已上报能力追踪（底部或侧边入口）
3. THE Incubation_Center SHALL 在候选池概览区域展示四个统计卡片：当前候选能力数、本月新增候选数、已推荐上报数、平台已通过数
4. THE Incubation_Center SHALL 在候选能力列表区域提供筛选栏，包含能力领域筛选器和综合分排序切换
5. THE Incubation_Center SHALL 在页面右上角提供"上报记录"按钮，点击后导航至上报记录列表页面
6. THE Incubation_Center SHALL 采用与企业能力中心一致的视觉风格（白色背景、蓝色主色调），确保管理后台视觉统一

### 需求 10：数据持久化与文件存储约束

**用户故事：** 作为系统，我需要将孵化中心、上报记录、提案状态等数据持久化到 File Store，以便在系统重启后数据不丢失且符合项目技术约束。

#### 验收标准

1. THE Incubation_Center SHALL 将 Promotion_Decision 记录持久化到 File_Store，每条记录包含决策 ID、能力 ID、决策时间、决策人、决策结果、决策理由、Incubation_Score 快照
2. THE Platform_Upstream_Channel SHALL 将 Upload_Report 记录持久化到 File_Store，每条记录包含上报 ID、能力 ID、上报时间、上报人、上报表单内容、当前审批状态
3. THE Incubation_Center SHALL 将 Effect_Tracking 数据持久化到 File_Store，包含能力 ID、晋升时间点、每日调用量快照、每日覆盖部门数快照
4. THE Incubation_Center SHALL 确保所有持久化操作为原子写入（写入临时文件后重命名），避免写入中断导致数据损坏
5. IF File_Store 读取失败, THEN THE Incubation_Center SHALL 展示数据加载错误提示并提供重试操作入口，不展示部分损坏数据

### 需求 11：Gateway RPC 端点契约

**用户故事：** 作为开发者，我需要明确本模块所有 Gateway RPC 端点的请求与响应契约，以便前后端协同开发。

#### 验收标准

1. THE Incubation_Center SHALL 定义以下 Gateway RPC 端点：`incubation.candidate-pool`（计算候选池）、`incubation.score`（获取孵化评分）、`incubation.decide`（提交晋升决策）、`incubation.effect-tracking`（获取效果追踪数据）
2. THE Platform_Upstream_Channel SHALL 复用脱敏提交通路端点：`enterprise-capability.sanitization-preview` / `sanitization-confirm` / `submit-to-platform`（企业侧脱敏并提交）与 `platform-capability.enterprise-submissions` / `review-enterprise-submission` / `publish-enterprise-capability` / `reject-enterprise-capability` / `return-for-modification` / `approve-enterprise-only`（平台侧审核发布）；孵化中心的上报追踪读取 `enterprise-capability.platform-submissions`。（原 `upstream.proposal-status` / `upstream.supplement` 已删除，见「架构收口修订」。）
3. THE Employee_Capability_Marketplace SHALL 复用已有端点 `employee-capability.recommendations`（获取聚合推荐列表），不新增员工市场专用端点
4. THE Incubation_Center SHALL 确保所有新增 Gateway RPC 端点的请求与响应均使用 TypeScript 类型定义，并在 `endpoints.ts` 中导出类型对
5. IF Gateway RPC 请求超时（10 秒）, THEN THE GatewayBrowserClient SHALL 向调用方返回超时错误，由 UI 层展示重试提示

### 需求 12：术语黑名单与信息边界

**用户故事：** 作为产品架构师，我需要确保员工能力市场严格遵守术语黑名单约束，不向员工暴露任何运行时技术细节。

#### 验收标准

1. THE Employee_Capability_Marketplace SHALL 在所有员工可见界面中禁止出现以下术语：workflow、schema、toolchain、dependency、provider、model、routing、prompt、memory strategy、execution policy、capability governance、registry、asset lifecycle
2. THE Employee_Capability_Marketplace SHALL 仅使用以下术语白名单描述能力：能力、机器人会做什么、使用场景、效果、平台认证、已验证
3. THE Employee_Capability_Marketplace SHALL 对从 `employee-capability.recommendations` 端点返回的聚合推荐数据经过投影处理，剥离所有运行时字段后再渲染至 UI
4. IF 端点响应中包含运行时字段, THEN THE Employee_Capability_Marketplace SHALL 在数据适配层过滤这些字段，确保不透传至 UI 渲染树
5. THE Incubation_Center SHALL 作为企业管理员界面，允许展示 Capability_Maturity、CapabilityDomain、Incubation_Score 等企业层信息，但同样禁止展示 prompt、workflow json、toolchain、model routing 等运行时字段

### 需求 13：前端技术栈约束

**用户故事：** 作为前端开发者，我需要明确本模块的技术栈约束，以便实现与项目整体架构一致的前端组件。

#### 验收标准

1. THE Incubation_Center SHALL 使用 Lit（Web Components）+ TypeScript 技术栈实现所有 UI 组件
2. THE Employee_Capability_Marketplace SHALL 使用 Lit（Web Components）+ TypeScript 技术栈实现所有 UI 组件
3. THE Platform_Upstream_Channel SHALL 使用 Lit（Web Components）+ TypeScript 技术栈实现所有 UI 组件
4. THE Incubation_Center SHALL 复用项目已有的 Lit 组件库（如 health-badge、mini-trend-chart、asset-table grid 等），不引入新的 UI 框架或组件库
5. THE Employee_Capability_Marketplace SHALL 确保所有交互元素的最小点击区域不小于 32×32 像素
6. THE Incubation_Center SHALL 确保颜色编码的状态徽章同时提供文字标签，不仅依赖颜色传达信息（无障碍合规）

### 需求 14：模块间集成与导航

**用户故事：** 作为企业管理员，我希望孵化中心与企业能力中心、平台上行通道之间的导航流畅，以便在不同管理场景间快速切换。

#### 验收标准

1. THE Incubation_Center SHALL 在企业能力中心（Enterprise_Capability_Center）页面提供"孵化中心"导航入口
2. WHEN Enterprise_Admin 在孵化中心点击候选能力名称, THE Incubation_Center SHALL 支持跳转至该能力在企业能力中心的详情页
3. WHEN Enterprise_Admin 在孵化中心完成"推荐上报平台"决策, THE Incubation_Center SHALL 提供"立即上报"快捷入口，点击后直接进入上报表单并自动填充能力信息
4. THE Platform_Upstream_Channel SHALL 在上报记录详情页提供"查看能力详情"链接，跳转至企业能力中心对应能力详情页
5. THE Employee_Capability_Marketplace SHALL 在安装成功后提供"查看已安装能力"链接，跳转回 Robot_Capability_Tab 的能力列表
6. THE Incubation_Center SHALL 在效果追踪面板提供"查看平台审批状态"链接，跳转至上报记录详情页

### 需求 15：平台分发可见性开关

**用户故事：** 作为平台管理员，我希望为已发布能力配置“员工直达可见 / 企业审核后可见”的分发模式，以便在安全管控和快速触达之间灵活切换。

#### 验收标准

1. WHEN 平台管理员编辑能力分发策略时, THE Platform_Governance SHALL 提供分发可见性模式开关，至少包含 `enterprise_review_required` 和 `direct_employee_visible` 两种模式。
2. WHEN 分发可见性模式为 `direct_employee_visible`, THE Employee_Capability_Marketplace SHALL 在当前企业租户内直接展示该能力，无需企业管理员再执行 `enterprise-capability.push-to-positions` 二次推送。
3. WHEN 分发可见性模式为 `enterprise_review_required`, THE Enterprise_Capability_Center SHALL 继续仅对企业管理员可见，且 THE Employee_Capability_Marketplace SHALL 仅在企业二次推送后可见。
4. THE 分发可见性模式 SHALL 作为 `capabilities.governance.updateDistribution` 的持久化字段返回，并与 `tenantIds/defaultEnabled` 一并生效。
5. WHEN 同一能力同时命中平台直达可见和企业二次推送两条来源时, THE Employee_Capability_Marketplace SHALL 按 `capabilityId` 去重，仅展示一条推荐项，避免重复安装。
6. WHEN 平台管理员切换可见性模式, THE 下一次员工市场加载 SHALL 按最新模式重新计算可见结果，不依赖手工刷新企业侧推送动作。
