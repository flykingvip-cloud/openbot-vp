# OpenBot 岗位资产管理定版方案与执行计划（2026-06-04）

## 文档定位

本文不是概念方案，而是面向专家团队评审后的定版执行文档。

目标有三件事：

1. 冻结当前已经确认正确的组织与资产模型。
2. 收缩当前不适合立即展开的复杂设计。
3. 给出可直接进入排期和开发的分阶段执行计划。

本文遵循专家反馈原则：

- 冻结正确部分
- 修正危险部分
- 延后复杂部分

## 专家已拍板规则

以下规则建议直接定版，不再反复讨论。

### 1. 所有权模型

1. 岗位（Seat）是企业资产宿主。
2. 资产跟岗位走，不跟员工走。
3. 继任本质是 `Seat Rebinding`，不是 `Asset Transfer`。

### 2. 组织模型

当前系统正式采用如下模型：

```text
EmployeeAccount
    ↓
SeatBinding
    ↓
PositionSeat
    ↓
SeatAssets
```

这个模型与当前代码自然演化出的结构一致，也是企业 SaaS 场景更稳定的治理方式。

### 3. 标识规则

`seatId` 是岗位交接、岗位继任、岗位确认、岗位资产继承的唯一业务标识。

禁止：

- 使用 `seatTitle`
- 使用岗位名称模糊匹配
- 使用岗位名称参与交接目标定位

`seatTitle` 仅用于显示，不用于业务定位。

### 4. 生命周期规则

Seat 生命周期必须正式冻结为状态机，而不是由不同开发在实现中自由理解。

正式状态机如下：

```text
vacant
  ↓
assigned
  ↓
occupied
  ↓
handover_pending
  ↓
vacant
```

特殊治理态：

- `frozen`

状态定义：

| 状态               | 含义                             |
| ------------------ | -------------------------------- |
| `vacant`           | 空岗，可被新任命                 |
| `assigned`         | 已发任命待接受，尚未正式入岗     |
| `occupied`         | 已有人且岗位生效中               |
| `handover_pending` | 原员工已离场，继任处理中         |
| `frozen`           | 人工冻结或治理冻结，禁止自动流转 |

冻结原则：

1. 发出岗位任命后，Seat 不应直接被视为 `occupied`。
2. 任命待接受阶段，Seat 应进入 `assigned`。
3. 只有接受完成后，Seat 才进入 `occupied`。
4. `frozen` 不属于主线业务流转态，而是治理干预态。

### 5. 注册与接岗规则

统一抽象为：

- `Seat Assignment`

分为两种交付方式：

1. `New Hire Assignment`
   - 新员工任命
   - 需要注册
2. `Internal Assignment`
   - 已注册员工任命
   - 无需注册，只需登录确认

因此产品和后台文案都应统一成：

- 发起岗位任命

而不是：

- 有时发激活码
- 有时发岗位确认邮件

### 6. Seat Assignment 实体规则

`Seat Assignment` 不应只停留在概念层，必须升级为独立业务实体。

建议新增正式实体：

- `SeatAssignment`

建议核心字段：

| 字段             | 说明                                                                        |
| ---------------- | --------------------------------------------------------------------------- |
| `assignmentId`   | 唯一任命 ID                                                                 |
| `seatId`         | 目标岗位 ID                                                                 |
| `employeeId`     | 目标员工 ID；未注册时可为空，改由 `targetEmail` 标识                        |
| `targetEmail`    | 任命目标邮箱                                                                |
| `assignmentType` | `new_hire` / `internal`                                                     |
| `status`         | `pending` / `accepted` / `declined` / `canceled` / `expired` / `superseded` |
| `expireAt`       | 过期时间                                                                    |
| `acceptedAt`     | 接受时间                                                                    |
| `createdBy`      | 发起人                                                                      |
| `handoverCaseId` | 若来自岗位交接，则关联 handover                                             |
| `inheritMode`    | `full` / `selective`                                                        |
| `assetSnapshot`  | 本次任命的资产快照                                                          |

冻结原则：

