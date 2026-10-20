# OpenBot 企业智能资产绑定与继任方案

Date: 2026-04-14

## Purpose

本文档用于解决一个当前必须先定版再实施的问题：

1. 员工在企业内创建、训练、配置的机器人，哪些属于个人，哪些属于企业。
2. 员工离职时，系统如何解绑人员、保护企业资产、避免能力流失。
3. 新员工入职并接任同一岗位时，如何安全、完整、可审计地继承该岗位已有的智能资产与工作上下文。
4. 员工端“个人设置”与企业端“资产治理/交接治理”的边界应如何划分。

本文目标不是直接落实现有代码，而是先冻结业务语义、对象边界和治理流程，作为专家评审后的实施蓝图。

## Related Docs

- 四端职责边界：[/design/openbot-four-port-ia-and-reorg-plan-2026-04-12](/design/openbot-four-port-ia-and-reorg-plan-2026-04-12)
- 平台认证与员工激活：[/design/openbot-platform-auth-final-registration-login-flow-2026-04-13](/design/openbot-platform-auth-final-registration-login-flow-2026-04-13)
- 协作学习治理：[/design/openbot-collaboration-learning-governance-implementation-plan-2026-04-03](/design/openbot-collaboration-learning-governance-implementation-plan-2026-04-03)

## Link Policy

OpenBot 当前尚未正式上线，因此本阶段文档与评审材料的链接策略必须收口：

1. 不展示任何 `openbot.love` 或 `docs.openbot.love` 绝对域名。
2. 不提前定义 `openbot` 的公开站点域名。
3. 仓库内文档统一使用仓库内可解析的相对/根相对引用。
4. 对外评审材料优先引用：
   - `docs/design/...`
   - `/design/...`

也就是说，在 OpenBot 正式上线前，文档可以互相引用，但不能再通过 `openbot` 域名对外呈现。

## 1. Executive Summary

最佳方案建议直接定为：

1. 企业内创建的业务机器人，默认不是“员工个人资产”，而是“企业资产”。
2. 企业资产不直接绑定员工账号，而应优先绑定到“岗位席位（Position Seat）”。
3. 员工只是某个岗位席位的当前使用者，而不是该岗位机器人、岗位记忆、岗位技能和岗位工作上下文的最终所有者。
4. 员工离职时，系统做的是“账号停用 + 席位解绑 + 企业资产保留 + 凭证回收 + 待交接冻结”，而不是把机器人一起删除。
5. 新员工入职后，系统做的是“绑定到原岗位席位”，从而继承岗位机器人的配置、工作上下文、共享记忆、共享技能、待办与协作关系。
6. 个人设置只管理“这个系统如何为我服务”，不管理“企业机器人如何交接与治理”。

这意味着 OpenBot 需要采用：

- `岗位席位所有，个人绑定使用`
- `企业资产默认可继承，个人偏好默认不可继承`
- `共享资产与私人资产分层存储`
- `离职/继任有明确状态机、审批、审计与冻结机制`

这是比“机器人直接挂在员工名下，再在离职时转移”更稳妥的模型。后者会把权限、记忆、数据归属、历史会话、外部连接器、审计责任全部混在一起，长期不可维护。

### 1.1 当前实现基线

当前仓库并不是从零开始，已经有几块可以直接继承的基础：

1. 四端总方案里已经定义过粗粒度 `AccessPolicy` 对象，但目前仍然过于抽象，只有 `subjectType / subjectId / rules`，尚不足以支撑岗位席位、连接器、记忆和执行权限的精细治理。
2. `packages/collaboration-core` 已经存在 policy helper，尤其是：
   - final decision policy
   - learning projection policy
3. `packages/collaboration-openbot-adapter` 已经明确承担 OpenBot 专属的 `storage / audit / session / directory` 适配职责。
4. 平台认证方案里已经有 `employeeProvision`、邀请码绑定邮箱、席位配额等员工生命周期基础对象。

但当前仍然缺少三类关键系统能力：

1. 显式权限层，无法回答“谁可以让 AI 做什么”。
2. Agent 资产分层，无法回答“模板、实例、版本、回滚”。
3. 可计算的记忆归属协议，无法自动决定“哪些记忆可继承、哪些必须阻断”。

因此，本次修订不是推翻原方案，而是在已有协作 policy、audit adapter 和员工激活基础之上，补齐真正的操作系统层。

## 2. 问题本质

当前业务矛盾不在“要不要做一个交接按钮”，而在于系统对象建模是否正确。

如果把企业场景里的机器人视为员工个人对象，会立刻出现以下问题：

1. 员工离职时，机器人是否应该删除。
2. 机器人使用的知识、提示词、技能、连接器和记忆是否允许被下一个员工继续使用。
3. 历史会话里哪些是企业业务资产，哪些是个人隐私。
4. 外部系统凭证、群组权限、空间权限、审批记录如何回收。
5. 岗位交接到底是“迁移机器人”，还是“更换岗位当前使用人”。

最根本的问题是：

OpenBot 不能把“员工”当作企业智能资产的稳定宿主。

稳定宿主应该是：

- 企业
- 部门/小组
- 岗位席位
- 协作空间

而不是某个自然人账号。

## 3. 边界原则

### 3.1 Employee / Enterprise 边界

根据四端边界，员工端负责使用、协作、知识工作和个人使用设置；企业端负责组织治理、成员管理、企业 Agent 配置和企业内部运行治理。

因此：

1. 个人设置不负责机器人所有权迁移。
2. 个人设置不负责岗位继任审批。
3. 离职解绑、岗位继任、资产交接、连接器回收、群组权限回收，都属于 Enterprise 端。
4. 员工端最多展示“我当前绑定了哪些岗位席位/工作身份”的只读信息或有限切换入口。

