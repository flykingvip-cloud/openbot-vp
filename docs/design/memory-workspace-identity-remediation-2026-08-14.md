# OpenBot 平台工作区架构与记忆索引隔离整改方案

| 字段                 | 内容                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **状态**             | **Phase 0 Closed · Phase 1A Closed · Phase 1B Admission Evidence In Progress · Phase 1B Unlock Not Issued · LIVE Forbidden**                                                          |
| **日期**             | 2026-08-14；头部状态同步 2026-08-17                                                                                                                                                   |
| **性质**             | 事故整改 + 平台工作区资源架构 + 可执行迁移计划                                                                                                                                        |
| **适用范围**         | PersonalLocal、ManagedEnterprise、企业租户、部门、员工、AI 数字人、协作小组、记忆与派生索引                                                                                           |
| **生产样本（脱敏）** | tenant `001` · agent `bot-2` · ownerId `90fed19a-…`                                                                                                                                   |
| **关联基线**         | 数据治理架构 v2（`openbot-data-governance-architecture-v2-2026-08-10.md`，未进树） · [工作区目录隔离核查](./workspace-directory-isolation-audit-2026-08-10.md)                        |
| **建议结论**         | Phase 0 / Phase 1A 已关闭。Phase 1B 正在收准入证据，**unlock 未签发**。items 2 / 4 / 5 / 6 / 7 仍 not-met。禁止 LIVE，禁止把本头部同步、§14.1 签署或 fixture Stage B 解释为写路径授权 |

> **执行冻结：** 当前只授权 Phase 0 只读 inventory、调用点盘点、Catalog candidate 离线生成、v1 SQLite 风险识别、unknown/quarantine 清单和非破坏性事故保险门禁。禁止修改 LIVE schema、切换 Resolver、写入新身份/Binding 字段、重索引、撤 overlay、搬迁或删除旧目录。
>
> **阅读说明（2026-08-17）：** 方案头部已同步为 Phase 0 Closed / Phase 1A Closed / Phase 1B Admission Evidence In Progress / Unlock Not Issued / LIVE Forbidden。§0.4 及以下 2026-08-14 复审原文保留，不改签署结论。本同步不授权写开关、schema v2、把 Phase 0 inventory 写入 Catalog、打开 miss=deny，或 I3 Retirement。

---

## 0. 决策摘要

### 0.1 必须做什么

1. 将 OpenBot 的工作区从“由路径隐式表示归属”升级为“稳定资源身份 + 权威授权 + 可切换存储绑定”。
2. 建立租户、部门、员工、AgentAsset、协作小组五类资源 scope，但不将可变组织树直接复制成物理目录树。
3. 运行时只通过 Workspace Resource Resolver 获得授权资源句柄；禁止调用方自行拼接租户路径。
4. 工具 cwd、记忆根、continuity 根、artifact 根共享同一业务身份，但分别授权，不强制为同一物理路径。
5. 记忆 files/chunks/FTS/vector/search/prune/status/reset 全链路按稳定 `workspace_id` 隔离。
6. 旧数据不猜测归属；不可证明的行和目录进入 quarantine，不参与正常读写。
7. 迁移以稳定资源为单位，用持久状态机、fencing token、校验回执和回滚窗口完成原子切换。

### 0.2 不可接受的简化

- 不能只修 `get-reply` 的路径解析。
- 不能只给 `files` 表加一列。
- 不能用 realpath hash 作为长期资源身份。
- 不能将工具 cwd 的授权等同于记忆目录归属。
- 不能把旧 sqlite 行整体回填给“迁移时恰好打开它的 manager”。
- 不能让 ManagedEnterprise 在身份或 Catalog 解析失败时回退 canonical workspace。

### 0.3 唯一体系裁决（2026-08-14 可行性复审）

**终态只允许一套工作区管理体系。** 本方案是对现有 `src/gateway/workspace-resolver/**` + Catalog + StorageBinding 的升级替换，不是再并列一条“记忆专用解析管”或第二套 Catalog。

| 裁决              | 内容                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **唯一入口**      | 所有持久工作区读/写/cwd/memory/continuity/watch/index 只消费 `resolveWorkspaceResource` 返回的受限句柄                                             |
| **唯一身份**      | 持久字段仍为治理 Envelope 的 `resourceId`；`WorkspaceId` 仅是 TypeScript 语义别名。外部别名只进 alias 表，不参与授权、索引分区或 Binding 主键      |
| **唯一 Envelope** | `DataGovernanceEnvelope` 是 tenant/owner/scope/classification/lifecycle/version 唯一 SoT；Workspace 仅添加受约束的域扩展                           |
| **唯一 Catalog**  | Data Governance Catalog 为目标 SoT；现有 `WorkspaceResourceCatalog` 通过 adapter 作只读兼容投影，不得独立持久写入                                  |
| **唯一布局**      | §4 目标物理树；旧 `workspace-{agentId}`、扁平 `OpenBot/workspace`、host canonical 只做 migration input                                             |
| **唯一分类**      | 沿用治理已冻结的 `user_owned / position_owned / group_owned / employee_private / unknown`；方案中的 kind 是这些 scope 的展示别名，不得并行两套枚举 |
| **旧支命运**      | 先冻结新增 → 影子对照 → 按资源迁到 binding → 断写/断 watch → I3 退役删除。禁止“新旧长期双轨”                                                       |

**本阶段明确不做（避免再分叉）：** 不新增 `resolveAgentRuntimeWorkspaceDir` / `__resolveMemoryWorkspaceDir` / 按目录拆 sqlite 作为主方案；不把 department 做成 users/agent-assets 的物理父目录；不把 BYOS/多后端做成 P0。PersonalLocal 与 ManagedEnterprise 共用同一 Resolver API。P0 存储绑定沿用现有 `WorkspaceBindingRecord`；`storageKind` 等扩展见附录 A，不得混入 P0 契约。

### 0.4 专家组签署记录（2026-08-14）

| 项                                           | 结论                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| 目标架构                                     | **有条件通过**                                                                     |
| 唯一 Resolver/Catalog                        | **通过**，必须升级现有实现，禁止并行第二套                                         |
| 组织树与资源树分离                           | **通过**                                                                           |
| P0 范围                                      | **通过**：`employee_private`、`agent_primary`、`group_shared`、memory schema v2    |
| 部门共享 / BYOS                              | 只冻结身份类型，**不进入 P0 数据迁移**                                             |
| 立即修改 LIVE                                | **不通过**                                                                         |
| Phase 0 只读盘点                             | **可以启动**                                                                       |
| 新 helper / 新 overlay / 新现场 Catalog 合成 | **立即冻结**                                                                       |
| 2026-08-14 二次复审                          | **Changes Required**：无已提交包、Phase 0 未完成、inventory 覆盖不足、三处契约需改 |

二次复审后的诚实状态：方案方向仍成立，但 **Phase 0 执行验收未通过**。已提交的只读证据只供复审，不得当作退出门禁。LIVE 施工仍受 §14.1 约束。

### 0.5 数据治理 SoT 裁决

1. 不新建 `WorkspaceIdentity`、`WorkspaceCatalogRecord.identity` 或 workspace 专用 lifecycle SoT。
2. 工作区是 `resourceType="workspace"` 的 `DataGovernanceEnvelope` typed view；workspace kind 和 AgentAsset/group/user 关联是域扩展或权威 Registry 关系。
3. Workspace memory root/index 是工作区的授权子路径与派生表示；Memory Asset 是独立治理资源，两者不共用资源 ID。
4. 资源 lifecycle 沿用数据治理 v2；copy/verify/cutover/recovery 只存在于现有 workspace cutover/migration receipt。
5. Phase 1 前必须实现治理 Catalog SoT 和 Workspace adapter，完成 candidate bootstrap/coverage/conflict/unknown 门禁；不得假设该 SoT 已在生产存在。
6. 本次修订重新签署前，Phase 1+ 任务均为 blocked，不得通过“先加兼容字段”绕过。

---

## 1. 事故背景与当前基线