1. `Offer`、`Provision`、`Invitation` 在产品语义上统一归并为 `SeatAssignment`。
2. 现有实现可分阶段从多个内部对象收敛到同一实体，但对外产品语义必须统一。
3. 后续岗位历史、撤销、重发、审计都围绕 `assignmentId` 展开。

### 7. 凭证规则

1. 岗位默认资产可继承。
2. 凭证类资产不可无条件继承。
3. connector 需要区分“配置轮廓”与“个人凭证”。
4. 继任后：
   - `ConnectorProfile` 可继承
   - `ConnectorCredential` 必须重绑或重授权

### 8. Ownership 与 Permission 分离规则

这是治理冻结前必须明确的一条原则：

- `Seat Ownership` 负责资产归属
- `Permission` 负责资产访问

两者不能混用。

正式定义：

1. Seat 是资产宿主，不代表所有拿到权限的人都拥有该资产。
2. 一个员工可以临时拥有某岗位资产的执行权限，但不因此成为资产宿主。
3. 权限模型是下一阶段重点，不阻塞本轮上线，但必须在本轮文档中明确分层。

## 当前系统事实

以下不是目标设计，而是当前代码已经成立的真实事实。

### 1. 新员工注册后自动绑定岗位

当前员工注册流程要求员工提供：

- 邮箱
- 密码
- 激活码

注册成功后会立即绑定对应岗位。

相关代码：

- `src/gateway/platform-auth/routes-employee-register.ts`
- `src/gateway/platform-auth/routes-employee.ts`

### 2. 已注册员工只能通过岗位确认接岗

已注册员工不会再收到新的员工激活码。

当邮箱已注册时，后端会直接报：

- `PLATFORM_AUTH_EMAIL_EXISTS`

相关代码：

- `src/gateway/platform-auth/routes-employee.ts`

因此，已注册员工接手岗位只能走：

- 登录
- 接受岗位确认

相关代码：

- `src/gateway/platform-auth/routes-employee-register.ts`
- `src/gateway/enterprise-seat-assets.ts`

### 3. 资产当前已经是“岗位投影给员工”

当前员工在工作台里看到的：

- `defaultAgentId`
- `agentIds`
- `defaultSpaceIds`
- `memoryScopeIds`

都来自当前岗位或待确认岗位，不是直接来自员工私有资产。

相关代码：

- `src/gateway/enterprise-seat-assets-store.ts`

### 4. 离职交接已经具备基本能力

当前系统已经支持：

1. 原员工离职/移除后，岗位进入 `handover_pending`。
2. 原岗位的可继承资产被冻结。
3. 需要凭证重绑的资产被标记为 `rebind_required` / `reauthorization_required`。
4. 新员工接手后，可恢复岗位资产。

相关代码：

- `src/gateway/enterprise-seat-assets-store.ts`
- `src/gateway/enterprise-seat-assets-governance.ts`

### 5. Connector 已经具备部分“配置与凭证分离”的雏形

当前交接时，系统已经会把一部分 connector 相关资产标记为：

- `rebind_required`
- `reauthorization_required`

这说明当前实现已经自然接近：

- Profile 可保留
- Credential 需重绑

但该规则尚未被产品层和数据模型层正式显性化。

## 当前最大风险与优先级

专家反馈已经明确：当前最危险的点不是继承策略，而是岗位识别逻辑。

### P0 风险：`seatTitle` 模糊复用

当前 seat 复用逻辑存在按岗位标题查找可复用 seat 的行为。

风险场景：

- 企业同时存在：
  - 销售经理（华东）
  - 销售经理（华南）
  - 销售经理（KA）
- 标题都可能显示为“销售经理”
- 若按 `seatTitle` 复用，将可能把错误岗位资产交给错误员工

这属于：

- 资产错交风险
- 权限错授风险
- 审计不可解释风险

结论：

- 这是 P0 级修复项
- 优先级高于前端体验优化

### P1 风险：`seatOffer` 深链接体验错误

当前岗位确认邮件已经生成公网链接，但公网前端没有把 `seatOffer` 正确落到：

- 员工登录
- 登录后自动回到岗位确认
- 展示待确认岗位

而是错误落到通用注册页。

这属于：

