# 需求文档：员工 AI 电子档案（Seat-bound AI Profile）

## 简介

员工 AI 电子档案是企业端「组织与数字人」模块的核心详情面：以岗位 `seatId` 为稳定主键，在空岗壳上随任命、激活、使用与交接逐步生长为「岗位上的人 + 岗位数字能力与资产」的合体时间线。

本规格冻结产品定义、信息架构、完善度与投影原则；激活发信链路沿用现有 platform-auth，不新建平行档案写库。

关键约束：

- 档案主键 = **`seatId`**；人员是绑定层，不是资产宿主（资产跟岗不跟人）
- 前端技术栈使用 **Lit**
- 档案页只读 `SeatAiArchiveReadModel`；写操作走现有 seat / provision / offer / handover API
- 与现有岗位详情入口同一路由（选中岗位即打开档案），禁止拆成多个无关后台页
- 通信与数据源复用企业端 read model、月度用量、运营身份、交接案等既有投影

## 术语表

- **SeatAiArchive（员工 AI 电子档案）**：以 `seatId` 为键的企业侧档案壳 + 可选 `employeeUserId` 人格层
- **ArchivePhase（档案阶段）**：`vacant_shell` | `pending_activation` | `occupied` | `handover`
- **ArchiveCompleteness（完善度）**：0–100 的单一顶部指标，按六分区加权
- **IdentitySection（身份与入职状态）**：岗位/成员/邮箱/激活态与发信操作区
- **DigitalSection（岗位数字人与运行时）**：roleCode、Agent、协作组、Token/成本
- **PermissionsSection（权限与能力清单）**：运营身份、数据能力、模型授权等只读聚合
- **SkillsSection（技能与工具图谱）**：已装 skills / 缺口占位
- **ContributionSection（资产与贡献）**：可继承资产、知识/员工资产贡献
- **TimelineSection（工作与衔接时间线）**：任命→激活→Bot→贡献→交接事件 + 活跃/工时
- **PositionSeat**：企业岗位责任主体（`vacant → assigned → occupied → handover_pending`）
- **EmployeeProvision**：待激活员工任命记录（`pending_activation`）

## 需求

### 需求 1：档案定义与主键

**用户故事：** 作为企业管理员，我希望每个岗位有一份可生长的 AI 电子档案，以便从空岗到在岗再到交接都能在同一详情面理解该岗位的人与数字能力。

#### 验收标准

1. THE SeatAiArchive SHALL 以 `seatId` 作为唯一稳定主键，SHALL NOT 以邮箱、岗位名称或 `employeeUserId` 作为主键
2. WHEN 岗位处于空岗且无待激活任命, THE SeatAiArchive SHALL 处于 `vacant_shell` 阶段；详情页仍展示全部六分区，其中除身份壳与 roleCode（数字人标签）外，其余分区 SHALL 以「待完善」占位展示，SHALL NOT 隐藏分区
3. WHEN 存在 pending employee provision 或 seat.status=`assigned`, THE SeatAiArchive SHALL 处于 `pending_activation` 阶段
4. WHEN seat.status=`occupied` 且无进行中交接, THE SeatAiArchive SHALL 处于 `occupied` 阶段
5. WHEN 存在**进行中** handover case（status ∈ `draft` | `asset_review` | `pending_approval` | `frozen`）, THE SeatAiArchive SHALL 处于 `handover` 阶段（可叠加展示在岗人格层）。`rebound` 表示继任绑定已完成、等待收尾；`completed` 为终态——二者 SHALL NOT 将档案阶段判为 `handover`
6. WHEN 人员交接完成（`completed`）或继任已绑定（`rebound`）, THE SeatAiArchive SHALL 保留岗位资产与能力图谱于 Seat，并对人格层（个人行为切片）执行归档/重置策略，SHALL NOT 把岗位资产迁移到离岗个人账户

### 需求 2：六分区信息架构

**用户故事：** 作为企业管理员，我希望岗位详情固定为六个分区，以便无论完善度高低都能用同一心智模型浏览与操作。

#### 验收标准

1. THE SeatAiArchive 详情页 SHALL 固定包含且仅按下列顺序展示六分区：身份与入职状态、岗位数字人与运行时、权限与能力清单、技能与工具图谱、资产与贡献、工作与衔接时间线
2. WHEN 某分区尚无数据, THE SeatAiArchive SHALL 显示「待完善」占位文案与下一步引导，SHALL NOT 隐藏该分区
3. THE 身份与入职状态分区 SHALL 展示：岗位名、部门路径、职责、预填/正式姓名、邮箱、Seat/组织状态、激活过期时间（若有）
4. THE 身份分区 SHALL 提供与阶段匹配的主操作：编辑资料、补邮箱/发送激活、重发激活、绑定成员、发起交接（在岗）、删除空岗
5. THE 岗位数字人分区 SHALL 展示：roleCode/数字人标签、默认与附属 Agent、协作组数、运行态、本月 Token/成本（无数据时占位）
6. THE 权限分区 SHALL 只读聚合运营身份与相关授权，并提供跳转治理入口（若有），SHALL NOT 在档案页内嵌完整策略编辑器
7. THE 技能分区 SHALL 列出已知 skills/工具或「待完善」；缺失能力可展示提示文案
8. THE 资产与贡献分区 SHALL 展示可继承资产摘要与贡献计数占位（深度投影可后置）
9. THE 时间线分区 SHALL 按时间顺序展示可知事件（任命、发信、激活、首个 Bot、交接等），无事件时显示空态