### 1.1 已坐实的事故链

2026-08-13 起，生产出现“记忆索引不可用 / 检索像没记性”：

1. 真实记忆在租户树，canonical `~/.openbot/workspace-bot-2` 几乎为空。
2. 租户树强制索引后达到 50 文件 / 166 chunks / 1024 维。
3. 后续一次 canonical workspace sync 将同一 `bot-2.sqlite` 中的租户行当成 stale 删除，只剩 1 文件 / 2 chunks。
4. status 仍报 `Dirty=no`，因为 dirty 只表示上次 sync 成功，不表示盘上集合与库内集合一致。
5. continuity checkpoint 同时写入 canonical 树，证明对话 cwd 与记忆身份已分裂。

向量 provider 已可用，当前主故障不是 embedding，而是：

> 同一 `agentId` 对应多个 workspace，多个 manager 共享一个无分区 sqlite，任一 sync 都能以自己看到的目录为全集跨身份 prune。

### 1.2 主干与当前 WIP 现状

| 能力                     | 现状                                                             | 本方案要求                               |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------- |
| ManagedEnterprise Gate 0 | 已有专用 tenant root 与 fail-closed 基线                         | 保留，不得被 workspace fallback 绕过     |
| Workspace Resolver       | 已有资源解析、group read、tool cwd 授权与 cutover WIP            | 升级为所有持久 workspace 的唯一入口      |
| 数字人身份               | 已定义稳定 `agentAssetId`，盘上仍存在 `workspace-{agentId}` 分裂 | 物理根收敛到稳定资源绑定                 |
| 员工 steward             | 存在 source/target/cutover 并行路径                              | 作为 employee-private 系统例外显式建模   |
| 协作小组                 | tenant-scoped group 路径与 ACL 正在收敛                          | 作为独立资源，不挂在某个员工或部门目录下 |
| builtin memory           | DB 通常按 agentId 共享；`files.path` 和 `chunks.id` 全局唯一     | 全链路 `workspace_id` 分区               |
| dirty/status             | 进程内布尔值                                                     | 变为可校验状态机                         |

### 1.3 系统性根因

1. 业务身份、授权 scope、物理路径和索引主键没有分开。
2. `agentId`、userId、ownerId、sessionKey 被不同调用点用作替代身份。
3. 组织关系与存储关系混合，导致换岗、转部门、小组跨部门都需要猜测目录归属。
4. 共享可变索引执行“按缺席删除”，却没有 workspace 分区键。
5. 历史兼容 fallback 在 managed 环境里被当成正常路由。

---

## 2. 架构原则与不变量

| ID      | 不变量                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------- |
| **W1**  | 无稳定治理 `resourceId`（代码别名 `WorkspaceId`）的持久 workspace 不得写入；禁止并行第二个资源主键 |
| **W2**  | 物理路径、realpath、display name、agentId 和 checksum 都不是资源身份                               |
| **W3**  | 授权先于路径解析；不先解析用户输入路径再补授权                                                     |
| **W4**  | 一个资源的每个 canonical role 同时最多一个可写 binding                                             |
| **W5**  | 部门是 scope 和授权维度，不是员工、AgentAsset 或 group 的不可变物理父目录                          |
| **W6**  | 员工转部门只改 membership；数字人交接只改 binding；小组跨部门只改 grants                           |
| **W7**  | 工具 cwd、memory、continuity、artifact 共享身份不等于共享路径或能力                                |
| **W8**  | ManagedEnterprise 的 tenant/context/catalog/binding/authorization 任一 unknown 均 fail closed      |
| **W9**  | 任一 prune/reset/rebuild 不得改变其他 `workspace_id` 的行                                          |
| **W10** | 安全过滤和 lifecycle 过滤必须在语义检索排名前执行                                                  |
| **W11** | 索引、缓存和 runtime 是派生数据，不能反向成为归属 SoT                                              |
| **W12** | 迁移只改 StorageBinding，不改变 ResourceIdentity                                                   |

---

## 3. 平台工作区资源模型

### 3.1 组织树与资源树分离

```text
组织与授权树                         稳定资源与存储

Platform                               platform resources
└─ Tenant                             tenants/<tenantId>/...
   ├─ Department                       departments/<departmentId>/...
   │  └─ memberships/grants            (只保存部门共享资源)
   ├─ Employee                         users/<userId>/...
   ├─ AI Digital Human                agent-assets/<agentAssetId>/...
   └─ Collaboration Group             collaboration/groups/<groupId>/...
```

员工、AgentAsset 和 group 是 tenant 下的并列稳定资源。它们通过 Catalog 中的 membership、binding 和 grants 参与部门，不通过嵌套物理目录表示归属。

### 3.2 工作区类型

| workspace kind      | 所有者         | scope              | 主要内容                                    |
| ------------------- | -------------- | ------------------ | ------------------------------------------- |
| `tenant_shared`     | tenant         | tenant             | 企业模板、共享知识、企业产物                |
| `department_shared` | tenant         | department         | 部门 SOP、共享知识、部门交付物              |
| `employee_private`  | user           | user               | steward、私人记忆、私人草稿和会话           |
| `agent_primary`     | tenant 或 user | agent_asset        | 岗位/个人数字人的长期连续性与正式工作区     |
| `agent_interaction` | user           | user + agent_asset | 某员工与某 Agent 的私人交互、草稿和个人记忆 |
| `group_shared`      | tenant         | group              | 显式投递的共享上下文、小组记忆和产物        |

### 3.3 工作区治理契约（Envelope typed view）

`DataGovernanceEnvelope` 是工作区 tenant、owner、scope、classification、lifecycle、legal hold 和 governance version 的唯一 SoT。本方案不持久化第二份 `WorkspaceIdentity`。

```ts
type WorkspaceId = string;

/** Typed view only. Envelope.identity already carries resourceId / resourceType / schemaVersion. */
type WorkspaceEnvelope = DataGovernanceEnvelope & {
  resourceType: "workspace";
  extension: WorkspaceExtension;
};

type WorkspaceExtension = {
  workspaceKind:
    | "tenant_shared"
    | "department_shared"
    | "employee_private"
    | "agent_primary"
    | "agent_interaction"
    | "group_shared";
  agentAssetId?: string;
  departmentId?: string;
  groupId?: string;
  userId?: string;
};

/** 仅外部展示/对接。不得参与授权、索引分区或 StorageBinding 主键。 */
type WorkspaceAlias = {
  aliasId: string;
  resourceId: WorkspaceId;
  aliasType: "opaque_external" | "legacy_path" | "display";
};
```

磁盘 manifest、Catalog、receipt 和 RPC 继续使用持久字段 `resourceId`。`WorkspaceId` 只是代码内对 workspace resource ID 的类型别名，不是新字段。SQLite `workspace_id` 保存该 `resourceId` 的值，仅作为源工作区索引分区键。

`workspaceKind` 是 workspace 域扩展，必须可确定性映射到治理 owner/scope，不得成为第二套归属 SoT：

| kind                                  | 治理 `ownerScope`                      | P0                   |
| ------------------------------------- | -------------------------------------- | -------------------- |
| `employee_private`                    | steward 系统例外（employee isolation） | 是                   |
| `agent_primary`                       | `user_owned` 或 `position_owned`       | 是                   |
| `group_shared`                        | `group_owned`                          | 是                   |
| `agent_interaction`                   | 挂在 user + agentAsset，默认不继承     | 类型冻结，数据迁后置 |
| `tenant_shared` / `department_shared` | tenant / department scope              | 只冻类型，不迁数据   |

本方案 **不重新定义** 治理 `OwnershipPrincipal`。`WorkspaceEnvelope.owner` 直接引用数据治理 Envelope 的 `owner` 字段，不得在本文件另写一套枚举。

当前运行时工作区分类沿用已落地的 `WorkspaceOwnerScope`（`src/gateway/workspace-ownership/types.ts`）：