### 3.2 默认所有权原则

建议直接定一条强规则：

在企业租户内创建，且满足以下任一条件的机器人，默认视为企业资产：

1. 使用企业租户数据。
2. 连接企业知识库、企业空间、企业频道或企业业务系统。
3. 服务某个团队、岗位、协作空间或业务流程。
4. 在企业工作台中被共享、分配、编排或纳入工作流。
5. 使用企业统一提供的模型策略、技能包、记忆域或执行配额。

只有在明确标记为“个人沙盒”的情况下，才允许视为个人资产。

### 3.3 最重要的结构性结论

不要让企业机器人直接绑定到员工。

应该让：

`企业资产 -> 岗位席位 -> 当前员工`

而不是：

`企业资产 -> 当前员工`

## 4. 推荐对象模型

## 4.1 核心对象

建议至少引入以下对象语义：

### `EmployeeAccount`

员工账号。

关注：

- 登录身份
- 密码与会话
- 个人偏好
- 个人私有历史
- 当前绑定的岗位席位

### `PositionSeat`

岗位席位，是继任与资产交接的核心宿主。

建议字段：

- `seatId`
- `tenantId`
- `departmentId`
- `title`
- `roleCode`
- `status`
  - `vacant`
  - `occupied`
  - `handover_pending`
  - `frozen`
- `currentEmployeeId`
- `backupEmployeeIds`
- `defaultSpaceIds`
- `defaultAgentAssetIds`

### `AgentAsset`

企业智能资产，不代表“某次聊天”，而代表可长期保有、可治理、可复用的机器人资产。

建议字段：

- `assetId`
- `tenantId`
- `ownerScopeType`
  - `tenant`
  - `department`
  - `position_seat`
  - `space`
- `ownerScopeId`
- `displayName`
- `status`
  - `active`
  - `handover_frozen`
  - `archived`
  - `revoked`
- `templateVersion`
- `memoryScopeId`
- `skillProfileId`
- `connectorProfileId`
- `policyProfileId`

### `SeatBinding`

岗位席位与员工的绑定关系。

建议字段：

- `bindingId`
- `seatId`
- `employeeId`
- `bindingStatus`
  - `active`
  - `suspended`
  - `revoked`
  - `completed`
- `effectiveAt`
- `endedAt`
- `endedReason`
  - `offboarded`
  - `transferred`
  - `temporary_cover_ended`

### `HandoverCase`

岗位交接流程对象。

建议字段：

- `handoverCaseId`
- `tenantId`
- `seatId`
- `outgoingEmployeeId`
- `incomingEmployeeId`
- `status`
  - `draft`
  - `asset_review`
  - `pending_approval`
  - `frozen`
  - `rebound`
  - `completed`
- `reviewSummary`
- `exceptionFlags`
- `approvedBy`
- `completedAt`

### 4.1.1 业务对象与系统资源对象必须分层

上面这些对象足以表达业务流程，但还不足以表达企业级 AI Operating System 的调度与治理。

因此必须明确：

- `EmployeeAccount / PositionSeat / HandoverCase` 是业务对象
- `AccessPolicy / ExecutionPolicy / AgentDefinition / AgentInstance / AgentSnapshot / MemoryRecord / ConnectorProfile` 是系统资源对象

如果没有第二层，系统就会停留在“资产管理工具”，而无法升级为“企业级 AI 操作系统”。

### 4.1.2 Access Control Layer

建议正式引入显式权限层：

```ts
type AccessPolicy = {
  policyId: string;
  subjectType: "employee" | "seat" | "group";
  subjectId: string;
  resourceType: "agent_definition" | "agent_instance" | "memory" | "connector" | "space";
  resourceId: string;
  action: "read" | "write" | "execute" | "manage";
  effect: "allow" | "deny";
  condition?: {
    tenantId?: string;
    departmentId?: string;
    seatId?: string;
    timeWindow?: string;
    sourceNetwork?: string;
    riskLevel?: "low" | "medium" | "high";
  };
};
```

结论必须明确：

- `Seat` 负责归属与稳定宿主
- `AccessPolicy` 负责使用权与治理边界

否则以下场景无法闭合：

1. 一个机器人被多个岗位共用
2. 代班、轮值、临时代理
3. 精确审计“谁读过客户数据”
4. AI 自动调用工具时的细粒度权限控制

### 4.1.3 Execution Policy Layer

除了静态权限，还必须有执行策略层，用来限制 AI 在运行时能做什么：

```ts
type ExecutionPolicy = {
  policyId: string;
  subjectType: "agent_instance" | "seat";
  subjectId: string;
  allowedActions: Array<"read_memory" | "write_memory" | "execute_connector" | "join_space">;
  blockedActions?: Array<"write_memory" | "execute_connector">;
  approvalRequiredActions?: Array<"write_memory" | "execute_connector" | "publish_decision">;
  maxRiskLevel?: "low" | "medium" | "high";
};
```

这一层决定的不是“谁拥有 AI”，而是“谁可以让 AI 做什么”。

### 4.1.4 Agent 必须拆成三层

当前方案中的 `AgentAsset` 语义是正确的，但工程上仍然过粗。

建议拆为：

```ts
type AgentDefinition = {
  definitionId: string;
  tenantId: string;
  displayName: string;
  promptProfileId: string;
  toolProfileId: string;
  policyProfileId: string;
  memoryBindingMode: "none" | "seat" | "space" | "hybrid";
  status: "active" | "archived";
};

type AgentInstance = {
  instanceId: string;
  definitionId: string;
  ownerScopeType: "seat" | "space" | "tenant";
  ownerScopeId: string;
  status: "active" | "handover_frozen" | "archived";
  memoryScopeId?: string;
  connectorBindingIds: string[];
};

type AgentSnapshot = {
  snapshotId: string;
  definitionId: string;
  version: string;
  createdAt: number;
  createdBy: string;
  changeSummary?: string;
};
```