- 转化率损失
- 产品体验错误

但不如岗位错交风险严重，因此列为 P1。

### P2 风险：资产继承策略不够可控

当前系统默认更偏向岗位资产自然继承，但管理员尚不能充分控制：

- 全量继承
- 局部继承

这属于功能增强，不是系统立刻不可运行的问题，因此列为 P2。

## 正式产品规则

### 一、岗位任命统一模型

所有岗位接手都统一称为：

- `Seat Assignment`

分两种类型：

#### A. New Hire Assignment

适用：

- 员工未注册
- 员工首次入职
- 新员工接手离职员工原岗位

流程：

1. 企业管理员选定 `seatId`
2. 系统发出岗位任命邮件（交付方式为员工激活注册链接）
3. 员工完成注册
4. 注册成功后自动绑定岗位
5. 岗位资产按策略生效

#### B. Internal Assignment

适用：

- 员工已注册
- 员工调岗、接岗、代理岗位、兼任岗位

流程：

1. 企业管理员选定 `seatId`
2. 系统发出岗位任命邮件（交付方式为岗位确认链接）
3. 员工登录
4. 登录后进入岗位确认页
5. 员工接受岗位
6. 岗位资产按策略生效

### 二、岗位资产模型

岗位资产是岗位级默认资产，建议明确分为三类宿主：

#### 1. Tenant Scope

企业级宿主。

例如：

- 企业知识库
- 企业机器人模板
- 企业级能力中心资产

#### 2. Space Scope

项目/协作组级宿主。

例如：

- 项目协作空间
- 项目机器人
- 项目讨论上下文

#### 3. Seat Scope

岗位级宿主。

例如：

- 岗位默认机器人
- 岗位默认协作空间
- 岗位 memory scope
- 岗位默认 connector 访问关系

结论：

- 不是所有资产都应该挂到 Seat 下
- 但当前交接/继任阶段，优先处理的是 `Seat Scope`
- `Tenant Scope` 和 `Space Scope` 的更完整治理放到下一阶段

### 三、Seat 生命周期模型

正式 Seat 生命周期定义如下：

1. `vacant`
   - 无员工占用
   - 可被发起任命
2. `assigned`
   - 已发任命
   - 员工尚未完成接受或注册
3. `occupied`
   - 员工已正式持岗
   - 岗位资产已生效
4. `handover_pending`
   - 原员工已离岗
   - 继任处理中
5. `frozen`
   - 岗位因治理原因冻结
   - 不允许继续自动流转

冻结规则：

1. 新员工任命发出后，Seat 进入 `assigned`。
2. 已注册员工岗位确认发出后，Seat 进入 `assigned`。
3. 接受完成后进入 `occupied`。
4. 离职或岗位释放后进入 `handover_pending`。
5. 治理干预或人工冻结进入 `frozen`。

### 四、已注册员工接岗的语义

已注册员工接手岗位时，不应理解为：

- 员工私有资产直接转给另一个员工

而应理解为：

- 员工接手一个岗位
- 岗位上已有的默认资产重新对其生效

因此，准确表述应是：

- 岗位资产流动
- 不是员工私有资产流动

### 五、Memory Scope 交接分类

Memory scope 不应简单地一律视为“可继承”。

建议正式分为三类：

1. `inheritable`
   - 可直接继承
   - 例如岗位操作手册、标准工作记忆
2. `review_required`
   - 继任前需管理员确认
   - 例如客户上下文、项目敏感但可继承材料
3. `private`
   - 不继承
   - 例如个人绩效备注、私人沟通总结、敏感人事信息

第一阶段建议：

1. 后端与任命快照先支持该分类语义。
2. UI 第一阶段至少暴露：
   - `可自动继承`
   - `需人工确认`
3. `private` 默认不继承，不放入任命快照。

### 六、Connector 分层规则

为避免未来交接痛点，建议正式拆分：

1. `ConnectorProfile`
   - 连接器配置轮廓
   - 可随岗位继承
2. `ConnectorCredential`
   - 具体登录凭证、授权令牌、个人身份态
   - 必须重绑或重授权

第一阶段产品规则：