```ts
type WorkspaceOwnerScope =
  | { kind: "user_owned"; userId: string; agentAssetId: string; proof: OwnershipProof }
  | { kind: "position_owned"; seatId: string; agentAssetId: string }
  | { kind: "group_owned"; groupId: string }
  | { kind: "unknown"; reason: string };
```

这与专家组认定的当前治理 owner 语义 `user | position | group | system` 对齐：position / group 已是现行分类，不是本方案新造的 owner 类型；`system` 行为继续由 steward 例外与 Envelope 的 controller/custodian/createdBy 表达。治理架构文档 v2 §6.2 仍写 `platform | tenant | user`，那是治理文档与现行模型的既有差异，**本方案不得自行裁决或再定义第三套 owner**。新增 `tenant` / `platform` owner 必须走独立 schema 评审，不能借本整改混入。

PersonalLocal 使用同一 `resourceId` 契约；`tenantId` 可为明确的 local sentinel，但不能伪装成 managed tenant。路径、邮箱、显示名、裸 `userId`、`agentId` 都不是身份。

### 3.4 AgentAsset 和小组契约

- 普通数字人一律用 `agentAssetId`；`agentId` 仅是 tenant-scoped 运行时 slug。
- steward 是 `employee_private` 系统例外，不得被猜测成岗位 AgentAsset。
- 换岗/交接更新 `positionId/seatId -> agentAssetId` binding，不搬数字人主资产。
- group 是 tenant-scoped 独立资源，`homeDepartmentId` 只是管理属性。
- user private 数据进入 agent primary 或 group 只能通过显式 `publish/promote` 操作，必须有授权和审计回执。

---

## 4. 目标物理布局

```text
<data-root>/
├── platform/
│   ├── catalog/
│   ├── tenant-directory/
│   ├── policy/
│   └── audit/
└── tenants/<tenantId>/
    ├── tenant.json
    ├── catalog/
    ├── policy/
    ├── audit/
    ├── credentials/                         # 只保存引用/密文，不进 workspace
    ├── organization/
    │   ├── departments/<departmentId>/
    │   │   ├── manifest.json
    │   │   ├── workspace/
    │   │   ├── knowledge/
    │   │   └── artifacts/
    │   └── memberships/
    ├── users/<userId>/
    │   ├── manifest.json
    │   ├── private/
    │   │   ├── workspace/
    │   │   ├── memory/
    │   │   ├── conversations/
    │   │   └── artifacts/
    │   └── agent-interactions/<agentAssetId>/
    │       ├── conversations/
    │       ├── drafts/
    │       └── personal-memory/
    ├── agent-assets/<agentAssetId>/
    │   ├── manifest.json
    │   ├── identity/
    │   ├── workspace/
    │   ├── memory/
    │   ├── conversations/
    │   ├── artifacts/
    │   ├── runtime/
    │   └── indexes/
    ├── collaboration/groups/<groupId>/
    │   ├── manifest.json
    │   ├── workspace/
    │   ├── memory/
    │   ├── conversations/
    │   ├── artifacts/
    │   ├── membership/
    │   └── indexes/
    ├── migration/
    ├── quarantine/
    └── archive/
```

### 4.1 物理布局约束

1. 不将 users/agent-assets/groups 嵌套到 department 下，避免组织调整引发数据搬迁。
2. tenant root 与全局 config/state/credential root 不得 alias。
3. `runtime/` 和 `indexes/` 是可重建数据，默认不进跨存储搬迁包。
4. 凭证不得作为 workspace 文件迁移；只迁移受治理的 credential reference。
5. 旧 `workspace-{agentId}`、扁平 user workspace 和 canonical host workspace 只是 migration input，不是并列 SoT。

---

## 5. Catalog、StorageBinding 与 Resolver

### 5.1 Data Governance Catalog 与 StorageBinding

Data Governance Catalog 是目标唯一 SoT。现有 `WorkspaceResourceCatalog` 在迁移期只能作为由治理 Catalog 生成的只读兼容投影：

```text
Data Governance Catalog
  -> WorkspaceCatalogAdapter
  -> resolveWorkspaceResource
  -> constrained handle
```

在治理 Catalog store、Workspace adapter、cache invalidation 和 degraded-read 契约实际落地前，Phase 1 不得切换。现有内存 Workspace Catalog 不得被宣称为已落地的治理 SoT，也不得继续独立持久写入。

P0 沿用 **当前精确类型** `WorkspaceBindingRecord`（`src/gateway/workspace-resolver/types.ts`），不改写、不丢字段、不混入未落地字段：

```ts
type WorkspaceBindingRole = "canonical" | "compatibility";
type WorkspaceBindingState = "active" | "read_only" | "retired";

type WorkspaceBindingRecord = {
  bindingId: string;
  resourceId: string;
  role: WorkspaceBindingRole;
  locator: string;
  state: WorkspaceBindingState;
  contentVersion: string;
};
```

治理架构文档 v2 的更宽 `StorageBinding`（`region` / `encryptionKeyRef` / `checksum` / `createdAt` / `updatedAt`、`migrating` / `failed`、`read-only`、无 `compatibility`）**不是** P0 契约。那些字段只允许出现在附录 A「后续 schema proposal」，必须另走 Binding 影响矩阵与 schema 评审。fencing 仍属于现有 workspace cutover guard，不在未迁移的 Binding 记录上直接加字段。

对一个 workspace resource：

- active canonical filesystem binding 表示工作区内容 SoT。
- `workspace | memory | conversations | artifacts | runtime | indexes` 是该 canonical root 下的授权 `WorkspaceDataRole`，不是第二个 StorageBinding role 维度。
- sqlite/FTS/vector 在 P0 仍是源 workspace 的派生索引，挂在同一 `resourceId` 下；独立 `derived` StorageRole 属于附录 A，不是当前 `WorkspaceBindingRole`。
- 若未来某个 data role 需要独立 BYOS、retention 或 lifecycle，应升级为独立治理资源并通过 relation 关联，不在同一 workspace 上叠加多个 canonical 真相。

Binding schema 任何升级必须先覆盖 Catalog 版本迁移、lifecycle/deletion receipt、purge/archive/forget adapter、Resolver cache key、export/import、canonical 唯一性、回滚与旧进程 fail-closed。该影响矩阵未签署前不得改变持久 Binding schema。

### 5.2 唯一解析管

```ts
type ResolveWorkspaceRequest = {
  securityContext: AuthoritativeSecurityContext;
  operation: WorkspaceOperation;
  resourceRef: {
    resourceId?: WorkspaceId;
    agentAssetId?: string;
    groupId?: string;
    departmentId?: string;
    userId?: string;
  };
};

type ResolvedWorkspaceHandle = {
  envelope: WorkspaceEnvelope;
  canonicalBinding: WorkspaceBindingRecord;
  roots: Partial<Record<WorkspaceDataRole, AuthorizedPath>>;
  capabilities: Set<WorkspaceCapability>;
  catalogVersion: number;
  cutoverFence?: WorkspaceCutoverFence;
};
```

解析顺序必须是：

```text
Authenticated actor/service
  -> authoritative TenantContext
  -> tenant-scoped exact resource mapping
  -> Catalog identity and lifecycle
  -> membership/binding/grant
  -> policy decision
  -> active WorkspaceBindingRecord
  -> constrained workspace handle
```

禁止：

- 客户端通过 RPC 选择 tenant 或物理根。
- 用 `agentId` 模糊枚举或跨租户查找 AgentAsset。
- 在 managed 中对 Catalog 缺失、多绑定或 resolver 失败回退 canonical。
- 将“路径位于 tenant root 中”当作充分授权证明。
- 请求路径现场合成 Catalog 条目（含空 Catalog + `buildUserOwnedWorkspaceCatalogEntry`）。

### 5.3 cwd 与数据根的正确关系

| 能力             | 解析输出                                | 不得替代它的信号               |
| ---------------- | --------------------------------------- | ------------------------------ |
| tool execution   | `toolCwd` + `tool.execute`              | memory root、ownerId、目录存在 |
| memory source    | `memoryRoot` + `memory.read/write`      | tool cwd、agentId              |
| continuity       | 按 agent/group scope 授权的 root        | 当前进程 cwd                   |
| artifact publish | 目标 artifact root + `artifact.publish` | 相对路径或模型声明             |