### 需求 3：三态差异（空岗 / 待激活 / 在岗）

**用户故事：** 作为企业管理员，我希望同一档案页在不同阶段突出不同操作，以免空岗与在岗操作混淆。

#### 验收标准

1. WHILE `vacant_shell`, THE 身份分区主 CTA SHALL 为「绑定成员 / 补邮箱并激活」；交接与更换成员 SHALL 禁用或隐藏
2. WHILE `pending_activation`, THE 身份分区主 CTA SHALL 为「发送/重发激活邮件」；邮箱与姓名 SHALL 可编辑后再次发信
3. WHILE `occupied`, THE 身份分区主 CTA SHALL 为「更换成员 / 发起交接」；激活发信 SHALL 不再作为主 CTA
4. WHILE `handover`, THE 档案 SHALL 在风险提示与时间线中展示交接状态与下一步动作
5. THE 档案页顶栏副标题 SHALL 展示「部门 · 阶段标签 · 完善度」

### 需求 4：完善度公式

**用户故事：** 作为企业管理员，我希望用单一完善度理解档案成熟度，而不是一堆徽章。

#### 验收标准

1. THE SeatAiArchive SHALL 在顶栏展示单一 `ArchiveCompleteness`（整数 0–100）
2. THE Completeness SHALL 按六分区加权求和并四舍五入取整；默认权重：身份 25、数字人 20、权限 15、技能 15、贡献 15、时间线 10（总和 100）
3. WHEN 某分区「已填充」条件满足, THE Completeness SHALL 计入该分区满分权重；否则计 0（分区内不做小数权重拆分，除非该分区定义了子条件）
4. THE 身份分区已填充条件 SHALL 为：有岗位名 + 有部门（非空且非「未分组」） +（有正式成员或有效待激活邮箱）；三者缺一不可
5. THE 数字人分区已填充条件 SHALL 为：有 roleCode 或至少一个 agentId
6. THE 权限分区已填充条件 SHALL 为：该 seat 至少一条运营身份 access 记录
7. THE 技能分区已填充条件 SHALL 为：至少一个已知 skill 投影（Phase 1 可恒为未填充占位）
8. THE 贡献分区已填充条件 SHALL 为：存在可继承资产摘要或贡献计数 > 0（Phase 1 可基于 agent/space 数量启发式）
9. THE 时间线分区已填充条件 SHALL 为：至少一条**有可靠来源**的投影事件（任命 pending、激活成员、Bot 绑定、待确认 offer、进行中交接等）；SHALL NOT 因「岗位存在」本身无条件记分；在创建时间等审计字段尚未进入 read model 前，空岗时间线允许未填充

### 需求 5：只读投影与写路径分离

**用户故事：** 作为开发者，我希望档案页不另建写库，以便与现有任命/激活/交接状态机保持一致。

#### 验收标准

1. THE UI SHALL 通过纯函数 `buildSeatAiArchiveReadModel`（或等价）从 EnterprisePortReadModel + 岗位行聚合生成档案读模型
2. THE SeatAiArchive SHALL NOT 引入独立 persistence schema 作为档案写源
3. WHEN 用户编辑岗位名/部门/职责, THE UI SHALL 调用现有 create/update seat API
4. WHEN 用户补邮箱并发激活, THE UI SHALL 调用现有 `/employee/provision` 或 `/employee/activation/send`
5. WHEN 用户发起交接/提醒 offer, THE UI SHALL 调用现有 organization handover / offer API

### 需求 6：与岗位激活闭环对齐

**用户故事：** 作为企业管理员，我希望添加岗位后即可在列表看到未激活岗位，并可从档案或列表批量发信。

#### 验收标准

1. WHEN 管理员创建岗位且未填邮箱, THE 系统 SHALL 将 seat 以 `vacant` 写入并出现在组织列表
2. THE 组织列表 SHALL 支持将「未激活」理解为 `VACANT`（无邮箱）∪ `PENDING_ACTIVATION`（Phase 2 列表多选发信；Phase 1 至少在档案身份区支持单岗发信）
3. WHEN 待激活邮箱有误, THE 管理员 SHALL 能在档案身份区更正资料并重发（Phase 1：通过既有编辑器/activation 模式入口完成，文案收口到档案）
4. THE 邀请激活弹层 SHALL 可继续作为批量快捷入口，但 SHALL NOT 是查看岗位详情的唯一路径