1. Profile 继承
2. Credential 重绑
3. UI 上统一显示为：
   - “连接器配置已继承”
   - “凭证需重新授权”

## 继承策略定版

专家反馈建议不要一开始把策略做得太复杂。

### 第一阶段只开放两档

管理员界面只展示：

1. `完整继承`（默认）
2. `自定义继承`

### 默认模式：完整继承

默认继承：

- 默认机器人
- 默认协作空间
- 岗位 memory scope

connector 等敏感资产仍进入重授权。

### 自定义模式：选择继承

管理员可选择：

- 哪些机器人继承
- 哪些协作空间继承
- 是否沿用 memory scope

### 空继承策略处理

`空继承` 不是本阶段显式产品模式。

实现建议：

- 后端能力可以预留
- UI 第一阶段不直接暴露

避免管理员误操作。

## 关于“每岗位最多 5 个机器人”

### 当前事实

当前代码里存在：

- `ENTERPRISE_POSITION_AGENT_ASSET_LIMIT = 5`

它限制的是：

- 每个岗位最多配置 5 个机器人资产

### 产品建议

不要把 `5` 定义为长期产品规则。

应把它视为：

- 当前工程约束

产品层表达建议为：

- 岗位可配置有限数量的默认机器人
- 后台显示 `已使用 3 / 5`

而不是对外宣称：

- 岗位最多只能有 5 个机器人

### 实施原则

1. 继续保留当前后端上限，保证系统稳定。
2. UI 上显示配额进度，不把 `5` 上升为制度规则。
3. 后续若要扩容，应作为工程配置项而不是产品制度项。

## 关于“一人多岗位”

专家意见是：

- 产品规则不要锁死成“一人永远只能一个岗位”

因此建议：

### 数据模型定版建议

数据模型允许：

- 一个员工存在多个 `SeatBinding`

但 binding 需要支持角色：

- `primary`
- `secondary`

### 第一阶段产品开放范围

第一阶段只开放：

- 一个 `primary seat`

不开放：

- 多岗位同时激活
- 多岗位资产并集消费

### 为什么这样做

这样可以：

1. 现在不引入复杂产品交互。
2. 避免未来迁表或重塑数据模型。
3. 为代理主管、兼岗、临时兼任等场景留出扩展空间。

## 必须冻结的交接规则

### 规则 1：继任只能按 `seatId`

所有交接、继任、岗位确认、岗位注册都必须显式指定 `seatId`。

### 规则 2：后台必须显示完整岗位标识

后台岗位选择器必须展示：

| 字段       | 是否必须 |
| ---------- | -------- |
| `seatId`   | 是       |
| `roleCode` | 是       |
| 部门       | 是       |
| 当前状态   | 是       |
| 当前员工   | 是       |
| 上任员工   | 建议     |

### 规则 3：凭证不可自动接管

岗位资产中涉及登录态、凭证、授权绑定的部分，必须：

- 自动标记重授权
- 不得无感继承

### 规则 4：所有继任动作必须审计

至少审计：

- 谁发起
- 目标 `seatId`
- 目标员工
- 继承策略
- 机器人清单
- 协作空间清单
- connector 是否需重授权
- 接受/拒绝结果

## 可实施的详细执行计划

以下按 P0 / P0.5 / P1 / P2 / 下一阶段执行。

### P0：核心模型冻结与 `seatId` 精确继任改造

目标：

- 冻结 Seat 生命周期与 SeatAssignment 规则
- 彻底消除按 `seatTitle` 模糊复用的风险

#### P0-1 后端改造

1. 引入正式的 Seat 生命周期状态语义：
   - `vacant`
   - `assigned`
   - `occupied`
   - `handover_pending`
   - `frozen`
2. 建立或收敛 `SeatAssignment` 实体，至少具备：
   - `assignmentId`
   - `seatId`
   - `targetEmail`
   - `employeeId`
   - `assignmentType`
   - `status`
   - `expireAt`
   - `acceptedAt`
   - `createdBy`
   - `handoverCaseId`
   - `inheritMode`
3. 修改新员工岗位任命接口，支持并要求显式传入：
   - `seatId`
   - `assignmentType`