同一次 operation 中的句柄必须有一致 `tenantId/resourceId/catalogVersion/canonicalBinding`，但 group continuity 等合法跨资源写入必须通过第二个显式授权句柄，不用“所有 realpath 必须相同”的错误不变量。

### 5.4 Catalog 离线 bootstrap（启用 miss=deny 的前置）

“Catalog miss 即 deny”是正确 **终态**，不是可以立刻打开的开关。现有内存 Catalog 未覆盖全部可写资源；请求时若直接停合成，合法流量会中断。

这不是请求期 fallback，也不是第二套 Catalog。它是 Phase 0 → Phase 1 的 **一次性 bootstrap migration**：

```text
权威 Registry / seat / user / group 数据
  → 离线生成 Data Governance Catalog candidate（持久主键 = resourceId）
  → 冲突和 unknown 进入 quarantine
  → 人工/机器门禁确认
  → 持久写入 Catalog
  → coverage 达标
  → 才启用 Catalog miss deny
```

P0 coverage 门槛（全部满足才允许打开 deny）：

| 可写资源               | 门槛                                                      |
| ---------------------- | --------------------------------------------------------- |
| `employee_private`     | **100%** 有 Catalog 记录                                  |
| `agent_primary`        | **100%** 精确映射到 `agentAssetId`（禁止 `agentId` 冒充） |
| `group_shared`         | **100%** 有 tenant-scoped group binding                   |
| `conflict` / `unknown` | **100%** 阻断写入并进入清单                               |

未达标前：生产写路径保持现状 + **冻结新增合成**；只读影子对照 candidate。达标后：废除 `tool-cwd.ts` 现场合成，miss 即 deny。该过渡不授权新的长期双写或第二套 Catalog SoT。

---

## 6. 记忆索引隔离设计

### 6.1 分区身份

SQLite `workspace_id` 保存源 Workspace Envelope 的 `resourceId` 值。它是索引隔离分区键，不是新的 Catalog 字段，也不是 Memory Asset `resourceId`。不使用 `sha256(realpath)` 或 alias ID；realpath 只用于受权定位、containment 检查和诊断。

### 6.1.1 必须分开的两种 Memory

| 概念                   | 语义                                             | 治理身份                                                                          |
| ---------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| Workspace memory root  | `MEMORY.md` / `memory/*.md` 的授权文件根         | Workspace Envelope 的 `memory` 数据能力/子路径                                    |
| Workspace memory index | 对上述源文件生成的 sqlite/FTS/vector             | P0：源 Workspace 派生索引，用同一 `resourceId` 分区；独立 `derived` role 见附录 A |
| Memory Asset           | CogniWeave MemoryAtom、Experience 及认知治理对象 | 独立 `resourceType="memory"` 治理 Envelope                                        |

Memory Asset 通过 `sourceWorkspaceResourceId`、`sourceDocumentId`、`sourceContentVersion` 与工作区证据关联。认知提炼、晋升、衰减、forget/purge 不由 workspace 索引 schema 重新定义。

session 不应机械继承当前 workspace key。必须先定义 session visibility scope：

- employee-private session -> employee interaction workspace。
- agent-primary business session -> agent primary workspace，仅在策略允许时进入可继承记忆。
- group session -> group workspace。
- 归属不明 session -> `legacy-unscoped`，不进正常检索。

### 6.2 schema v2

```sql
CREATE TABLE files_v2 (
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  content_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  index_state TEXT NOT NULL,
  PRIMARY KEY (workspace_id, source, path)
);

CREATE TABLE chunks_v2 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hash TEXT NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_chunks_v2_workspace_source_path
  ON chunks_v2(workspace_id, source, path);
```

chunk ID 必须包含 `workspace_id`：

```text
sha256(workspace_id, source, path, startLine, endLine, chunkHash, model)
```

FTS v2 增加 `workspace_id UNINDEXED`。vector 表可继续以全局唯一 chunk ID 关联，但向量候选与 chunks join 后必须再按 `workspace_id` 限制。embedding cache 可继续按 provider/model/provider_key/content hash 共享，因为它不表示资源归属。

### 6.3 所有数据操作必须分区

| 操作                           | 强制条件                                                      |
| ------------------------------ | ------------------------------------------------------------- |
| file upsert                    | `workspace_id + source + path`                                |
| chunk delete/upsert            | `workspace_id + source + path`                                |
| FTS insert/search/delete       | `workspace_id`                                                |
| vector candidate/search/delete | 通过 scoped chunk IDs，不得返回其他 workspace                 |
| prune                          | `WHERE workspace_id = ? AND source = ?`                       |
| status/count                   | 只统计当前授权 workspace                                      |
| force rebuild/reset            | 只重建当前 workspace，禁止无 scope 全表 DELETE                |
| readFile                       | 使用受权 memory handle 做 containment，不只依赖字符串相对路径 |

prune 不变量：

```text
Rows(DB, workspaceId, source)
  <- Rows(DB, workspaceId, source) intersect List(AuthorizedRoot)

Rows(DB, anyOtherWorkspaceId, anySource) remains unchanged
```

### 6.4 dirty 状态机

status 不再只返回一个进程内布尔值：

```ts
type WorkspaceIndexHealth =
  | { state: "clean"; checkedAt: string }
  | { state: "dirty"; missing: number; stale: number; changed: number }
  | { state: "degraded"; reason: string; ftsReady: boolean; vectorReady: boolean }
  | { state: "unknown"; reason: string };
```

校验分两级：

1. 快速集合差：path + size + mtime + index state。
2. 对候选变化文件计算 content hash。

检查失败必须是 `unknown`，不得报 clean。FTS-only 成功但 vector 失败应报 degraded，不能仅因 files 行存在就报完整。

### 6.5 删除保险丝

结构隔离之上再加上线保险丝：

- 当单次 prune 删除比例 > 50% 且活跃文件 <= 2 时拒绝执行，除非携带经审批的 maintenance token。
- 保险丝触发时索引状态变为 `unknown/degraded`，打审计与运维告警。
- 保险丝不代替 workspace_id 分区。

### 6.6 v1 SQLite 多根立即止损门禁

该门禁在 schema v2 前生效，且优先于 50% 删除保险丝：

```text
v1 SQLite + 检测到多个 workspace root
  -> 禁止 sync / prune / reset / rebuild
  -> status = unknown
  -> 只允许已确认单根的受控只读查询
  -> 只有 maintenance/migrate 流程可解锁
```

实现要求：

- 检测不能只是进程内 `Set`；必须使用 DB meta 或受锁 sidecar 记录 root fingerprint，并通过 SQLite transaction/跨进程锁阻止并发绕过。
- root fingerprint 只用于 v1 冲突检测，不是资源身份。
- 旧二进制不识别门禁，因此上线时必须停止旧 writer/watch。
- 已知多根 DB（包括事故样本）在 v2 切换前默认禁用自动破坏性 sync。
- 该止损门禁可作为 Phase 0 独立修复评审，但不授权 schema v2 或 Resolver 切换。

---

## 7. 迁移与原子切换协议

### 7.1 复用现有 workspace cutover 契约

本方案不新建第二套 `WorkspaceMigrationReceipt` 或平行状态机。迁移使用现有 `src/gateway/workspace-cutover/**` 的 durable record/state machine/guards，并通过带版本迁移扩展它。

迁移单位是 Workspace Envelope `resourceId` 对应的 canonical binding。工作区内容子目录作为同一 cutover 的可校验 manifest entries，不为每个 `WorkspaceDataRole` 创建第二套 canonical binding。

现有 cutover record 若缺少下列字段，必须先设计 schema/version migration，不允许调用方私有扩展：

```ts
type WorkspaceCutoverExtension = {
  resourceId: WorkspaceId;
  sourceBindingId: string;
  targetBindingId: string;
  sourceContentVersion: string;
  expectedObjects: number;
  expectedBytes: number;
  checksumManifestRef: string;
  fenceVersion: number;
  rollbackDeadline?: string;
};
```