三层分别解决：

1. `AgentDefinition`
   - 定义机器人是什么
2. `AgentInstance`
   - 定义机器人当前挂在哪个 seat/space 下运行
3. `AgentSnapshot`
   - 定义机器人在某个时点是什么版本，便于审计、比较、回滚

没有这一拆分，系统将无法优雅支撑：

1. prompt 回滚
2. 灰度发布
3. 交接前后差异比较
4. 追责“是谁改坏了机器人”

### 4.1.5 PositionSeat 必须升级为 Capability Container

`PositionSeat` 不应只是组织结构节点，还应是能力容器。

建议增加：

```ts
type CapabilityProfile = {
  profileId: string;
  seatId: string;
  expectedSkills: string[];
  requiredAgentDefinitionIds: string[];
  requiredConnectorProfileIds: string[];
  requiredSpaceIds: string[];
  kpiBindings?: string[];
};

type SeatBaselineSnapshot = {
  snapshotId: string;
  seatId: string;
  createdAt: number;
  agentInstanceIds: string[];
  memoryScopeIds: string[];
  connectorBindingIds: string[];
  spaceIds: string[];
  unresolvedTasksCount?: number;
};
```

这样 seat 才能真正承担：

1. onboarding 自动补齐
2. 继任完整性校验
3. 交接前后差异对比
4. 能力缺口检测

### 4.1.6 连接器不应直接挂在 Agent 上

建议新增：

```ts
type ConnectorProfile = {
  connectorProfileId: string;
  tenantId: string;
  connectorType: string;
  configSchemaVersion: string;
  policyProfileId?: string;
  status: "active" | "archived";
};

type SeatConnectorBinding = {
  bindingId: string;
  seatId: string;
  connectorProfileId: string;
  authMode: "seat_managed" | "personal_rebind_required";
  status: "active" | "rebind_required" | "revoked";
};
```

推荐关系应为：

`ConnectorProfile -> SeatConnectorBinding -> AgentInstance`

而不是：

`Agent -> Connector`

否则会导致：

1. 多个 agent 重复配置同一外部系统
2. 无法统一撤销权限
3. 难以处理继任时的凭证重绑
4. 审计链断裂

### 4.1.7 记忆必须进入可计算协议

当前“个人 / 岗位 / 空间”三层划分是正确的语义边界，但还不是系统能力。

建议正式引入 `Memory Ownership Protocol`：

```ts
type MemoryRecord = {
  memoryId: string;
  scopeType: "personal" | "seat" | "space";
  scopeId: string;
  sensitivityLevel: "low" | "medium" | "high";
  originType: "user_input" | "agent_generated" | "system_extracted";
  ownershipConfidence: number;
  classification: "shared_reusable" | "seat_candidate" | "personal_private" | "sensitive_blocked";
  trustScore?: number;
  decayAt?: number;
};
```

这一定义的关键点不是“多存几个字段”，而是让系统能自动回答：

1. 这条记忆应该属于谁
2. 这条记忆能不能继承
3. 这条记忆要不要审批
4. 这条记忆是否应该衰减或失效

### 4.1.8 Handover 需要冲突处理层

真实企业不会只有线性交接，还会有冲突。

建议新增：

```ts
type HandoverConflict = {
  conflictId: string;
  handoverCaseId: string;
  type: "asset_conflict" | "permission_conflict" | "memory_conflict";
  resourceType: "agent_instance" | "memory" | "connector" | "space";
  resourceId: string;
  resolutionStrategy: "admin_override" | "duplicate_and_split" | "archive_old";
  resolvedBy?: string;
  resolvedAt?: number;
};
```

没有这层，以下现实问题无法处理：

1. 离职前员工还在持续写入
2. 多人同时接任
3. 资产跨部门共用，归属不清

### 4.1.9 审计不应只是日志，而应是因果图

建议把审计从“事件日志”升级为“可追责图谱”：

```ts
type AuditEdge = {
  edgeId: string;
  fromType: "employee" | "seat" | "agent_instance" | "memory" | "connector" | "external_action";
  fromId: string;
  toType: "employee" | "seat" | "agent_instance" | "memory" | "connector" | "external_action";
  toId: string;
  relation:
    | "bound_to"
    | "granted_access"
    | "executed"
    | "read"
    | "wrote"
    | "approved"
    | "inherited_from";
  createdAt: number;
};
```

目标不是“多记录一点日志”，而是让系统能回答：

1. 谁让这个 agent 访问了客户数据
2. 谁批准了这条记忆被继承
3. 哪个版本的 prompt 导致了错误行为

## 4.2 为什么要引入 `PositionSeat`

因为企业交接不是“把 A 的机器人交给 B”，而是：

“让 B 接替 A 所在岗位，并继承该岗位已沉淀的智能工作能力。”

岗位席位的价值在于：

1. 它比自然人稳定。
2. 它天然承接组织编制、岗位职责和工作范围。
3. 它可以长期保有岗位机器人、岗位记忆、岗位空间、岗位知识入口和岗位待办。
4. 它允许岗位暂时空缺，资产不丢。
5. 它允许交接在账号停用前先冻结，再重绑。

## 5. 智能资产分类

这是本方案最关键的部分。不是所有“AI 相关对象”都该继承。

### 5.1 生命周期与使用权必须解耦

这里必须补一个此前没有显式写出的原则：

资产的生命周期，不等于某个员工对资产的使用权。

因此必须拆开看：

1. `Lifecycle`
   - 资产是否存在
   - 是否冻结
   - 是否归档
2. `Ownership`
   - 资产属于谁
3. `Access`
   - 谁当前可以读、写、执行、管理