4. 修改 `createEmployeeProvisionWithSeat(...)` 相关路径：
   - 新员工继任原岗位时优先使用显式 `seatId`
   - 不再仅按岗位标题复用
5. 保留 `seatTitle` 创建新 seat 的路径，仅用于：
   - 全新岗位创建
   - 非继任的普通新增员工岗位
6. 若传入 `seatId`，则后端必须校验：
   - seat 存在
   - seat 属于当前 tenant
   - seat 状态允许被继任
7. 所有岗位继任相关代码路径不再允许用 `seatTitle` 定位交接对象。

#### P0-2 前端改造

1. 管理员发起岗位任命时，必须先选中具体岗位卡片/行。
2. “继任原岗位”入口从岗位列表发起，不从纯文本职位名发起。
3. UI 不再允许只输入岗位名称进行继任。
4. 管理员选择岗位时必须展示：
   - `seatId`
   - `roleCode`
   - 部门
   - 当前状态
   - 当前员工
   - 上任员工（若存在）

#### P0-3 数据与审计改造

1. `provision` / `offer` / `assignment` payload 中补充：
   - `assignmentId`
   - `seatId`
   - `roleCode`
   - `assignmentType`
2. 交接与任命快照中补充：
   - `inheritMode`
   - `assetSummary`
   - `memoryTransferPolicy`
   - `connectorTransferPolicy`
3. 审计记录补充：
   - `seatId`
   - `handoverCaseId`
   - `assignmentId`

#### P0 验收标准

1. 同一个企业下存在三个同名“销售经理”。
2. 管理员选择其中一个 `seatId` 发起继任。
3. 新员工注册或老员工确认后，最终绑定的必须是指定 `seatId`。
4. 任何环节不允许按岗位标题自动落错。
5. `SeatAssignment` 能完整追踪一次任命的发起、接受、撤销和过期状态。

### P0.5：审计体系补齐

目标：

- 使岗位任命、继任、资产继承具备可追溯性

#### P0.5-1 必须记录的审计字段

至少记录：

- `assignmentId`
- `seatId`
- `employeeId`
- `oldEmployeeId`
- `newEmployeeId`
- `inheritMode`
- `acceptedAt`
- `createdBy`
- `handoverCaseId`
- `memoryTransferPolicy`
- `connectorTransferPolicy`

#### P0.5-2 审计事件类型

建议至少定义：

1. `assignment.created`
2. `assignment.reminded`
3. `assignment.accepted`
4. `assignment.declined`
5. `assignment.canceled`
6. `handover.started`
7. `handover.completed`
8. `asset.inheritance.applied`
9. `credential.reauthorization.required`

#### P0.5 验收标准

1. 任意一条岗位任命都可以按 `assignmentId` 查到完整生命周期。
2. 任意一条资产继承都可以追溯：
   - 谁发起
   - 给了谁
   - 给了哪个岗位
   - 继承了哪些资产
3. 任意一条 connector 重授权要求都可以追溯到具体岗位任命。

### P1：`seatOffer` 深链接岗位确认流程修复

目标：

- 已注册员工点击岗位任命邮件后，能稳定完成登录并确认岗位

#### P1-1 前端改造

1. 公网前端识别 `seatOffer=<offerId>`。
2. 如果用户未登录：
   - 强制进入员工登录
   - 不进入通用注册页
3. 登录成功后：
   - 自动回到个人设置
   - 自动定位岗位确认区域
   - 自动展示 `pendingSeatOffer`
4. UI 展示内容至少包括：
   - 岗位名称
   - `roleCode`
   - 默认机器人
   - 默认协作空间
   - memory scope 摘要
   - connector 是否需重授权

#### P1-2 网关与路由改造

1. 公网链接生成继续使用公网基址。
2. 若需要，单独增加更明确的岗位任命入口路由，但不强依赖新增公网页面结构。
3. 保证登录后状态恢复时保留 `seatOffer`。

#### P1 验收标准