### 7.2 资源 lifecycle 与 cutover state 分离

- Workspace Envelope lifecycle 沿用数据治理 v2：`active | archived | retired | deletion_pending | deleted/purged | legal_hold`（以最终公共类型为准）。
- `planned | source_read_only | copying | verifying | cutover_ready | cutover | recovery_required | completed | failed` 只是 cutover/migration record 的状态。
- `quarantined` 是归属/安全处置结果，不写入第二个 workspace lifecycle 字段。
- lifecycle、cutover state、StorageBinding state 必须有单向、可审计的转移规则，不得由各调用方同时改写。

### 7.3 写入 fencing

fencing 属于 cutover guard，不在未迁移的通用 `StorageBinding` 上直接添加新字段。

1. cutover 前提升 durable `fenceVersion`。
2. 所有迁移期写句柄携带解析时 fence。
3. workspace cutover guard/存储适配器拒绝低于当前 fence 的写入。
4. 源绑定转只读后才进入最终 copy/verify。
5. 切换后旧进程即使持有旧路径，也无法继续写入。

### 7.4 分类和 unknown 规则

| 旧资源                      | 归属证据                                   | 处理                     |
| --------------------------- | ------------------------------------------ | ------------------------ |
| steward 路径                | 权威 session/user 绑定                     | 迁到 employee_private    |
| 岗位/个人 robot             | tenant-scoped Registry 精确 `agentAssetId` | 迁到 agent primary       |
| group                       | tenantId + groupId + ACL                   | 迁到 group shared        |
| department shared           | tenantId + departmentId + policy           | 迁到 department shared   |
| 扁平/canonical/无元数据目录 | 无法唯一证明                               | quarantine，禁止自动继承 |

严禁依靠 agentId、文件名、目录新旧、mtime 或内容相似度自动判定所有者。

### 7.5 sqlite v1 -> v2 迁移

SQLite 不能通过 `ALTER TABLE ADD COLUMN` 将 `PRIMARY KEY(path)` 变成复合主键。必须重建表：

1. 关闭 manager/watch/sync 写入，确认无在飞任务。
2. 使用 SQLite backup API 生成一致备份；不在 WAL 活跃时只拷贝主文件。
3. `BEGIN IMMEDIATE`，创建 v2 files/chunks/FTS 结构。
4. 所有旧行先进入 `legacy-unscoped`，不做运行时归属猜测。
5. 根据已确认 workspace 从源文件重建 files/chunks/FTS/vector。
6. 写入 `schema_version=2`、chunk-id 算法版本和迁移 receipt。
7. 执行 `PRAGMA integrity_check`、行数、孤儿 chunk、FTS/vector 一致性校验。
8. 原子 rename/commit，再启动新进程。

正常请求路径不得“先读 workspace_id，没命中再读空 key”。`legacy-unscoped` 只允许受控迁移工具读取。

### 7.6 回滚

- cutover 前：取消 target，恢复 source writable，提升 token，不覆盖原数据。
- cutover 后观察期：仅在无 target-only 写入或已完成反向增量合并时允许回滚。
- 超过回滚截止时间：旧 binding 只能归档，不能直接恢复成 canonical。
- 任何回滚都必须生成新 receipt 和新 fencing token。

---

## 8. 可执行分阶段计划

### Phase 0: 冻结、证据与契约定稿

**目标：** 不改 LIVE schema，先使目标资源和现存目录可枚举、可归类、可审计。

任务：

- 审批已修订契约：`DataGovernanceEnvelope` typed view、持久 `resourceId`、Workspace/Memory Asset 边界、单 canonical Binding、Catalog adapter、ResolvedWorkspaceHandle。
- 用只读 inventory 列出 tenant/user/agent/group/canonical 根和 sqlite（P1–P8 调用点）。
- 对每个候选资源输出 `classified | conflict | unknown`，不自动修复。
- 离线生成 Catalog candidate（§5.4），冲突进 quarantine；**不**在请求路径写入 Catalog。
- 冻结新增路径拼接 helper、新 overlay、新现场 Catalog 合成。
- 建立调用点清单：symbol / file / line / read|write|watch|index / profile / replacement / owner / retirement phase。
- 识别 v1 SQLite 多根库并默认停止其破坏性 sync；通用止损门禁作为独立、可回滚修复评审。

产物：契约 PR、inventory summary、归属矩阵、调用点矩阵、Catalog candidate、迁移威胁模型。

退出门禁：Managed 样本无未解释的可写 root；unknown 全部有 quarantine 计划；P0 coverage 报表可复算。

### Phase 1: Catalog 与 Resolver 收敛

> **Execution Blocked：** 数据治理、平台架构、Resolver、Memory 和 SRE 未重新签署 §0.5 / §14.1 前不得实施。

**目标：** 建立治理 Catalog SoT、Workspace adapter 与授权层，暂不搬数据。

任务：

- 实现 Data Governance Catalog/StorageBinding store，建立只读 `WorkspaceCatalogAdapter`，禁止新的并行 Workspace Catalog 写 SoT。
- 将 `agentId -> agentAssetId` 收敛为 tenant-scoped exact mapping。
- Resolver 返回受限句柄，不再只返回 string path。
- tool cwd、memory、continuity、artifact 分别消费句柄中对应 `WorkspaceDataRole` 的授权根。
- **仅当 §5.4 P0 coverage 达标后**，Managed 对 Catalog miss / 多绑定 / tenant 不一致拒绝写入。
- PersonalLocal 保留显式 local identity 兼容层（同一 Resolver API）。

上线策略：shadow resolve，比对旧路径与新 binding，仅记录差异；不在本阶段将无分区 DB 当成安全的多 workspace 存储；不在本阶段打开 miss=deny。

退出门禁：P0 coverage 达标；所有 managed 持久写操作可在日志中对应 tenantId/resourceId/workspaceDataRole/operation/catalogVersion/canonicalBinding/policy decision。

### Phase 2: 记忆 schema v2 与分区语义

**目标：** 使任一误 sync 无法伤害其他 workspace。

任务：

- 实现 files/chunks/FTS/vector 的全链路 `workspace_id`。
- 修改 chunk ID 算法并写入版本。
- 将 prune/search/status/reset/reindex 全部改为 scoped operation。
- 实现 health 状态机和大比例删除保险丝。
- 实现 v1 -> v2 离线迁移器，旧行默认 `legacy-unscoped`。
- 新二进制遇到 v1 DB 只允许进入明确 maintenance/migrate 流程；旧二进制遇到 v2 必须因 schema version fail closed。

发布要求：仅在 Phase 1+ blocked 正式解除后，Phase 1 可先合并作 shadow observation；Resolver **写路径切换** 与 schema v2 必须在同一个生产发布单元内完成。发布单元内部顺序见 §8.6。任一步失败必须在恢复流量前回滚，禁止「新 Resolver + v1 DB」或「旧二进制 + v2 DB」对外服务。

退出门禁：两 workspace 一 sqlite 的误 sync/search/reset 负向测试全绿。

### Phase 3: 工作区物理收敛

**目标：** 将确认资源从旧树迁到稳定目标 binding。

迁移次序：

P0 数据迁移只做 1–3。4–6 只冻类型，不进本发布。

1. 员工 steward `employee_private`。
2. 经 Registry 确认的普通 `agent_primary`。
3. `group_shared`。
4. `department_shared`（P1+，非本发布）。
5. `agent_interaction`（P1+，非本发布）。
6. 剩余 canonical/扁平遗留资源人工裁决。

每一类先 canary，再按 tenant 批次切换。一次只切一个 workspace `resourceId` 的 canonical binding，子目录作为同一校验 manifest，不整个 tenant 盲搬。

退出门禁：新写入只到 target；源端只读；无低 fencing token 写入；源端仍在回滚窗口内保留。

### Phase 4: 索引重建、双实现退役与完整性验收

任务：