例如：

- 员工离职后，岗位 Agent 的 `Lifecycle` 继续存在
- 所有权仍属于 `seat/tenant`
- 原员工的 `Access` 被立即撤销

只有把这三层拆开，才能避免“离职 = 删资产”或“继任 = 直接继承全部权限”的误判

| 资产类型                             | 默认归属      | 是否继承                 | 原因                                   | 归属端     |
| ------------------------------------ | ------------- | ------------------------ | -------------------------------------- | ---------- |
| 头像、昵称、语言、主题、通知偏好     | 个人          | 否                       | 纯个人体验偏好                         | Employee   |
| 个人密码、设备登录、双因子、个人会话 | 个人          | 否                       | 身份安全对象                           | Employee   |
| 个人私聊历史                         | 个人          | 否                       | 涉及个人隐私与个人工作方式             | Employee   |
| 个人私有记忆                         | 个人          | 否，默认清理或导出给本人 | 不应污染继任者                         | Employee   |
| 企业岗位机器人配置                   | 企业/岗位席位 | 是                       | 属于岗位工作能力                       | Enterprise |
| 岗位提示词、SOP、规则、模板          | 企业/岗位席位 | 是                       | 属于企业方法资产                       | Enterprise |
| 岗位技能包与工具白名单               | 企业/岗位席位 | 是                       | 属于岗位能力边界                       | Enterprise |
| 岗位共享记忆                         | 企业/岗位席位 | 是，经审查               | 属于业务连续性核心资产                 | Enterprise |
| 协作空间历史与治理对象               | 空间/企业     | 是，按权限继承           | 属于团队工作上下文                     | Enterprise |
| 企业知识库连接与检索配置             | 企业          | 是                       | 属于企业知识能力                       | Enterprise |
| 外部业务系统连接器配置               | 企业/岗位席位 | 是，但需凭证重绑         | 连接器配置可继承，个人凭证不可直接继承 | Enterprise |
| 个人风格偏好，如回复语气/长度        | 个人          | 否                       | 是“系统怎么为我工作”，不是企业资产     | Employee   |
| 岗位助手风格，如销售标准话术         | 企业/岗位席位 | 是                       | 属于岗位标准执行能力                   | Enterprise |

## 6. 继承规则

## 6.1 必须继承的内容

以下内容建议默认继承：

1. 岗位机器人本体及其配置。
2. 岗位 SOP、规则、标准话术、审核约束。
3. 岗位技能集合、工具授权边界。
4. 岗位共享记忆和被明确提升为共享资产的学习沉淀。
5. 岗位绑定的协作空间、群组和工作流入口。
6. 岗位待处理任务、决策对象、交付物、审阅对象。
7. 岗位级知识库、业务系统连接配置。

## 6.2 绝不能直接继承的内容

以下内容建议默认禁止继承：

1. 原员工密码、登录会话、设备授权。
2. 原员工个人私聊历史。
3. 原员工个人偏好、界面设置、通知设置。
4. 原员工私有记忆。
5. 原员工个人 OAuth token、个人邮箱授权、个人 IM 账号授权。
6. 原员工个人沙盒机器人。

## 6.3 条件继承的内容

以下内容需要审查后继承：

1. 含敏感信息的岗位记忆。
2. 历史会话中混有大量个人表达的记录。
3. 依赖员工个人身份认证的外部连接器。
4. 被员工创建但长期服务于岗位的机器人。

建议通过“资产审查 + 分类标签”来决定：

- `shared_reusable`
- `seat_only`
- `personal_private`
- `sensitive_review_required`

## 7. 个人设置应该包含什么，不应该包含什么

## 7.1 个人设置应保留的内容

个人设置只应覆盖“我怎么用系统”。

建议保留：

1. 头像与显示名
2. 语言与主题
3. 通知偏好
4. 密码与设备安全
5. 个人会话历史管理
6. 个人私有记忆管理
7. 个人助手偏好
   - 回复风格
   - 默认语言
   - 默认输出粒度
8. 当前岗位绑定信息只读展示

补充建议：

- `退出账户` 保持为全局账户菜单动作即可，不应作为个人设置页的主能力重复建设。

## 7.2 个人设置不应承接的内容

以下内容不应放进个人设置：

1. 企业机器人删除与转移
2. 岗位继任审批
3. 团队群组治理
4. 企业知识库权限治理
5. 企业连接器分配
6. 机器人资产归属修改
7. 离职交接操作

原因很简单：

这些都不是“个人设置”，而是企业治理动作。

## 8. 企业侧最佳业务流程

## 8.1 员工入职

建议流程：

1. 企业管理员预创建员工并发放激活资格。
2. 企业管理员将员工分配到一个或多个岗位席位。
3. 系统根据岗位席位自动绑定：
   - 岗位机器人
   - 岗位空间
   - 岗位知识入口
   - 岗位任务看板
4. 员工首次登录后，看到的不是“从零开始的工作台”，而是已继承岗位资产的工作台。
5. 系统生成“岗位接任摘要”：
   - 岗位职责
   - 当前关键任务
   - 最近重要决策
   - 关键共享记忆
   - 需要重新授权的外部连接器

## 8.2 员工离职

建议流程：

1. 企业管理员发起离职或停用动作。
2. 系统立即停用员工账号登录能力。
3. 系统撤销全部活跃会话、设备 token、个人授权。
4. 系统把该员工与岗位席位的 `SeatBinding` 置为 `revoked` 或 `completed`。
5. 岗位机器人与岗位资产不删除，进入 `handover_frozen` 或“待继任冻结”状态。
6. 系统回收个人凭证型连接器。
7. 系统生成交接单，列出：
   - 保留的岗位资产
   - 待审查记忆
   - 失效的个人凭证
   - 未完成任务
   - 高风险空间与群组权限