1. 已注册员工收到岗位任命邮件。
2. 点击链接后进入登录页，而不是注册页。
3. 登录成功后进入岗位确认页。
4. 接受岗位后：
   - `currentSeat` 更新
   - `pendingOffer` 清空
   - 默认资产生效

### P2：资产继承策略实现

目标：

- 管理员可控制岗位默认资产如何交给继任者

#### P2-1 后端改造

1. 在岗位任命数据模型中补充：
   - `inheritMode = full | selective`
2. 增加 memory scope 的交接分类：
   - `inheritable`
   - `review_required`
   - `private`
3. selective 模式下允许提交：
   - `agentIds`
   - `defaultSpaceIds`
   - `inheritMemoryScope`
4. connector 类资产升级为分层规则：
   - Profile 继承
   - Credential 重绑
5. connector 快照中明确输出：
   - `profileIds`
   - `credentialReauthorizationRequired`

#### P2-2 前端改造

1. 管理员在发起岗位任命时默认选中：
   - `完整继承`
2. 点击“自定义继承”时展开资产选择器：
   - 机器人
   - 协作空间
   - memory scope
   - connector profile（只展示继承轮廓）
3. `review_required` 的 memory scope 需明确标识为：
   - “需管理员确认”
4. connector 需明确展示：
   - “配置继承”
   - “凭证需重授权”
5. UI 第一阶段不显式展示“空继承”。

#### P2 验收标准

1. 完整继承时，新员工/已注册员工接手后获得完整岗位默认资产。
2. 自定义继承时，仅获得勾选的岗位资产。
3. `review_required` memory scope 不会被无提示自动继承。
4. connector profile 可继承，但 connector credential 仍进入重授权状态。

### 下一阶段：权限模型与资产宿主模型深化

这不是当前上线阻塞项，但必须列入下一阶段架构工作。

范围包括：

1. `Tenant Scope`
2. `Space Scope`
3. `Seat Scope`
4. 多岗位 binding 的权限并集与主岗位策略
5. 员工私有资产与岗位资产边界
6. Ownership 与 Permission 的分离实现
7. 临时代理、兼岗、矩阵组织的 secondary seat 权限规则

这部分不应阻塞当前 P0/P1/P2 上线。

## 本轮开发顺序

按专家建议，本轮实施顺序固定为：

1. **P0**
   - `seatId` 驱动继任
   - Seat 生命周期冻结
   - SeatAssignment 实体
2. **P0.5**
   - 审计体系
3. **P1**
   - `seatOffer` 深链接岗位确认流程
4. **P2**
   - 资产继承策略
5. **下一阶段**
   - 权限模型与宿主模型深化

## 专家评审后可直接冻结的最终规则

建议本轮评审直接确认以下定版内容：

1. 岗位（Seat）是企业资产宿主。
2. 资产跟岗位走，不跟员工走。
3. 继任 = `Seat Rebinding`，不是资产转移。
4. `seatId` 是唯一交接标识，`seatTitle` 禁止参与交接定位。
5. 新员工任命 = 激活注册 + 自动绑定岗位。
6. 已注册员工任命 = 登录确认 + 接手岗位。
7. Seat 生命周期为：
   - `vacant`
   - `assigned`
   - `occupied`
   - `handover_pending`
   - `frozen`
8. `SeatAssignment` 是正式业务实体。
9. memory scope 至少区分：
   - `inheritable`
   - `review_required`
   - `private`
10. connector 继承规则为：

- Profile 继承
- Credential 重绑

11. Ownership 与 Permission 分层，权限模型放入下一阶段。
12. 一期只开放：

- 一个主岗位
- 完整继承
- 自定义继承

13. 当前机器人上限视为工程约束，不上升为长期产品制度。

## 最终建议

当前最重要的不是继续讨论 Seat 是否正确，而是立刻把以下三项落地：

1. `seatId` 精确继任（P0）
2. 审计体系（P0.5）
3. `seatOffer` 公网登录确认流程（P1）
4. 继承策略最小可用版本（P2）

做到这四项后，OpenBot 的岗位资产管理就具备了：

- 可安全上线
- 可审计追溯
- 可逐步演进到企业级治理模型

这也是当前阶段风险最小、价值最高的执行路径。