- 从 target canonical source 重建记忆索引，不迁移旧派生索引作为 SoT。
- 撤销 LIVE overlay/minified helper 与已重复的旧解析器。
- 断开 canonical host workspace 的 watch/search/write，保留受控只读观察。
- 对 Catalog、binding、盘上 manifest、索引分区、备份和运行时句柄执行一致性检查。

退出门禁：连续一个生产观察期无 canonical 新写入、无跨 workspace prune/search、无 stale binding writer。

### Phase 5: 归档与 I3 退役

- 生成 source retained -> archived -> retired 计划。
- 只在证明目标包含已批准内容、审计回执完整、回滚窗口结束后退役旧路径。
- unknown/quarantine 不因项目关闭而自动删除，必须按保留政策裁决。

### 8.6 同一发布单元的固定切换顺序

Resolver 写路径切换与 sqlite v2 **同一生产发布单元**。单元内部必须按下列顺序执行；任一步失败都在恢复流量前回滚。

1. `git fetch origin`，确认候选基于新鲜 `origin/main`，`verify-forward-only` 通过。
2. 停止相关写入、watch、cron、doctor sync。
3. 验证 Data Governance Catalog P0 coverage（§5.4 四条 100%）。
4. 备份并用 SQLite backup API 将 v1 迁到 v2（旧行 `legacy-unscoped`）。
5. 部署 **同时** 支持新句柄和 schema v2 的二进制。旧二进制遇 v2、新二进制静默写 v1 均 fail-closed。
6. 激活新 canonical binding，通过现有 workspace cutover guard 提升 fence version。
7. 启用 Resolver 唯一写路径（此时才打开 Catalog miss deny）。
8. 从授权源重建索引。
9. 验证后恢复流量。
10. 旧根进入只读观察，**不立即删除**。
11. 撤销 LIVE overlay。
12. 观察期结束后按 I3 退役。

禁止对外出现：「新 Resolver + v1 DB」或「旧二进制 + v2 DB」。

---

## 9. 代码实施范围

下表是责任边界，实施前必须以新鲜 `origin/main` 和 LIVE overlay 生成精确 diff。