8. 若岗位暂无继任人，则席位保持 `vacant`，资产继续由企业持有。

## 8.3 新员工继任

建议流程：

1. 企业管理员选择一个 `vacant` 或 `handover_pending` 的岗位席位。
2. 选择新员工作为接任者。
3. 系统展示继任预览：
   - 将继承哪些机器人
   - 将接入哪些空间
   - 将继承哪些共享记忆
   - 哪些连接器需要重新授权
4. 审批通过后，系统创建新的 `SeatBinding`。
5. 岗位资产从 `handover_frozen` 切回 `active`。
6. 系统向新员工推送岗位接任摘要和首日任务清单。

## 8.4 冲突处理与异常分支

企业真实交接不是总能线性完成，系统必须支持冲突分支：

1. `race condition`
   - 员工已进入离职流程，但仍在写岗位资产
   - 处理：先冻结 `write` 权限，再进入审查
2. `multi-successor`
   - 一个岗位暂由多人共同接手
   - 处理：允许多个 `AccessPolicy`，但席位主绑定只能有一个 `active`
3. `cross-department asset`
   - 资产同时服务多个部门
   - 处理：所有权留在 tenant/space，seat 只持有执行访问权
4. `connector auth drift`
   - 资产可继承，但连接器凭证已失效
   - 处理：继任人进入 `rebind_required` 流程，而不是强行沿用旧员工授权

## 9. 推荐状态机

## 9.1 席位状态

- `vacant`
  - 无当前员工，占有资产，可被继任
- `occupied`
  - 已有当前员工
- `handover_pending`
  - 员工即将离开，已进入交接
- `frozen`
  - 资产存在，但在等待审批、审查或异常处理

## 9.2 资产状态

- `active`
  - 正常使用
- `handover_frozen`
  - 交接中，不允许继续被旧员工写入
- `archived`
  - 历史保留，不再运营
- `revoked`
  - 因合规、风险或策略被撤销

## 9.3 绑定状态

- `active`
  - 当前有效绑定
- `suspended`
  - 暂停
- `revoked`
  - 被主动撤销
- `completed`
  - 一段绑定自然结束并完成归档

## 10. 记忆与会话的最佳处理方式

这是整个交接里风险最高的部分。

### 10.0 当前实现与目标状态

当前仓库已经具备“记忆投影 eligibility policy”的基础，也已经在协作学习链路里处理了：

1. `sensitivity`
2. `reusability`
3. `requiresApproval`
4. `projection / promotion`

这说明 OpenBot 已经有“基于 policy 的记忆门控”能力。

但它还没有形成企业继任所需的 `Memory Ownership Protocol`：

1. 不能稳定判定某条记忆属于 `personal / seat / space`
2. 不能形成统一的继承标签
3. 不能支撑自动分层、衰减与追责

因此本方案建议保留现有 learning projection 机制，作为后续 Memory Protocol 的基础实现层，而不是另起炉灶。

建议把记忆和会话分成三层：

### 10.1 个人私有层

只属于员工本人。

包括：

- 个人偏好
- 个人私聊历史
- 个人私有记忆

处理原则：

- 离职时不可继承
- 可按企业政策清理或导出给本人

### 10.2 岗位共享层

属于岗位席位。

包括：

- 标准工作步骤
- 客户/项目长期跟进摘要
- 岗位标准表达
- 共享办事经验

处理原则：

- 允许继承
- 需可审计
- 可被继任员工继续积累

### 10.3 空间协作层

属于空间或团队。

包括：

- 协作群历史
- 决策对象
- 审阅对象
- 交付物

处理原则：

- 不随个人离开而删除
- 继任人按空间权限进入后自然继续访问

### 10.4 记忆自动分层建议

最终目标不应依赖纯人工标注，而应采用：

`AI 初判 -> 分类标签 -> 人工审查 -> 提升/阻断`

建议自动输出四类结果：

- `shared_reusable`
- `seat_candidate`
- `personal_private`
- `sensitive_blocked`

但第一版不要直接上全自动继承，必须先让系统支持：

1. 自动分类建议
2. 人工确认
3. 审批留痕
4. 错误回滚

## 11. 连接器与凭证处理

连接器不能笼统地“跟着机器人继承”。

需要拆分成两层：

### 11.1 可继承的

1. 连接器类型
2. 目标系统配置
3. 字段映射
4. 工作流编排
5. 权限策略模板

### 11.2 不可直接继承的

1. 员工个人 OAuth token
2. 员工个人邮箱授权
3. 员工个人 IM 身份
4. 员工个人 API key

最佳做法：

岗位继任时继承“连接器配置壳”，但所有基于个人身份的授权都要求重新绑定。

补充要求：

1. Agent 只消费 `SeatConnectorBinding`
2. 连接器撤销应优先在 seat 层处理，而不是逐个 agent 处理
3. 审计时必须能定位“哪个 seat 通过哪个 binding 让哪个 agent 执行了哪个外部动作”

## 12. 审计与安全要求

此流程必须可审计，否则企业不会放心把智能资产托管给系统。

建议至少审计：

1. 岗位席位创建、修改、停用
2. 岗位席位与员工绑定、解绑、换绑
3. 岗位机器人创建、冻结、恢复、归档
4. 共享记忆提升与清理
5. 连接器授权、撤销、重绑
6. 离职发起、审批、完成
7. 继任发起、审批、完成
8. 高风险资产的人工审查结论

并要求：

1. 所有资产转移必须留痕
2. 所有高风险记忆继承必须有审批人
3. 冻结期间旧员工不得再写入岗位资产
4. 新员工首次接任时必须展示继承摘要

进一步要求：

审计层必须能从“事件记录”升级为“责任查询能力”。

系统至少要能直接回答：

1. 谁授予了这个 seat 使用该 agent 的权限
2. 谁批准了这条记忆被继承
3. 哪个 AgentSnapshot 在何时触发了错误行为
4. 哪个 SeatConnectorBinding 触发了某次外部系统写入

## 13. UI 与产品落点建议

## 13.1 Employee Port

员工端只建议增加有限能力：

1. 在个人设置中显示当前岗位席位
2. 显示“我当前服务的岗位机器人/空间”
3. 允许管理个人偏好、个人记忆、个人会话
4. 不提供企业资产删除、转移、继任审批入口

## 13.2 Enterprise Port

企业端需要新增或强化以下模块：

1. `员工与席位`
   - 员工列表
   - 岗位席位列表
   - 席位分配
2. `岗位资产`
   - 岗位机器人
   - 岗位记忆
   - 岗位技能
   - 岗位连接器
3. `交接中心`
   - 离职交接
   - 继任审批
   - 风险资产审查
4. `资产审计`
   - 资产变更
   - 权限回收
   - 继任历史

## 13.3 前后端实现总图

本方案不能只停留在功能设计，必须明确前后端打通路径。

推荐采用现有仓库已经在推进的统一链路：

```text
gateway/domain services
-> transport/controller
-> semantic aggregator
-> port read model
-> view model
-> UI
```

对本方案而言，应拆成两条主链：

1. `Enterprise 治理主链`
   - 企业管理员发起席位分配、离职、继任、冻结、审批
   - Gateway 持久化对象并记录审计
   - Enterprise Port 拉取 snapshot，经 semantic/read-model 聚合后渲染
2. `Employee 使用主链`
   - 员工登录后只消费“我当前被授予了哪些 seat/space/agent 访问权”
   - Employee Port 不直接管理企业资产，而是消费 seat binding 和 access snapshot 的结果

因此，前端不是直接拼原始接口，后端也不是直接把存储对象裸暴露给 UI。

## 13.4 后端实现蓝图

### 13.4.1 后端职责分层

建议后端按四层组织：

1. `Domain Objects`
   - `PositionSeat`
   - `SeatBinding`
   - `AgentDefinition`
   - `AgentInstance`
   - `AgentSnapshot`
   - `AccessPolicy`
   - `ExecutionPolicy`
   - `ConnectorProfile`
   - `SeatConnectorBinding`
   - `MemoryRecord`
   - `HandoverCase`
   - `HandoverConflict`
2. `Domain Services`
   - 绑定/解绑服务
   - 冻结/恢复服务
   - 继任服务
   - 权限授予服务
   - 记忆分类与审批服务
3. `Gateway Handlers`
   - 提供 HTTP transport
   - 做鉴权、参数校验、状态迁移调用
4. `OpenBot Adapters`
   - 接现有 storage / audit / session / directory 基础设施

### 13.4.2 后端代码落点建议

结合当前代码现状，建议不要把第一版做成大范围拆仓，而是在现有 gateway 和 collaboration adapter 基础上落地。

建议代码落点：

1. `src/gateway/platform-auth.ts`
   - 继续负责员工预创建、激活、成员关系、会话与账号停用
   - 新增与 `employeeProvision -> seat assignment bootstrap` 相关的最小联动
2. 新增 `src/gateway/enterprise-seat-assets.ts`
   - 负责 seat、binding、handover、policy、asset snapshot 的 HTTP handler
3. 新增 `src/gateway/enterprise-seat-assets-store.ts`
   - 负责对象持久化与版本写入
4. `src/gateway/control-ui-contract.ts`
   - 扩展 Enterprise Port 所需 contract 类型
5. `packages/collaboration-core`
   - 继续承接记忆投影、审批、治理 policy helper
6. `packages/collaboration-openbot-adapter`
   - 继续承接 storage / audit / session / directory 接线

也就是说：

- 账号与成员生命周期，尽量复用现有 `platform-auth` 主链
- 岗位席位与智能资产治理，独立成新的 enterprise asset handler
- 记忆、审计、目录、session，不重造基础设施，尽量通过 collaboration adapter 承接

### 13.4.3 后端 API 族建议

第一版建议按“snapshot + command”风格设计，而不是做过细碎的 REST 资源拼图。

建议至少提供以下接口族：

#### `organization/seats`

- `GET /__openbot/enterprise/:tenantId/seats`
  - 返回 seat 列表与 occupancy snapshot
- `GET /__openbot/enterprise/:tenantId/seats/:seatId`
  - 返回单 seat 详情、bound employee、agent instance、connector binding、memory summary
- `POST /__openbot/enterprise/:tenantId/seats`
  - 创建 seat
- `POST /__openbot/enterprise/:tenantId/seats/:seatId/assign`
  - 给 seat 分配员工
- `POST /__openbot/enterprise/:tenantId/seats/:seatId/unassign`
  - 解绑当前员工

#### `organization/handover`

- `POST /__openbot/enterprise/:tenantId/handover/start`
  - 发起交接，冻结写权限
- `GET /__openbot/enterprise/:tenantId/handover/:handoverCaseId`
  - 返回交接详情、冲突、审批状态
- `POST /__openbot/enterprise/:tenantId/handover/:handoverCaseId/review`
  - 审查待继承资产
- `POST /__openbot/enterprise/:tenantId/handover/:handoverCaseId/approve`
  - 批准交接
- `POST /__openbot/enterprise/:tenantId/handover/:handoverCaseId/rebind`
  - 给新员工重绑 seat

#### `organization/access`

- `GET /__openbot/enterprise/:tenantId/access/snapshot`
  - 返回 tenant 内 seat / group / employee 的 access snapshot
- `POST /__openbot/enterprise/:tenantId/access/grant`
  - 下发 access policy