| 模块                                         | 改动                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/gateway/workspace-resolver/**`          | **不由本 spec 直接认领。** 现 owner 为 `data-governance-v2-p0:cursor-data-governance`。本方案只提契约与验收，由该 owner 集成升级 |
| `src/gateway/tenant-context.ts`              | 权威 tenant/user/membership 上下文，禁止客户端选租户                                                                             |
| Agent/seat/asset registry                    | tenant-scoped `agentId -> agentAssetId`、position/seat binding                                                                   |
| `src/auto-reply/reply/get-reply.ts`          | tool cwd 只消费授权 handle，不用 memory helper 覆盖                                                                              |
| `src/auto-reply/reply/session-continuity.ts` | 根据 agent/group 资源句柄写入                                                                                                    |
| `src/memory/search-manager.ts`               | 传递 Workspace Envelope `resourceId` / session visibility scope                                                                  |
| `src/memory/manager.ts`                      | cache key 含 resourceId/catalogVersion/canonical binding；status scoped                                                          |
| `src/memory/manager-sync-ops.ts`             | scoped sync/prune/reset/reindex、保险丝                                                                                          |
| `src/memory/manager-embedding-ops.ts`        | chunk ID 包含 workspace `resourceId`；scoped chunk/FTS/vector 操作                                                               |
| `src/memory/memory-schema.ts`                | schema v2 与版本门禁                                                                                                             |
| QMD/CogniWeave adapters                      | 不在本事故中重写后端，但必须消费同一 workspace identity/authorization 契约                                                       |
| `src/gateway/workspace-cutover/**`           | 带版本扩展现有 cutover record/guard；禁止新建第二套状态机                                                                        |
| migration/audit scripts                      | inventory、classification、copy、verify、cutover、rollback、retire                                                               |

不允许通过另建“V2 manager”长期双轨运行。可用 runtime boundary 做短期兼容，但最终必须只有一套生产身份契约。

---

## 10. 测试与验收门禁

### 10.1 身份与授权

| ID  | 断言                                                                     |
| --- | ------------------------------------------------------------------------ |
| A1  | 同 `agentId` 在不同 tenant 映射到不同 AgentAsset，不可串用               |
| A2  | employee 转部门后 workspace `resourceId` 不变，仅 membership/grants 变更 |
| A3  | AgentAsset 换 seat/user 后主资产不搬迁，私人 interaction 不自动继承      |
| A4  | 同 groupId 跨 tenant 不得解析到同一资源                                  |
| A5  | Catalog 不可用、binding 冲突、tenant 不一致时 managed 写入失败           |
| A6  | memory root 在 tenant 树内不代表自动获得 tool.execute                    |
| A7  | group continuity 使用独立授权 handle，不依赖对话 cwd 巧合                |

### 10.2 记忆与索引

| ID  | 断言                                                                            |
| --- | ------------------------------------------------------------------------------- |
| M1  | 两 workspace 一 sqlite，对 Wc sync/prune 后 Wt 行、chunks、FTS、vector 全部不变 |
| M2  | 两 workspace 包含相同 path/内容/行号时 chunk ID 不同                            |
| M3  | search 在 FTS、vector、hybrid 三种模式都只返回授权 workspace                    |
| M4  | force reset/reindex 不得执行无 workspace scope 全表 DELETE                      |
| M5  | 盘 50 文件、库 1 文件时 default/status 都报 dirty                               |
| M6  | embedding 失败但 FTS 成功时报 degraded，检查失败报 unknown                      |
| M7  | `legacy-unscoped` 不参与正常 search/prune                                       |
| M8  | prune 保险丝拒绝异常大删除并产生告警/receipt                                    |
| M9  | v1 DB 观测到多根时 sync/prune/reset/rebuild 全部拒绝，跨进程并发不可绕过        |

### 10.3 迁移与并发

| ID  | 断言                                                            |
| --- | --------------------------------------------------------------- |
| X1  | copy 过程失败不修改 active binding                              |
| X2  | verify 行数/字节/checksum 不一致不得 cutover                    |
| X3  | cutover 后旧 token writer 被拒绝                                |
| X4  | 切换时旧进程、watcher、cron 和 doctor 不能重新激活 source       |
| X5  | 回滚产生新 token 和 receipt，不覆盖历史证据                     |
| X6  | SQLite backup/restore 在 WAL 模式下一致，`integrity_check` 通过 |
| X7  | 旧二进制遇 v2 schema fail closed，新二进制不静默写 v1           |

### 10.4 生产 canary 验收

1. 治理 Catalog、runtime handle、盘上 manifest 的 tenantId/resourceId/catalogVersion/canonical binding 一致。
2. `memory status` 的 indexed files 与当前授权 memory root 一致。
3. 在 legacy/canonical 根写入 probe 不影响 target workspace 索引。
4. 新对话 checkpoint 只进入经 scope 授权的 continuity root。
5. 使用特征 query 验证无跨 workspace/tenant 结果。
6. 连续观察无 canonical 新写入、无保险丝触发、无 stale token 写入。

---

## 11. 可观测性与运维

所有 workspace operation 输出结构化事件，但不记录原始内容或未脱敏物理路径：

```text
operation
deploymentProfile
tenantIdHash
resourceId
workspaceKind
workspaceDataRole
bindingId
catalogVersion
cutoverFenceVersion
policyDecision
resolverOutcome
indexHealth
migrationId
```

核心指标：

- resolver unknown/conflict/denied 比例。
- canonical fallback 次数（Managed 必须为 0）。
- stale fencing token write 拒绝数。
- index dirty/degraded/unknown 时长。
- prune 删除比例和保险丝触发数。
- source/target 新写入分布。
- orphan workspace、orphan binding、orphan chunks 和 `legacy-unscoped` 数量。

告警分级：

- P0：跨 tenant 解析/读写、stale token 成功写入、跨 workspace prune。
- P1：Managed canonical fallback、Catalog 多绑定、索引保险丝触发。
- P2：长时间 dirty/degraded、迁移停滞、观察期旧根新写入。

---

## 12. 应急处置

在结构整改上线前，若必须恢复 `bot-2` 检索：

1. 确认没有 canonical manager/watch/cron/doctor sync 在飞。
2. 对已确认租户 memory root 执行受控强制索引。
3. 记录操作票、源路径脱敏标识、sqlite 备份和索引计数。
4. 将结果视为易失性止血，不将 `Dirty=no` 当作结构整改完成。

应急操作不得创建新的路径 helper、不得猜测旧数据归属、不得跳过 ManagedEnterprise 授权。

---

## 13. 风险登记

| 风险                           | 等级 | 缓解                                                            |
| ------------------------------ | ---- | --------------------------------------------------------------- |
| Resolver 切换影响工具 cwd      | 高   | 身份与 capability 分离；shadow resolve；managed fail-closed     |
| schema 迁移损坏/WAL 备份不一致 | 高   | 停写、SQLite backup API、副本演练、integrity check              |
| 旧行误归属导致跨用户检索       | 高   | `legacy-unscoped`、禁止正常兼容读、从已授权源重建               |
| 新旧进程同时写                 | 高   | schema version fail-closed + fencing token + source read-only   |
| 部门调整引发大量搬迁           | 中   | 部门只作 scope，稳定资源与组织树分离                            |
| 索引重建消耗 embedding 额度    | 中   | 按 workspace 批次、内容 cache 复用、限流和成本预算              |
| overlay 与主干双实现漂移       | 中   | Phase 4 强制退役，静态扫描禁止新增旁路                          |
| Catalog 成为热路径瓶颈         | 中   | 有版本缓存、失效事件、读取 SLO；managed 不得用 stale cache 扩权 |

---

## 14. 项目管理与责任边界

建议拆为五个可独立评审、但按依赖顺序发布的工作流：

| Workstream                   | Owner 能力域        | 主产物                               |
| ---------------------------- | ------------------- | ------------------------------------ |
| WS-A Identity/Catalog        | 平台架构 + 数据治理 | 资源契约、Catalog、Binding           |
| WS-B Resolver/Authorization  | Gateway + 安全      | 受权 handle、capability、fail-closed |
| WS-C Memory/Index            | 记忆检索            | schema v2、scoped operations、health |
| WS-D Migration/Cutover       | 存储 + SRE          | inventory、迁移器、fencing、rollback |
| WS-E Verification/Retirement | QA + 安全 + SRE     | 负向测试、canary、观察、I3 退役      |

每个 workstream 必须有 **唯一 owner + 机器可匹配 paths**，不得标成无主 `pending`。  
`src/gateway/workspace-resolver/**` 已由 `data-governance-v2-p0:cursor-data-governance` 认领（Loom + landing stream DGV2）。本方案 **不得覆盖认领**；WS-B 只提契约/验收，代码由该 owner 集成。

本 spec 的 Registry owner 仍是 `codex-workspace-architecture`（方案文本）。契约补丁贡献者登记 Loom session，不自动接管 owner。

### 14.1 上线批准条件

以下全部满足才可进入生产：

- [ ] 架构评审确认组织树/资源树分离。
- [ ] 数据治理评审确认 `DataGovernanceEnvelope` 是唯一 Envelope，持久主键仍为 `resourceId`。
- [ ] 数据治理评审确认 Data Governance Catalog 为唯一 SoT，Workspace Catalog 的 adapter/bootstrap/退役路径完整。
- [ ] 安全评审确认 tool cwd 与数据根分别授权，Managed 全链路 fail-closed。
- [ ] 数据治理评审确认 Workspace memory root/index 与 Memory Asset 分离，owner/scope/lifecycle/retention/unknown 不重复建模。
- [ ] 存储评审确认 P0 沿用现有 `WorkspaceBindingRecord`；通用 `StorageBinding` 扩展另走附录 A，workspace 数据根不扩张为多 canonical Binding。
- [ ] Cutover Owner 确认扩展现有 workspace cutover record/guard，不新建第二套 receipt/state machine。
- [ ] 记忆 Owner 确认 files/chunks/FTS/vector 全链路分区。
- [ ] DBA/SRE 确认 SQLite backup、重建迁移、fencing 和回滚。
- [ ] 副本迁移演练和 Phase 0-2 自动化门禁全绿。
- [ ] canary 租户有单独变更票、明确回滚截止时间和值守 owner。
- [ ] 发布候选人基于新鲜 `origin/main`，通过仓库 forward-only 和发布门禁。

---

## 15. 审核签署

| 角色                         | 结论                 | 条件                                                            | 签名                         | 日期       |
| ---------------------------- | -------------------- | --------------------------------------------------------------- | ---------------------------- | ---------- |
| 专家组（方向）               | **Changes Required** | 方案方向有条件成立；Phase 0 执行验收未通过；Phase 1+ 继续锁定   | 专家意见 2026-08-14 二次复审 | 2026-08-14 |
| 平台架构                     |                      | 确认 Envelope typed view、持久 resourceId、单 canonical Binding |                              |            |
| 数据治理 / Catalog           |                      | 确认唯一 Catalog SoT、Memory Asset 边界、bootstrap coverage     |                              |            |
| Gateway / Workspace Resolver |                      | 升级现有实现；不覆盖 DGV2 owner                                 |                              |            |
| 记忆检索 Owner               |                      | schema v2 与 §8.6 同发                                          |                              |            |
| 多租户 / 安全                |                      | miss=deny 仅 coverage 后                                        |                              |            |
| SRE / 存储 / 备份            |                      | v1 多根止损、现有 cutover 扩展、§8.6 顺序与回滚                 |                              |            |
| QA / 发布                    |                      | Freeze + Retirement 两道门                                      |                              |            |

**方向有条件通过 ≠ Phase 0 执行验收，更不是 LIVE 施工授权。** 只读盘点证据可提交复审；v1 非破坏性止损仍需独立可回滚评审。未完成第 14.1 节全部重新签署前，Phase 1+ 保持 blocked，不得改生产 schema、替换 sqlite 或切换写绑定。

---

## 16. 现行多路径清单与旧支清除（可行性约束）

> 本节是对 §0.3 的工程化：先承认现状是多套隐式体系并存，再规定每条旧支的退役条件。未列入清除表的新 helper，Phase 0 起视为回归。

### 16.1 企业 → 数字人：现状不是一条链

当前从企业到某个 AI 数字人工作区，实际经过 **多层互不等价的路径构造器**，没有单一 SoT：

```text
企业 Tenant
  ├─ L1 control-plane（席位 / Registry / 策略）     多数 handler 未全接
  ├─ L2 users/<uid>/OpenBot/workspace[-<agentId>]  ForClient / 记忆 helper
  ├─ L3 users/<uid>/state/agents/<id>/             热会话，与 cwd 脱节
  ├─ host ~/.openbot/workspace-<id>                canonical 遗物，仍可被 sync
  ├─ steward employees/<uid>/workspace + cutover   第三条员工树
  └─ workspace-resolver Catalog（内存、调用点不全） 目标入口尚未成为唯一入口
```

| #   | 现行入口                                   | 典型产物                                  | 问题                                                          |
| --- | ------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------- |
| P1  | `resolveAgentWorkspaceDir`                 | `~/.openbot/workspace-{agentId}`          | 单机默认；managed 仍会回落到这里                              |
| P2  | `resolveMemoryWorkspaceDir`                | 扫描租户树 `workspace-{agent}`            | 记忆专用，可与 cwd 不一致                                     |
| P3  | `resolveAgentWorkspaceDirForClient`        | `…/OpenBot/workspace` 或 `workspace-{id}` | 按 session 用户切 L2，失败/覆盖造成分裂                       |
| P4  | `resolveAuthorizedAgentToolWorkspaceCwd`   | 对 P3 路径做授权包装                      | **现场合成 Catalog 条目**，并把 `agentId` 当成 `agentAssetId` |
| P5  | steward source/target/cutover              | 员工隔离树 + 可写切换                     | 合法例外，但未纳入同一句柄模型                                |
| P6  | group-read 专用根                          | `collaboration/groups/<id>/`              | 已部分走 resolver，仍可被 cwd 巧合写入                        |
| P7  | LIVE overlay `__resolveMemoryWorkspaceDir` | 租户优先的 minified 补丁                  | 双实现；`main` 特例；忽略调用方 workspaceDir                  |
| P8  | `~/.openbot/memory/{agentId}.sqlite`       | 无 workspace 分区的共享索引               | 任一 P1 sync 可剪掉 P2 的行                                   |

企业侧「一个员工有多个数字人」在盘上表现为扁平 `workspace-*`，**没有**稳定 `agentAssetId` 物理根，也 **没有** 部门物理嵌套。这与 §3 目标（并列稳定资源 + Catalog 绑定）一致，必须保持；不能为了“看起来整齐”把部门做成父目录。

### 16.2 方案可行性

| 判断             | 结论                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目标模型是否可行 | **可行。** 与数据治理 v2、隔离核查 C14–C18、已有 `workspace-resolver` 同构，不是另起炉灶                                                                                                             |
| 最大风险         | 把 Catalog/Resolver **加在** P1–P8 旁边，Phase 4 才删旧支 → 窗口期内变成第 9 条路径                                                                                                                  |
| 必须怎么做才可行 | **升级替换**：扩展现有 `catalog.ts` / `resolve.ts` / `types.ts`，禁止新建并行 Resolver                                                                                                               |
| P0 最小闭环      | `employee_private` + `agent_primary`（user/position）+ `group_shared` + 记忆 `workspace_id`。`tenant_shared` / `department_shared` 先占 Catalog kind，不先搬数据                                     |
| 身份怎么定       | 持久字段继续使用现有 `resourceId`（`ws:<tenant>:…`）；`WorkspaceId` 仅为类型别名，需要外部不透明性时加 alias                                                                                         |
| Binding 怎么定   | P0 沿用现有 `WorkspaceBindingRecord`（`canonical \| compatibility`，`active \| read_only \| retired`）。`workspace \| memory \| …` 是 canonical root 下的授权数据根，不新增多 canonical Binding 维度 |
| Memory 怎么定    | Workspace memory root/index 属于 workspace 文件根和 derived binding；Memory Asset 拥有独立 Envelope，通过 source relation 关联                                                                       |
| Catalog SoT      | Data Governance Catalog 是唯一 SoT；Workspace Catalog 仅为只读 adapter 投影，不得独立写入                                                                                                            |
| 合成 Catalog     | 请求路径禁止合成。先完成 §5.4 离线 bootstrap 且 coverage 达标，才启用 miss=deny                                                                                                                      |
| 发布窗口         | 同一发布单元 + §8.6 固定顺序；失败先回滚再恢复流量                                                                                                                                                   |

### 16.3 旧支清除表

| 旧支                                                        | 冻结（Phase 0）                                        | 迁出条件                          | 清除条件                              |
| ----------------------------------------------------------- | ------------------------------------------------------ | --------------------------------- | ------------------------------------- |
| P1 canonical `resolveAgentWorkspaceDir` 作为 managed 写入口 | 禁止新调用点；managed 调用改为 Resolver                | 对应资源有 active binding         | 无 managed 写、无 watch、回滚窗口结束 |
| P2 `resolveMemoryWorkspaceDir`                              | 禁止新调用点                                           | memory role 句柄可用              | 模块删除或降为测试夹具                |
| P3 `resolveAgentWorkspaceDirForClient` 覆盖 get-reply       | 禁止用它覆盖已解析身份                                 | tool cwd 只吃 handle              | 函数不再被 reply 路径引用             |
| P4 现场合成 Catalog                                         | 禁止 `createEmptyWorkspaceCatalog` + 临时 entry 授权写 | 真实 Catalog 命中                 | 合成路径仅测试可见                    |
| P5 steward 双根                                             | 只保留 cutover 状态机                                  | 写入唯一 target binding           | source 只读 → archived → retired      |
| P6 group 旁路写 cwd                                         | 小组写入必须 second handle                             | group binding 覆盖所有写          | 删除“跟对话 cwd 写小组”代码           |
| P7 LIVE overlay                                             | 禁止叠加新 helper                                      | 主干 Resolver + schema v2 已切    | overlay 文件撤除                      |
| P8 无分区 sqlite                                            | 禁止无 scope 的 prune/reset                            | v2 `workspace_id` + 源重建        | v1 库归档，旧二进制 fail-closed       |
| 扁平 `OpenBot/workspace[-id]`                               | 只读 inventory                                         | 内容迁入 `agent-assets/<id>/…`    | 目录 retired，不再创建                |
| host `~/.openbot/workspace-*`                               | 断开 watch                                             | 已分类则迁，unknown 进 quarantine | I3 删除或归档                         |

清除前必须有：migration receipt、目标包含已批准内容的校验、fencing token 提升、观察期无旧根新写入。unknown/quarantine **不**因项目收尾自动删除。

### 16.4 调用点收敛门禁（Freeze + Retirement）

只扫“新增代码”只能防恶化，不能证明旧调用已清。必须两道门，且覆盖别名导入与包装函数（AST / import graph，不能只靠 `rg` 计数）。

**Freeze gate（Phase 0 即生效，相对基线）：**

1. 禁止相对基线 **新增** P1/P2/P3 写路径调用点。
2. 不得新增 `__resolve*` overlay 或第二套 `*WorkspaceDir` helper。
3. 不得新增请求路径 Catalog 合成。
4. Managed `canonical fallback` 计数可查询。

**Retirement gate（Resolver 写路径切换前）：**

生产路径上 P1–P8 写/watch/index 调用数为 **零**。仅允许：明确测试夹具，或 PersonalLocal compatibility allowlist（逐条登记）。

每条调用点输出必须包含：

| 字段                   | 含义                                     |
| ---------------------- | ---------------------------------------- |
| symbol                 | 被调用符号                               |
| file / line            | 精确位置                                 |
| read/write/watch/index | 操作类                                   |
| deployment profile     | PersonalLocal / ManagedEnterprise        |
| replacement            | 对应 Resolver handle + WorkspaceDataRole |
| owner                  | 清除责任人                               |
| retirement phase       | freeze / shadow / retire                 |

影子期允许读旧函数做对照，差异只进审计，不进写路径。

---

## 附录 A. 后续 schema proposal（非 P0）

本附录只记录治理架构文档 v2 中 **尚未落地、不得混入 P0 契约** 的 Binding 扩展。实施前必须先覆盖 Catalog 版本迁移、lifecycle/deletion receipt、purge/archive/forget adapter、Resolver cache key、export/import、canonical 唯一性、回滚与旧进程 fail-closed。

```ts
/** Proposal only. Not the current WorkspaceBindingRecord. */
type ProposedStorageRole = "canonical" | "replica" | "derived" | "archive" | "cache";

type ProposedStorageBinding = {
  bindingId: string;
  resourceId: string;
  role: ProposedStorageRole;
  storageKind: "filesystem" | "sqlite" | "postgres" | "object-store" | "byos";
  locator: string;
  objectKey?: string;
  region?: string;
  encryptionKeyRef?: string;
  contentVersion: string;
  checksum: string;
  state: "active" | "migrating" | "read-only" | "retired" | "failed";
  createdAt: string;
  updatedAt: string;
};
```

与当前精确类型的差异（因此不能当作 P0）：

- 丢失现行 `compatibility` role。
- 现行 state 是 `read_only`，提案写成 `read-only`。
- 新增 `region` / `encryptionKeyRef` / `checksum` / `createdAt` / `updatedAt`。
- 新增 `migrating` / `failed`。
- 新增 `storageKind` / `objectKey`。

`WorkspaceEnvelope` 也不得为了“好看”再嵌套一份 `identity.resourceId`。Envelope 已有 `identity: ResourceIdentity`；typed view 只约束 `resourceType: "workspace"` 并附加 `extension`。