- `POST /__openbot/enterprise/:tenantId/access/revoke`
  - 撤销 access policy

#### `organization/assets`

- `GET /__openbot/enterprise/:tenantId/assets/seat/:seatId`
  - 返回 seat 视角的 AgentDefinition / AgentInstance / AgentSnapshot 汇总
- `POST /__openbot/enterprise/:tenantId/assets/agent-instance/:instanceId/freeze`
  - 冻结实例写入与执行
- `POST /__openbot/enterprise/:tenantId/assets/agent-instance/:instanceId/archive`
  - 归档实例

#### `organization/memory`

- `GET /__openbot/enterprise/:tenantId/memory/seat/:seatId`
  - 返回 seat 共享记忆摘要
- `POST /__openbot/enterprise/:tenantId/memory/classify`
  - 对候选记忆做自动分类建议
- `POST /__openbot/enterprise/:tenantId/memory/:memoryId/promote`
  - 提升为可继承资产
- `POST /__openbot/enterprise/:tenantId/memory/:memoryId/block`
  - 阻断继承

#### `organization/connectors`

- `GET /__openbot/enterprise/:tenantId/connectors/seat/:seatId`
  - 返回 `ConnectorProfile + SeatConnectorBinding` 快照
- `POST /__openbot/enterprise/:tenantId/connectors/binding/:bindingId/rebind`
  - 继任员工重新授权
- `POST /__openbot/enterprise/:tenantId/connectors/binding/:bindingId/revoke`
  - 撤销 binding

### 13.4.4 后端状态迁移原则

所有 command 接口必须走状态机，不允许 controller 直接“改字段”。

例如：

1. `offboard employee`
   - 停用账号
   - 撤销 session
   - 撤销 access policy
   - 冻结 agent instance
   - 生成 handover case
2. `rebind successor`
   - 校验 seat 当前状态
   - 校验交接审批完成
   - 重建 access policy
   - 生成新的 seat binding
   - 解除实例冻结

建议每个 command 都返回：

- `ok`
- `updatedSnapshot`
- `auditId`
- `conflicts`

这样前端无需二次拼装就能刷新界面。

## 13.5 前端实现蓝图

### 13.5.1 前端代码落点建议

当前浏览器端已经具备：

1. 统一路由层：`ui/src/ui/navigation.ts`
2. 四端 app shell：`ui/src/ui/app-render.ts`
3. Employee Port：`ui/src/ui/ports/employee/**`
4. Enterprise Port 骨架：`ui/src/ui/ports/enterprise/**`

因此本方案不应再另起一套页面系统，而应直接落在 Enterprise Port 和 Employee Port 里。

建议代码落点：

1. `ui/src/ui/navigation.ts`
   - 增加 enterprise 下的细分模块路由
2. `ui/src/ui/ports/enterprise/semantic/`
   - 新增 seat、handover、asset、access、audit read-model
3. `ui/src/ui/ports/enterprise/render-model.ts`
   - 把 raw snapshot 聚合成 enterprise-specific render model
4. `ui/src/ui/ports/enterprise/views/`
   - 新增席位列表、交接详情、资产详情、权限详情页面
5. `ui/src/ui/ports/employee/render-model.ts`
   - 只补员工当前 seat binding 和 granted access 的消费能力
6. `ui/src/ui/ports/employee/views/workbench-stage-module.ts`
   - 个人设置里展示当前岗位绑定的只读信息

### 13.5.2 Enterprise 前端模块建议

建议在 Enterprise Port 增加以下 UI 模块：

1. `Seats`
   - 席位列表
   - 空岗/在岗/交接中状态
2. `Seat Detail`
   - 当前员工
   - agent instance
   - connector binding
   - memory summary
3. `Handover Center`
   - 离职交接单
   - 冲突处理
   - 审批状态
4. `Access`
   - 资源访问策略
   - 代班授权
   - 撤销记录
5. `Audit`
   - 交接链路
   - 责任追踪

### 13.5.3 Employee 前端模块建议

员工端只做消费，不做治理。

建议只增加：

1. 个人设置中的“当前岗位席位”
2. “我当前服务的岗位机器人/空间”只读摘要
3. 在工作台首屏根据 seat binding 自动恢复默认 agent/space
4. 若 seat 被回收或冻结，工作台显示明确的只读或阻断提示

## 13.6 前后端打通规则

### 13.6.1 路由与上下文

Enterprise 相关功能必须走 tenant-bound 路由，不允许无 `tenantId` 裸开。

建议路由形态：

- `/enterprise/:tenantId/organization/seats`
- `/enterprise/:tenantId/organization/seats/:seatId`
- `/enterprise/:tenantId/organization/handover`
- `/enterprise/:tenantId/organization/handover/:handoverCaseId`
- `/enterprise/:tenantId/agents/assets`
- `/enterprise/:tenantId/audit/assets`

Employee 侧不引入治理型 URL，只消费当前登录员工可见的 seat summary。

### 13.6.2 状态同步

前端不要把交接状态散落在页面局部 state 里，必须采用：

`command -> reload snapshot -> rebuild read model -> rerender`

也就是说：

1. 用户点击“发起离职交接”
2. 前端调用 command endpoint
3. 后端返回 `updatedSnapshot + auditId + conflicts`
4. 前端重建 semantic/read-model
5. Enterprise 与 Employee 视图都从新 snapshot 收敛

### 13.6.3 Read Model 约束

前端页面不直接消费 raw payload。

必须经过：

1. transport payload
2. semantic aggregator
3. port read model
4. view model

原因：

1. 企业端同一个 seat 详情会混合 seat、employee、agent、memory、connector、audit 多类对象
2. 若直接在 view 层拼装，后续会再次回到混层状态

### 13.6.4 Employee / Enterprise 数据边界

前端 contract 必须硬性区分：

1. `enterprise snapshot`
   - 含治理对象与审批对象
2. `employee access snapshot`
   - 只含该员工当前可见的 seat/space/agent 摘要

不要让 Employee Port 拉完整 enterprise asset payload 再在前端裁剪。

## 13.7 第一版前后端联调闭环

如果要尽快落第一版，建议先打通下面这条最短闭环：

1. 企业管理员预创建员工
2. 企业管理员创建/选择一个 `PositionSeat`
3. 企业管理员把员工分配到该 seat
4. Backend 自动创建：
   - `SeatBinding`
   - 最小 `AccessPolicy`
   - seat asset snapshot
5. 员工首次登录后，Employee Port 能显示：
   - 当前 seat
   - 当前默认 agent
   - 当前默认协作空间
6. 企业管理员发起离职：
   - 账号停用
   - SeatBinding 撤销
   - AccessPolicy 撤销
   - AgentInstance 冻结
   - HandoverCase 生成
7. 企业管理员为新员工执行继任：
   - 新建 SeatBinding
   - 重建 AccessPolicy
   - AgentInstance 解冻
   - Employee Port 自动恢复岗位上下文

只要这条链能稳定跑通，系统就已经从“概念方案”变成“可实施方案”。

## 13.8 联调测试要求

该方案必须从一开始就按前后端联调视角验收，而不是只写后端对象或只做前端页面。

建议至少覆盖以下测试：

### 后端

1. seat 分配状态机测试
2. offboard / handover / rebind 状态迁移测试
3. access policy 授予与撤销测试
4. connector rebind 测试
5. memory classify / promote / block 测试
6. audit event / audit edge 测试

### 前端

1. Enterprise Port resolver 与 tenant-bound 路由测试
2. seat 列表与详情 read-model 测试
3. handover command 后 snapshot 重建测试
4. Employee Port 收到冻结 seat 后的只读/阻断显示测试
5. 个人设置中的当前岗位绑定展示测试

### 端到端

1. 员工激活 -> seat 分配 -> 首次登录看到岗位上下文
2. 离职 -> access 撤销 -> 旧员工不能继续写岗位资产
3. 新员工继任 -> connector rebind -> 岗位资产恢复

## 14. 最佳实施策略

不建议第一版就做完整“大而全”的组织数字劳动力系统。

建议按以下三期落地：

### Phase 1: 必须成功的核心闭环

目标：

1. 企业内业务机器人默认企业所有
2. 引入 `PositionSeat`
3. 引入 `SeatBinding`
4. 引入最小可用 `AccessPolicy`
5. 支持离职后的基础冻结机制
6. 个人设置与企业治理边界定清

本期刻意不做：

1. 自动记忆分类
2. 复杂 ABAC 条件
3. 完整审计图谱

### Phase 2: 真正形成业务价值

目标：

1. 打通员工离职 -> 席位解绑 -> 资产冻结 -> 新员工继任
2. 引入 `ConnectorProfile` 与 `SeatConnectorBinding`
3. 提供继任预览与继任摘要
4. 提供人工确认版的记忆分类
5. 支持基础冲突处理

### Phase 3: AI-native 操作系统能力

目标：

1. 自动 memory classification
2. `CapabilityProfile` 与 `SeatBaselineSnapshot`
3. `ExecutionPolicy` 精细控制
4. `AgentDefinition / AgentInstance / AgentSnapshot` 完整分层
5. `AuditEdge` 图谱与责任追踪
6. trust score / memory decay / 风险推荐

## 15. 关键决策建议

以下事项建议本轮直接定版：

1. 企业租户内创建、用于业务执行的机器人，默认企业所有。
2. 企业资产的稳定宿主不是员工，而是岗位席位、空间或企业作用域。
3. 岗位继任必须围绕 `PositionSeat` 进行，而不是围绕“把某个员工名下机器人转给另一个员工”进行。
4. 个人设置不承接离职交接与企业资产迁移。
5. 共享岗位记忆允许继承，个人私有记忆默认不继承。
6. 连接器配置可继承，但基于个人身份的授权必须重绑。
7. 必须引入显式 `AccessPolicy`，把“所有权”和“使用权”拆开。
8. 必须逐步引入 `ExecutionPolicy`，限制 AI 可执行动作。
9. 离职时应冻结岗位资产写入，防止旧员工继续污染岗位记忆。
10. 继任必须有审计与审批链。
11. 记忆治理必须从语义分层升级为可计算协议。

## 16. 最终结论

从用户价值、企业治理、安全与长期维护成本综合判断，最佳方案不是“员工拥有机器人，离职时做转移”，而是：

`企业拥有资产 -> 岗位席位承载资产 -> 员工临时绑定席位并使用资产`

这套模型有五个优势：

1. 企业资产不会随着人员流动丢失。
2. 继任不是迁移数据，而是更换席位当前使用者。
3. 个人隐私与企业资产可以清晰分层。
4. 离职、继任、审计、冻结、恢复都有统一状态机。
5. 员工端和企业端的职责边界清晰，不会把个人设置做成治理台。

但这次修订也明确补上了三个此前不够闭合的支柱：

1. `Policy Layer`
   - 回答“谁可以让 AI 做什么”
2. `Agent Decomposition`
   - 回答“AI 资产如何版本化、实例化、回滚”
3. `Memory Ownership Protocol`
   - 回答“哪些记忆可继承、可审批、可阻断”

因此，建议专家评审时优先审查以下三点：

1. 是否确认“岗位席位”作为稳定宿主。
2. 是否确认“企业资产默认企业所有”的强规则。
3. 是否确认必须同时引入 `AccessPolicy + Agent 分层 + Memory Protocol` 作为企业级实施前提。
