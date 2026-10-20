# OpenBot 对话生命周期详细执行方案

Date: 2026-07-17

Status: **最终实施基线**（v1.2 修订完成；可启动 P0 编码）

Version: **v1.2**

Supersedes: v1.1（2026-07-16；架构方向通过，未通过“可直接实施基线”验收）

Audience: 产品架构、Gateway Runtime、员工端、协作组、CogniWeave、企业治理、QA 与 SRE 团队

Scope: OpenBot 员工端单机器人与协作小组的对话创建、连续推理、历史查看、归档、搜索、长期记忆、保留和删除

Related documents:

- [CogniWeave Memory Engine v2 实施计划](/design/openbot-cogniweave-memory-engine-v2-implementation-plan-2026-07-16)
- [协作群组对话机制优化方案](/design/openbot-collaboration-group-dialogue-optimization-2026-06-18)
- [SaaS 租户数据架构](/design/openbot-saas-tenant-data-architecture)
- [Tenant Context 传递方案](/design/tenant-context-propagation-plan-2026-07-11)
- [Data Space 模型](/design/openbot-data-space-model-v1-2026-07-10)

## v1.2 相对 v1.1 的验收修订摘要

| 编号 | 验收等级  | 问题                                                          | v1.2 处置                                                                   |
| ---- | --------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| B1   | P1 阻断   | CogniWeave 现状描述与分支不一致；不得假设已有 forget/purge    | §2.3 / §8.1：P0 **从零**交付 SourceBinding + 四项生命周期 API               |
| B2   | P1 阻断   | MemorySourceIdentity 与数字 `sourceTurnRange`、整文件重放冲突 | §5.3 / §8.1.1：消息 ID、分段算法、watermark、兼容迁移                       |
| B3   | P1 阻断   | `chat.restore` 截断 transcript 未撤回记忆                     | §2.1 / §8.5：`TRANSCRIPT_RANGE_REVOKED` + **同步 deny watermark**（§8.5.3） |
| B4   | P1 阻断   | Purge 不可逆边界与 CANCELLED 矛盾                             | §5.7 / §6.4 / §8.4：`irreversibleStartedAt` 与取消规则                      |
| M1   | P2 中风险 | Archive 恢复目标与 Source 状态迁移不完整                      | §5.1 `lifecycleStatusBeforeArchive`；§3.8 / §8.4 Source 状态机              |
| B5   | P1 阻断   | §14.5 回滚仍写“物理删除”边界，与 MEMORY_REVOKE 不可逆冲突     | §14.5：以 `irreversibleStartedAt` / 任一 irreversible 步骤为准              |
| B6   | P1 阻断   | revoke 仅有事件 payload，void listener 无法保证同周期不可召回 | §8.5.3 / CL-P0-06：P0 选定 **outbox + 同步 deny watermark**                 |
| T1   | P2 收紧   | Legacy 迁移假定已有 SourceBinding 表                          | §14.3：从 ingestion/event/evidence/journal provenance **合成**              |
| T2   | P2 收紧   | SourceLifecycle 选择器多可选，允许空/冲突输入                 | §8.1：互斥联合类型，exactly one，fail closed                                |

架构方向（JSONL 单一事实源、Data Root Catalog、TenantContext fail-closed、多 transcript 聚合、Projection 非独立证据、ACL 前置、串行 Gate）**维持 v1.1 结论，予以通过**。B1–B4、M1 核心设计已落地；B5/B6/T1/T2 为 v1.2 终稿收紧项，关闭后本文件即为最终实施基线。

---

## 0. 执行摘要

本项目不新建第二套对话运行时和消息真相源。

实施基线是：

1. 保留现有 `SessionEntry + sessions.json + JSONL transcript` 运行基础。
2. JSONL transcript 继续作为完整对话事件的唯一事实源。
3. 新增 Conversation Catalog，只保存用户可见的会话元数据和治理状态，不复制消息正文。
4. 复用现有 compaction，将 Agent 运行摘要与产品结构化摘要分开。
5. **P0 在 CogniWeave 上从契约层交付**稳定 `MemorySourceIdentity`、持久化 `SourceBinding`、**完整四项** Source Lifecycle（`archiveSource` / `restoreSource` / `forgetSource` / `purgeSource`），以及 transcript 截断/回滚触发的记忆撤回；**不得**假设主线分支已具备任一生命周期 API。
6. 优先交付员工端显式会话管理，再优化上下文和语义搜索。
7. 企业保留、导出、legal hold 和永久删除是基础契约，不放在项目末期补做。

推荐按五个串行 Gate 实施：

```text
P0 契约、来源生命周期与治理基线
  -> P1 员工端显式会话
    -> P2 上下文与摘要
      -> P3 协作组共享上下文
        -> P4 搜索、记忆与企业存储
```

各 Phase 内部可以并行，Gate 之间不允许跳过。**P0 未关闭 B1–B4 前禁止开放 Archive/Restore/Purge 产品入口。**

---

## 1. 项目目标

### 1.1 用户目标

1. 员工可以为同一机器人创建多个独立对话。
2. 员工可以在机器人或协作小组下切换、重命名、归档和恢复历史对话。
3. 打开历史对话时能快速恢复任务连续性，不把所有历史重新发给模型。
4. 员工可以用关键词、时间、机器人、协作组和参与者定位历史对话。
5. 企业与用户可以明确区分“从列表移除”、“归档”、“永久删除”和“忘记派生记忆”。

### 1.2 工程目标

1. 限制单次推理中的历史 Token，不限制 transcript 的可用性。
2. 不破坏现有渠道 session key、Agent runtime 和 compaction；CogniWeave 只做向后兼容的来源生命周期扩展。
3. 所有派生数据可以通过 transcript 与 canonical 元数据重建；用户标题、归属、legal hold、审计和删除收据本身是 canonical，不得假设可从 transcript 重建。
4. 任何搜索、摘要、记忆和协作共享都必须先通过租户、用户、席位和组权限过滤。
5. 保留策略、导出和删除行为可测试、可审计、可回滚。

### 1.3 非目标

1. 不在本项目中全量将 JSONL transcript 迁移到关系数据库。
2. 不将 CogniWeave 定义为对话正文存储。
3. 不为每条消息同步调用一次摘要模型。
4. 不在 Agent 之间复制完整群聊和私有 transcript。
5. 不承诺所有模型、硬件和工具场景都能在 2 秒内完成回复。
6. 不用本项目替代 CogniWeave v2 的整体演进，但本项目依赖的稳定来源身份、Archive、Restore、Forget 和 Purge 契约必须在 P0 交付。

---

## 2. 已核实的现状

### 2.1 Session 和 transcript

| 能力               | 当前落点                                        | 结论                                                                                                                                    |
| ------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Session 运行元数据 | `src/config/sessions/types.ts`                  | 保留并扩展，不另建运行模型                                                                                                              |
| Session 列表协议   | `src/gateway/session-utils.types.ts`            | 扩展用户对话元数据                                                                                                                      |
| Session store      | `src/config/sessions/store.ts`                  | 继续承担运行路由和索引                                                                                                                  |
| 完整 transcript    | Agent sessions 目录下的 JSONL                   | 对话事件唯一事实源                                                                                                                      |
| 历史读取           | `chat.history`                                  | 已有数量、字节和超大消息限制                                                                                                            |
| 归档读取           | `includeArchives` / `archiveId`                 | 已有 cwd 归属闸门，员工端未完整产品化                                                                                                   |
| Session 删除       | `sessions.delete`                               | 现有路径先移动/删除再 best-effort 归档，不能作为新生命周期实现                                                                          |
| Checkpoint 回滚    | `chat.restore` + `truncateTranscriptToBoundary` | **会截断 live transcript 并归档尾部**；当前 `emitSessionTranscriptUpdate` 仅带 `sessionFile`，无操作类型与撤回范围，记忆不会自动 unlink |

### 2.2 上下文与摘要

| 能力                | 当前落点                                   | 结论                           |
| ------------------- | ------------------------------------------ | ------------------------------ |
| 模型 context window | `agents.defaults.contextTokens`            | 必须动态使用，不固定为 8k      |
| Context pruning     | `agents.defaults.contextPruning`           | 保留，用于裁剪过旧 tool result |
| Compaction          | `agents.defaults.compaction`               | 保留为 Agent 运行摘要机制      |
| 最近轮次保留        | `keepRecentTokens` / `recentTurnsPreserve` | 作为 Active Context 基础       |
| 压缩前记忆刷新      | `memoryFlush`                              | 保留，但不等于会话产品摘要     |

### 2.3 CogniWeave

| 能力                     | 当前落点                           | 结论                               |
| ------------------------ | ---------------------------------- | ---------------------------------- |
| Transcript 更新监听      | `src/memory/cogniweave-manager.ts` | 已实时同步受影响 scope             |
| Session 文本提取         | `src/memory/session-files.ts`      | 已过滤为 user/assistant 文本并脱敏 |
| Private scope            | Agent 级 private scope             | 复用                               |
| Group scope              | `space:<groupId>` 共享 scope       | 复用并加强 ACL                     |
| Atom/evidence/provenance | CogniWeave SDK                     | 补齐产品级准入、撤回和解释         |

已核实的集成缺口（**以目标主线/验收分支的公共契约为准；P0 按“从零交付”计划，不依赖 WIP 分支是否已有部分实现**）：

1. 当前 transcript source locator 优先使用 `openbotPath`，物理路径变化可能被识别为新来源；`operation key` 若混入路径或 `syncReason` 会导致重复来源。
2. **Source Lifecycle 公共 API 与持久化 `SourceBinding` 不得假设已存在。** P0 必须在 SDK contracts + metadata store **新增**并实现：`archiveSource`、`restoreSource`、`forgetSource`、`purgeSource`，以及 `SourceBinding` / `SourceObjectLink`（或等价）的持久化模型与 schema migration。禁止仅补 Archive/Restore 而把 Forget/Purge 留到后期。
3. 现有 `IngestInput.sourceTurnRange?: [number, number]` 与产品侧字符串 `firstTurnId`/`lastTurnId` 尚未统一；`session-files` 提取器丢弃消息顶层 `id`/`parentId`，仅保留文本与行号；manager 按**整份文本 + 路径**重放。P0 必须交付可执行的 range 分段与增量 watermark（见 §5.3 / §8.1.1）。
4. 当前 session 文件扫描只覆盖 live `.jsonl`；文件移除、归档或 **checkpoint 截断**后，manager 尚未可靠关闭/撤回 canonical source binding。
5. Conversation projection 不得作为独立证据源重复支撑由原 transcript 产生的同一 Memory Atom。
6. `src/sessions/transcript-events.ts` 仅广播 `{ sessionFile }`，**无法区分** append / truncate / delete；`chat.restore` 截断后记忆仍可能被召回（见 §8.5）。

### 2.4 协作组

1. 用户可见的协作组有公共 space session。
2. 各机器人有独立的 `agent:<agentId>:main:space:<groupId>` 执行 session。
3. 公共输入历史已做限额，默认 24 条，最大 40 条。
4. Group Profile、Participation Overlay、task、decision、deliverable 和 ledger 已有独立数据落点。
5. 缺口是可版本化的 Shared Task Context 和明确的公共/私有上下文写入规则，不是缺少 GroupSession 容器。

### 2.5 员工端

1. 员工端已能从 `sessions.list` 获取会话数量、最近消息和更新时间。
2. 侧边栏当前主要以机器人或协作组为入口，多个 session 大多被聚合到主入口。
3. 切换 session 已能重载 `chat.history`。
4. 需要新增显式 Conversation List、新建对话、归档管理、分页历史和搜索入口。

---

## 3. 强制架构原则

### 3.1 单一事实源

1. JSONL transcript 是消息与工具事件的 canonical source。
2. Conversation Catalog 不存储消息正文。
3. 自动标题、摘要、搜索索引、预览和 Memory Atom 均为可重建派生数据；用户标题和治理元数据不是派生数据。
4. 如未来将 transcript 迁移到数据库，必须以 repository 整体迁移取代长期双写。

### 3.2 策略优先级

上下文组装必须遵守以下优先级：

1. System policy、安全约束、工具权限和租户边界。
2. 当前用户输入及本轮必要附件。
3. 当前任务的硬约束、已批准决策和待办。
4. 最近原始对话轮次。
5. Runtime compaction summary。
6. 通过 ACL 与相关性门槛的长期记忆。
7. 可选的辅助背景。

前三类不允许被普通历史或记忆挤出。

### 3.3 权限先于检索

所有历史和记忆路径必须按以下顺序执行：

```text
Tenant
  -> Principal
    -> Employee seat
      -> Conversation ownership or membership
        -> Lifecycle and legal hold
          -> Source visibility
            -> Retrieval and ranking
```

不允许先全局检索再在结果集上做权限过滤。

### 3.4 运行状态和存储层级分离

- `lifecycleStatus` 描述用户和业务状态。
- `storageTier` 描述物理存储和加载策略。
- `retentionState` 描述法务、保留和清理状态。

三者不得合并为一个枚举。

### 3.5 派生数据可撤回

1. 每个 summary、index document 和 Memory Atom 必须能定位到 source conversation 和 turn range。
2. 删除 transcript 后必须触发派生数据 unlink/recompute/tombstone。
3. 归档 transcript 不等于删除记忆，由企业策略决定是否继续可检索。

### 3.6 数据主权和租户路由

1. Conversation Catalog、legal hold、生命周期审计和 purge receipt 属于可迁移、可备份的 canonical data。
2. 本地模式的 canonical data 必须位于 Data Root；托管模式必须位于经认证 TenantContext 解析出的租户数据平面。
3. State Dir 继续承载现有 runtime session/transcript，并可保存游标、任务租约、durable outbox 和可重建缓存；不得保存 Catalog、legal hold 或 purge receipt 的唯一副本。
4. 所有 repository、archive、export 和 purge 操作必须使用服务端认证上下文解析 `dataPlaneId` 与 `tenantId`，禁止信任客户端传入租户标识或仅使用全局配置路径。
5. 多租户解析失败必须 fail closed，不得回退到默认租户或共享目录。

### 3.7 Conversation 聚合和来源身份

1. Conversation 是产品级聚合，不是单个 transcript 的别名。
2. 每个 ConversationSessionBinding 对应一个 canonical transcript stream；协作会话可以同时拥有公共 stream 和多个 Agent execution stream。
3. 每个可被索引或形成记忆的不可变 turn range 必须具有稳定 `MemorySourceIdentity`。
4. 来源身份由数据平面、Conversation、binding 和稳定 turn 边界确定，不得由 live/archive 文件路径、session key 或 checksum 单独确定。
5. live、warm、cold 和 archive 路径只是同一来源的 locator alias，移动存储不得产生第二份证据。
6. `conversationId` 不进入 CogniWeave 的 workspace/project/agent partition key；长期记忆仍按 agent、seat、space 等治理 scope 跨会话积累。

### 3.8 生命周期语义

| 操作                  | Transcript                             | CogniWeave source                         | 可恢复             |
| --------------------- | -------------------------------------- | ----------------------------------------- | ------------------ |
| 从默认列表移除        | 不变                                   | 不变                                      | 是                 |
| Archive               | 可移动到受控存储，至少保留一份完整副本 | 标记 archived，保留 source links          | 是                 |
| Restore               | 恢复可写位置或解除只读                 | **仅** `archived → active`，不创建新来源  | 是                 |
| Forget derived memory | 不要求删除 transcript                  | 撤销指定来源对可检索 Memory Atom 的支撑   | 按策略             |
| Purge                 | 在 legal hold 允许时永久删除           | unlink/recompute/tombstone 或删除孤儿对象 | 否                 |
| Checkpoint 截断回滚   | 尾部移出 live 或归档                   | 对撤回 range **立即** forget/unlink       | 对话可；记忆按撤回 |

Archive 不得复用 Forget 实现。归档来源是否参与搜索或模型注入由 retention policy 和请求主体共同决定。

#### 3.8.1 Conversation lifecycle 状态机（产品）

```text
ACTIVE  <-> CLOSED
ACTIVE|CLOSED -> ARCHIVED   # 写入 lifecycleStatusBeforeArchive = 原 ACTIVE|CLOSED
ARCHIVED -> restoreTarget   # restoreTarget := lifecycleStatusBeforeArchive ?? CLOSED
任何非 DELETED + legal hold 允许 -> PURGE_PENDING -> DELETED
```

约束：

1. `ARCHIVED` 恢复时**不得**猜测；必须使用 `lifecycleStatusBeforeArchive`（见 §5.1）。缺省为 `CLOSED`（安全默认：不自动回到可写 ACTIVE）。
2. `DELETED` 不可回到 ACTIVE/CLOSED/ARCHIVED。

#### 3.8.2 CogniWeave SourceBinding 状态机（记忆来源）

```text
active    <-> archived          # archiveSource / restoreSource（可逆，保留 links）
active|archived -> forgotten    # forgetSource（撤回可检索支撑；transcript 可仍在）
active|archived|forgotten -> purged  # purgeSource（永久；不可恢复）

禁止：
  forgotten -X-> active|archived
  purged    -X-> active|archived|forgotten
  restoreSource 仅当 previousStatus === archived
```

---

## 4. 目标架构

### 4.1 逻辑架构

```text
Employee UI
  -> Conversation API
    -> Authenticated TenantContext Resolver      # fail closed
    -> Conversation Catalog                 # 产品元数据
    -> Existing Session Store               # 运行路由与状态
    -> Existing JSONL Transcript Repository # 完整事件真相

Agent turn
  -> Context Budget Planner
    -> Mandatory Policy
    -> Current Input
    -> Shared Task Context
    -> Recent Transcript
    -> Runtime Compaction Summary
    -> Governed Memory Retrieval
  -> Agent Runtime

Async projection
  -> Conversation Projection Worker
    -> Title / structured summary / preview / search document
    -> Source identity aliases / projection dependency
  -> CogniWeave
    -> Evidence / atom / provenance / memory retrieval

Governance
  -> Retention Evaluator
    -> Archive / cold move / legal hold / purge
```

### 4.2 存储责任

| 数据                               | Canonical                | 默认进入模型 | 可重建                 |
| ---------------------------------- | ------------------------ | ------------ | ---------------------- |
| Conversation metadata              | Conversation Catalog     | 否           | 部分；须备份           |
| Legal hold / audit / purge receipt | Governance store/Catalog | 否           | 否                     |
| Session runtime metadata           | Session store            | 否           | 否                     |
| 完整消息与工具事件                 | JSONL transcript         | 否           | 否                     |
| 当前输入                           | Runtime                  | 是           | 否                     |
| 最近对话                           | Transcript projection    | 是           | 是                     |
| Runtime compaction summary         | Agent runtime/transcript | 是           | 是                     |
| Structured conversation projection | Projection store         | 按需         | 是；不得成为独立证据源 |
| Shared Task Context                | Collaboration state      | 协作场景是   | 部分                   |
| Memory Atom                        | CogniWeave canonical     | 检索后按需   | 通过 source links 重算 |
| Search index                       | Derived index            | 否           | 是                     |

### 4.3 物理存储建议

P0 到 P3 不强制引入新的数据库产品。本地模式使用 Data Root 下的 SQLite Catalog；托管模式使用现有租户隔离企业数据层。两者必须实现同一 repository 契约和契约测试套件。生产模式不使用单一 JSON 文件作为 Catalog canonical store。

建议边界：

```text
State Dir
├── agents/<agentId>/sessions/        # 现有 session store + transcript
├── conversations/projections/       # 可重建
├── conversations/indexes/           # 可重建
├── conversations/jobs/              # 可恢复游标和任务租约，不是 canonical
└── cogniweave/outbox/                # durable outbox，canonical store 不在此处

Data Root
├── .meta/conversations/catalog.sqlite # 本地 canonical metadata/governance
├── .meta/cogniweave/canonical.sqlite  # 本地 CogniWeave canonical store
├── conversations/archive/             # 便携、可审计的归档
└── conversations/exports/             # 导出清单与校验和

Managed tenant data plane
├── conversation catalog/governance    # tenant-scoped canonical store
├── CogniWeave canonical store         # tenant/data-plane partitioned
├── archive object store               # manifest + checksum
└── export object store                # scoped and expiring
```

Catalog、归档和 CogniWeave 的路径或连接必须由同一 authenticated TenantContext 解析。不得由 `sessions.delete` 或其他 RPC 直接调用仅依赖全局配置的归档 helper。

---

## 5. 领域模型和数据契约

### 5.1 ConversationRecord

```typescript
type ConversationLifecycleStatus = "ACTIVE" | "CLOSED" | "ARCHIVED" | "DELETED";
type ConversationStorageTier = "HOT" | "WARM" | "COLD";
type ConversationRetentionState = "RETAIN" | "EXPIRING" | "LEGAL_HOLD" | "PURGE_PENDING";

type ConversationRecord = {
  schemaVersion: 1;
  conversationId: string;
  dataPlaneId: string;
  tenantId: string | null;
  ownershipScopeType: "USER" | "SEAT" | "GROUP";
  ownershipScopeId: string;
  createdByUserId: string;
  surfaceType: "AGENT" | "COLLABORATION_GROUP";
  agentId: string | null;
  groupId: string | null;
  title: string;
  titleSource: "AUTO" | "USER" | "IMPORT";
  lifecycleStatus: ConversationLifecycleStatus;
  /** 进入 ARCHIVED 前的用户可见状态；Restore 的唯一目标来源。 */
  lifecycleStatusBeforeArchive: "ACTIVE" | "CLOSED" | null;
  storageTier: ConversationStorageTier;
  retentionState: ConversationRetentionState;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  participantIds: string[];
  primaryBindingId: string | null;
  etag: string;
};
```

约束：

1. `conversationId` 是产品稳定 ID，不等于 session key。
2. `primaryBindingId` 指向用户默认进入的 binding，不直接保存可变 session key。
3. 单机器人会话恰有一条 active `PRIMARY` binding；协作组会话恰有一条 active `GROUP_PUBLIC` binding，并可有零到多条 `AGENT_EXECUTION` binding。
4. 单机器人会话必须有 `agentId`，协作组会话必须有 `groupId`。
5. `tenantId` 可在纯本地个人模式为 `null`，企业模式不允许为 `null`。
6. `dataPlaneId` 在所有部署模式都必填，并由认证后的服务端上下文解析。
7. 一个 Conversation 可以聚合多个 canonical transcript stream；每个 binding 只对应一个 canonical stream。
8. 拥有权与使用权分离：本地个人模式可归属 `USER`，企业机器人会话默认归属 `SEAT`，协作会话归属 `GROUP`；成员访问由 ACL 决定。
9. 员工离职或席位继任只改变使用主体和 ACL，不重写 `conversationId`、binding、transcript 或 memory provenance。
10. Archive 时必须原子写入 `lifecycleStatusBeforeArchive` 为当时的 `ACTIVE` 或 `CLOSED`；Restore 只能恢复到该值（若 null 则 `CLOSED`）。再次 Archive 时覆盖为当前 pre-archive 状态。

### 5.2 ConversationSessionBinding

```typescript
type ConversationSessionBinding = {
  schemaVersion: 1;
  bindingId: string;
  dataPlaneId: string;
  conversationId: string;
  sessionKey: string;
  sessionId: string;
  agentId: string | null;
  role: "PRIMARY" | "GROUP_PUBLIC" | "AGENT_EXECUTION" | "LEGACY_ALIAS";
  aliasTargetBindingId: string | null;
  transcriptState: "LIVE" | "READ_ONLY" | "ARCHIVED" | "PURGED";
  createdAt: string;
  endedAt: string | null;
};
```

用途：

- 单机器人通常只有一条 `PRIMARY` binding。
- 协作组包含一条 `GROUP_PUBLIC` 和若干 `AGENT_EXECUTION` binding。
- 兼容历史 session key 时使用 `LEGACY_ALIAS` 并设置 `aliasTargetBindingId`，它不拥有独立 transcript，也不参与来源计数。
- session key 是可变路由别名；`bindingId + sessionId` 才是 Catalog 与 transcript repository 的稳定关联。

### 5.3 MemorySourceIdentity 与 transcript 分段契约

```typescript
/** 稳定消息边界：优先 JSONL message.id；否则确定性合成 ID（见下）。 */
type TranscriptMessageId = string; // max 128, [a-zA-Z0-9._:-]+

type MemorySourceIdentity = {
  schemaVersion: 1;
  sourceIdentityId: string;
  dataPlaneId: string;
  conversationId: string;
  bindingId: string;
  sessionId: string;
  /** Inclusive stable message IDs of an immutable turn range. */
  firstTurnId: TranscriptMessageId;
  lastTurnId: TranscriptMessageId;
  /**
   * Dual encoding for SDK 兼容：与 first/last 同步计算的 0-based 闭区间。
   * 仅用于对接现有 IngestInput.sourceTurnRange?: [number, number]；
   * **不得**单独作为 identity 主键（路径/行号可变）。
   */
  turnIndexRange: [number, number];
  sourceType: "TRANSCRIPT_RANGE";
  /** SHA-256 of normalized user/assistant texts in range (no paths, no syncReason). */
  contentChecksum: string;
  createdAt: string;
};

type MemorySourceLocatorAlias = {
  sourceIdentityId: string;
  storageTier: ConversationStorageTier;
  locator: string;
  checksum: string;
  active: boolean;
  createdAt: string;
  retiredAt: string | null;
};

/** Per-binding ingest cursor (watermark). */
type TranscriptIngestWatermark = {
  schemaVersion: 1;
  dataPlaneId: string;
  bindingId: string;
  sessionId: string;
  /** Last successfully sealed range's lastTurnId. */
  lastSealedTurnId: TranscriptMessageId | null;
  lastSealedTurnIndex: number | null; // 0-based inclusive
  lastContentChecksum: string | null;
  updatedAt: string;
};
```

#### 5.3.1 消息 ID 保留与验证

1. JSONL 写入路径（含 `chat.send` / assistant append）**必须**为每条 `type=message` 记录保留稳定 `message.id`（UUID 或与现有协议一致的非空字符串）。
2. `session-files` / 记忆提取器 **必须**解析并保留 `message.id` 与可选 `parentId`；不得仅输出 `User:/Assistant:` 文本。
3. 校验：`id` 非空、长度 ≤ 128、字符集 `[a-zA-Z0-9._:-]+`、同一 session 内唯一。
4. 历史无 id 的消息：合成 `syn:{sessionId}:{jsonlLine1Based}:{role}:{sha256(normalizedText).slice(0,16)}`，写入提取结果的旁路索引，**不改写**历史 JSONL（避免破坏 checksum）；新写入禁止缺少 id。
5. 行号只用于合成与调试，**不得**单独进入 `sourceIdentityId`。

#### 5.3.2 确定性、不可重叠的 range 分段算法

目标：追加消息时 **只 seal 新 range**，禁止对已 seal 区间整文件重放。

```text
算法 TranscriptRangeSealer (per binding/session):

  输入: ordered user/assistant messages M[0..n-1] with stable ids
        watermark W (last sealed index, or -1)

  若 n-1 <= W: 无新消息，返回 []

  候选 = M[W+1 .. n-1]

  分段规则（配置化，默认）:
    - 每段最多 maxTurns (默认 20) 条 user/assistant 消息
    - 或累计规范化文本 bytes >= maxBytes (默认 32KiB)
    - 或达到“完整对话回合”边界（assistant 完成对最近 user 的回复）且段内至少 1 条

  对每个完整段 S:
    firstTurnId = S[0].id
    lastTurnId  = S[S.length-1].id
    turnIndexRange = [globalIndex(S[0]), globalIndex(S[last])]
    contentChecksum = sha256(join(normalized texts in S))
    sourceIdentityId = encode(msrc-v1|dataPlane|conversation|binding|session|
                              TRANSCRIPT_RANGE|firstTurnId|lastTurnId)
    持久化 identity + 以 openbotPath 为 locator alias
    ingest 仅该段原文（或结构化 payload），operationKey 见 5.3.4
    W := last index of S

  尾部不足一段的消息保持 unsealed，不 ingest 为稳定 atom 来源
  （可选：tentative 缓存，不写 SourceBinding status=active）
```

约束：

1. 已 seal 的 range **永不**因后续 append 改变 `sourceIdentityId` / checksum / 语义。
2. Ranges 在同一 session 上 **不重叠**；允许 gap 仅当中间消息被 revoke 截断（见 §8.5）。
3. 物理路径变化只更新 locator alias；**禁止**新 seal 同一 turn 边界。

#### 5.3.3 与现有数字 `sourceTurnRange` 的兼容

1. SDK `IngestInput` 继续可接受 `sourceTurnRange?: [number, number]`，但 OpenBot adapter **必须同时**写入 metadata：
   - `openbotSourceIdentityId`
   - `openbotFirstTurnId` / `openbotLastTurnId`
   - `openbotContentChecksum`
2. 新写 `operation key` / dedup 以 `sourceIdentityId` 为准；数字 range 仅辅助调试与旧读者。
3. 双读期：若仅有数字 range + path，通过 watermark 与 contentChecksum 合并到单一 identity，不增加来源计数。

#### 5.3.4 operation key 排除运行元数据

计算 write operation key / ingestion checksum 时 **禁止**包含：

- 文件绝对/相对路径、`openbotPath` 字符串本身（path 只作 alias）
- `syncReason`、`watcher`、`forceRebuild`、进程 id、时间戳抖动字段
- 客户端传入的可变 session key（使用 `bindingId` + `sessionId`）

允许：`dataPlaneId`、`sourceIdentityId`、`contentChecksum`、scope 序列化、规范化正文。

#### 5.3.5 其他约束

1. 存储迁移只更新 locator alias，同一 source 不重新 ingest，也不增加 atom 的独立来源计数。
2. 旧 `openbotPath` binding 必须迁移为 alias；迁移前后 dedup、conflict 和 purge 结果一致。
3. Projection 的 evidence ref 指向 underlying source identity；Projection 自身不得作为第二个独立 Memory Atom source。
4. Approved Shared Task Context 是记忆准入信号，其 evidence refs 仍指向 transcript source identity，不独立增加来源计数。

### 5.4 ConversationProjection

```typescript
type ConversationProjection = {
  schemaVersion: 1;
  conversationId: string;
  revision: number;
  sources: Array<{
    sourceIdentityId: string;
    bindingId: string;
    sessionId: string;
    firstTurnId: string;
    lastTurnId: string;
    sourceChecksum: string;
  }>;
  generatedAt: string;
  generatedBy: {
    kind: "RULE" | "MODEL";
    provider: string | null;
    model: string | null;
    promptVersion: string;
  };
  goal: string | null;
  decisions: Array<{
    id: string;
    text: string;
    status: "PROPOSED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
    evidenceRefs: string[];
  }>;
  constraints: Array<{ text: string; evidenceRefs: string[] }>;
  importantContext: Array<{ text: string; evidenceRefs: string[] }>;
  pendingTasks: Array<{
    text: string;
    ownerId: string | null;
    dueAt: string | null;
    evidenceRefs: string[];
  }>;
  participants: string[];
  shortSummary: string;
};
```

约束：

1. Projection 是产品摘要，不替代 runtime compaction summary。
2. 只有完整覆盖旧 revision 全部 source ranges 的新 revision 才能 supersede 旧 revision。
3. 每个决策、约束和待办都必须有 evidence refs。
4. 生成失败时保留上一个可用 revision，不阻断主对话。
5. Projection 只能派生自其 `sources`，不能成为与这些 source 并列的独立证据来源。

### 5.5 SharedTaskContext

```typescript
type SharedTaskContext = {
  schemaVersion: 1;
  conversationId: string;
  groupId: string;
  revision: number;
  mission: string | null;
  currentPhase: string | null;
  goals: Array<{ text: string; status: string; evidenceRefs: string[] }>;
  approvedDecisions: Array<{ decisionId: string; text: string; evidenceRefs: string[] }>;
  hardConstraints: Array<{ text: string; evidenceRefs: string[] }>;
  taskRefs: string[];
  deliverableRefs: string[];
  unresolvedQuestions: Array<{ text: string; evidenceRefs: string[] }>;
  updatedBy: string;
  updatedAt: string;
};
```

禁止将机器人私有 chain-of-thought、私有 memory、工作区文件全文或未脱敏 tool result 写入 Shared Task Context。

### 5.6 RetentionPolicy

```typescript
type ConversationRetentionPolicy = {
  schemaVersion: 1;
  policyId: string;
  dataPlaneId: string;
  tenantId: string | null;
  activeIdleAfter: string;
  warmAfter: string;
  coldAfter: string;
  archiveAfter: string | null;
  purgeAfter: string | null;
  archiveEnabled: boolean;
  memoryExtractionEnabled: boolean;
  archiveSearchEnabled: boolean;
  userExportEnabled: boolean;
  userDeleteMode: "DISABLED" | "ARCHIVE_ONLY" | "PURGE_ALLOWED";
  legalHoldEnabled: boolean;
};
```

默认值必须在 P0 评审确认，不直接把原方案的 7/90/365 天写死在代码中。

### 5.7 Governance 和 Purge 记录

```typescript
type ConversationLegalHoldRecord = {
  schemaVersion: 1;
  holdId: string;
  dataPlaneId: string;
  conversationId: string;
  status: "ACTIVE" | "RELEASED";
  reasonCode: string;
  createdBy: string;
  createdAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
};

type ConversationPurgeStep = {
  name: "FREEZE" | "MEMORY_REVOKE" | "DERIVED_DELETE" | "CONTENT_DELETE" | "VERIFY";
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  attempts: number;
  lastErrorCode: string | null;
  /** True if this step class is irreversible once SUCCEEDED or once started after barrier. */
  irreversible: boolean;
  updatedAt: string;
};

type ConversationPurgeJob = {
  schemaVersion: 1;
  purgeJobId: string;
  dataPlaneId: string;
  conversationId: string;
  requestedBy: string;
  requestId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED_RETRYABLE" | "CANCELLED";
  manifestDigest: string;
  /**
   * 不可逆屏障时间戳。必须在首次执行任何 irreversible 步骤
   * （含 `purgeSource` / 物理删除 / 硬 tombstone）**之前**原子写入。
   * 一旦非 null：禁止 CANCELLED，只能重试到 SUCCEEDED 或人工修复后的终态。
   */
  irreversibleStartedAt: string | null;
  steps: ConversationPurgeStep[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
```

`retentionState=LEGAL_HOLD` 由 active hold records 投影得到；只有所有 hold 均已授权解除后才能退出。Purge manifest 单独保存全部待删除对象引用和 checksum；完成后 receipt 只保留 manifest digest、步骤结果、对象计数、审计主体和时间，不保留消息原文、附件内容或可恢复凭证。相同 `dataPlaneId + conversationId + requestId` 必须返回同一 purge job。

#### 5.7.1 Purge 步骤可逆性与取消规则（关闭 B4）

| 步骤           | irreversible               | 说明                                                                             |
| -------------- | -------------------------- | -------------------------------------------------------------------------------- |
| FREEZE         | false                      | 访问拒绝、`PURGE_PENDING`、binding READ_ONLY；可取消并回到原 retention/lifecycle |
| MEMORY_REVOKE  | **true**                   | 首次调用 `purgeSource` / 硬 unlink+tombstone 前必须已写 `irreversibleStartedAt`  |
| DERIVED_DELETE | true                       | 删除 projection/index 等派生对象                                                 |
| CONTENT_DELETE | true                       | 删除 transcript/附件                                                             |
| VERIFY         | false（但 job 已不可取消） | 校验；失败则 FAILED_RETRYABLE                                                    |

规则：

1. **可取消窗口**：仅 `status ∈ {PENDING, RUNNING}` 且 `irreversibleStartedAt == null` 且尚未 SUCCEEDED 任何 irreversible 步骤。取消后：解除 FREEZE、恢复 `retentionState` 到进入 purge 前快照、lifecycle 不变。
2. **若产品希望“可撤销的删除”**：在进入 MEMORY_REVOKE 前只允许 **quarantine/archive**（可逆），不得调用 `purgeSource`。用户确认后再开 purge job。
3. **不可逆之后**：`CANCELLED` 非法；API 返回 `PURGE_IRREVERSIBLE`；执行器只能继续或 `FAILED_RETRYABLE` 后重试到 `DELETED`。
4. FREEZE 中的“拒绝检索”若实现为 **可逆 ACL 标记**则可取消；若实现为 `purgeSource` 则必须归入 MEMORY_REVOKE 并先写屏障。

---

## 6. API 契约

### 6.1 新增 Conversation API

| Method                             | 用途                                 | 最小返回                   |
| ---------------------------------- | ------------------------------------ | -------------------------- |
| `conversations.create`             | 为机器人或协作组创建对话             | ConversationRecord         |
| `conversations.list`               | 按所有者、机器人、组、状态和时间分页 | cursor + rows              |
| `conversations.get`                | 取得单个对话元数据                   | record + latest projection |
| `conversations.rename`             | 用户重命名                           | updated record             |
| `conversations.close`              | 结束当前任务但保持可访问             | updated record             |
| `conversations.archive`            | 移出活跃列表并归档                   | archive job/result         |
| `conversations.restore`            | 恢复已归档对话                       | restore job/result         |
| `conversations.purge`              | 永久删除及派生数据级联撤回           | purge job/initial receipt  |
| `conversations.purge.get`          | 查看永久删除各阶段状态与失败原因     | purge receipt              |
| `conversations.export`             | 导出 transcript、附件清单和元数据    | export job/result          |
| `conversations.search`             | 元数据、全文和语义搜索               | scoped hits                |
| `conversations.projection.get`     | 获取结构化摘要                       | projection                 |
| `conversations.projection.refresh` | 按权限手动重建摘要                   | async job                  |

### 6.2 扩展现有 API

`sessions.list` 保留给运行和兼容界面，新增或投影：

- `conversationId`
- `conversationLifecycleStatus`
- `conversationTitle`
- `storageTier`
- `retentionState`

`chat.history` 新增 cursor 分页契约，并保留旧 `limit` 语义：

```typescript
type ChatHistoryPageParams = {
  sessionKey?: string;
  conversationId?: string;
  before?: string;
  after?: string;
  limit?: number;
  includeTools?: boolean;
  archiveId?: string;
  bindingRole?: "PRIMARY" | "GROUP_PUBLIC" | "AGENT_EXECUTION";
};
```

约束：

1. `conversationId` 与 `sessionKey` 同时出现时必须校验 binding 一致。
2. cursor 必须不透露文件路径、行号或其他租户信息。
3. 返回结果必须继续经过字节上限、超大消息替换和 tool filtering。
4. 未指定 `bindingRole` 时只读取用户可见的 `PRIMARY` 或 `GROUP_PUBLIC`；`AGENT_EXECUTION` 必须有独立治理权限，不能因属于同一 Conversation 自动可见。

### 6.3 幂等和并发

1. 所有写 API 接受 `requestId` 或等价幂等键。
2. rename/archive/restore 接受 `etag` 做乐观并发控制。
3. purge 使用持久状态机，不允许在一个 RPC 中以多个无记录的 best-effort 删除完成。
4. Projection 使用 `conversationId + sorted(sourceIdentityId/sourceChecksum) + promptVersion` 去重。
5. archive/restore/purge 返回持久 job ID；客户端断线不影响操作继续或重试。

### 6.4 生命周期状态机

允许的核心迁移：

```text
lifecycleStatus:
  ACTIVE <-> CLOSED
  ACTIVE|CLOSED -> ARCHIVED
      (set lifecycleStatusBeforeArchive)
  ARCHIVED -> lifecycleStatusBeforeArchive ?? CLOSED

retentionState:
  RETAIN|EXPIRING -> PURGE_PENDING   # 进入 purge job
  PURGE_PENDING -> RETAIN|EXPIRING   # 仅当 irreversibleStartedAt == null 的取消
  PURGE_PENDING -> (complete) lifecycleStatus=DELETED

purge job status:
  PENDING|RUNNING + irreversibleStartedAt==null -> CANCELLED   # 允许
  irreversibleStartedAt!=null -> CANCELLED  # 禁止
  * -> SUCCEEDED | FAILED_RETRYABLE
```

1. Archive 必须先复制或移动并校验 canonical transcript，再切换 Catalog 与 binding 状态，并持久化 `lifecycleStatusBeforeArchive`。
2. Restore 必须复用原 `conversationId`、`bindingId`、`sessionId` 和 `MemorySourceIdentity`，目标 lifecycle **仅**来自 `lifecycleStatusBeforeArchive`（缺省 CLOSED）。
3. Purge：在首次 irreversible 步骤前原子写 `irreversibleStartedAt`；此后禁止取消，只能重试到 `DELETED`。
4. legal hold 可以阻止进入 `PURGE_PENDING`，但不能被 archive、storage tier 迁移或缓存清理绕过。
5. CogniWeave `restoreSource` 仅接受 `status===archived`；`forgotten`/`purged` 调用必须失败且不创建新 binding。

---

## 7. Active Context 执行设计

### 7.1 预算算法

不引入固定 8k 默认。Context Budget Planner 必须使用实际模型 `contextTokens`、输出 reserve、工具开销和压缩设置。

建议初始预算：

```text
modelContext
  - outputReserve
  - toolProtocolReserve
  - mandatoryPolicyTokens
  = availableInputBudget

availableInputBudget
  -> current input and attachment context: required
  -> approved task context: up to 20%
  -> recent verbatim turns: 25% to 40%
  -> runtime summary: 10% to 20%
  -> retrieved memory: up to 10%
  -> remaining reserve: unused or recent turns
```

百分比是配置起点，不是固定乘法。当必选项超出预算时，必须显式报告 context overflow，不允许静默丢弃策略或当前输入。

### 7.2 摘要触发

主触发：

- 当前上下文达到 compaction 阈值。
- 工具输出或 transcript 字节大小达到安全阈值。

辅助触发：

- 用户显式新建、关闭或归档对话。
- 协作组 phase 状态机完成有效迁移。
- 长时间休眠后恢复对话。
- 管理员或用户显式请求重建。

“20 轮”只能作为配置化辅助信号，不作为通用硬触发。

### 7.3 双摘要边界

| 摘要                       | 目的                  | 生成者                 | 注入模型 | 用户可见 |
| -------------------------- | --------------------- | ---------------------- | -------- | -------- |
| Runtime compaction summary | 恢复 Agent 执行连续性 | 现有 Agent compaction  | 是       | 默认否   |
| Conversation projection    | UI、搜索、任务与治理  | 异步 projection worker | 按需     | 是       |

不得用产品摘要覆盖或改写 Agent compaction 摘要。

### 7.4 上下文 Trace

每次 Agent run 至少记录：

- 模型 context window
- 各类上下文的 Token 使用量
- 最近原始轮次数
- compaction summary revision
- Memory 检索候选数、通过 ACL 数和最终注入数
- 裁剪原因
- overflow 和 fallback 原因

不在默认日志中记录完整用户内容。

---

## 8. CogniWeave 记忆执行设计

### 8.1 信息流

```text
Transcript
  -> immutable turn range
    -> MemorySourceIdentity
      -> scoped ingest
        -> evidence
          -> candidate atom
            -> admission
              -> conflict and dedup
                -> active memory atom
```

Archive 不是 CogniWeave 的必经物理中转站。关键契约是 CogniWeave 只从有权限、可追溯的稳定 source identity 派生记忆。物理路径变化只更新 locator alias，不能产生第二份 evidence、第二个 operation key 或新的来源置信度。

#### 8.1.0 P0 交付姿态（关闭 B1）

**P0 将 Source Lifecycle 视为“从零新增”能力集**，验收时以公共 contracts + 持久化 schema 为准：

| 交付物               | 要求                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `SourceBinding` 模型 | id、dataPlaneId、scope、sourceType、sourceLocator、sourceChecksum、status、timestamps；SQLite/metadata migration |
| `SourceObjectLink`   | multi-source 成员关系；soft unlink                                                                               |
| 四项 API             | `archiveSource` / `restoreSource` / `forgetSource` / `purgeSource` 全部进入 `CogniWeaveEngine` 公共契约并实现    |
| 幂等与 receipt       | 见下                                                                                                             |
| OpenBot adapter      | manager 只通过 identity + watermark seal，禁止整文件 path 重放                                                   |

若某 WIP 分支已部分实现，合入主线时必须对齐本节状态机与幂等语义，不得保留“仅 forget/purge、无 archive/restore”的分叉。

P0 必须为 SDK 和 OpenBot adapter 增加以下公共契约：

```typescript
type SourceLifecycleMode = "active" | "archived" | "forgotten" | "purged";

interface SourceLifecycleOperations {
  archiveSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt>;
  restoreSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt>;
  forgetSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt>;
  purgeSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt>;
}

/** 选择器必须 exactly one；多个或全部缺失 → fail closed（参数错误，不执行状态迁移）。 */
type SourceLifecycleSelector =
  | { mode: "identity"; sourceIdentityId: string } // 正常路径：强制
  | { mode: "legacyLocator"; sourceLocator: string } // 仅迁移/双读期
  | { mode: "legacyBinding"; sourceBindingId: string }; // 仅迁移/双读期

type SourceLifecycleInput = {
  operationId: string;
  selector: SourceLifecycleSelector;
  subject: CogniWeaveSubjectContext;
  reasonCode: string;
  expectedStatus?: SourceLifecycleMode;
};

// 反例（禁止）：同时传入 sourceIdentityId + sourceLocator；或三者皆空。

type SourceLifecycleReceipt = {
  operationId: string;
  sourceIdentityId: string;
  previousStatus: SourceLifecycleMode;
  currentStatus: SourceLifecycleMode;
  affectedObjectCount: number;
  completedAt: string;
};
```

1. `archiveSource`：`active → archived`；**保留** source-object links，只改变可见性；**不得** unlink。
2. `restoreSource`：**仅当** `previousStatus === archived` 时 `archived → active`；不重新 ingest，不产生新 atom；`forgotten`/`purged` 必须抛错。
3. `forgetSource`：`active|archived → forgotten`；撤销可检索支撑（soft unlink + recompute）；不删除 transcript。
4. `purgeSource`：`active|archived|forgotten → purged`；永久清理；不可恢复。
5. 所有操作必须幂等，并返回 operation/receipt ID、前后状态和受影响对象计数。
6. 检索必须显式接收 archive visibility policy；禁止仅因 source archived 就绕过主体 ACL。
7. 增量 ingest 使用 §5.3 分段与 watermark；**禁止**对已 seal range 因 append 或 `syncReason` 变化整文件重放。
8. **选择器契约（T2）**：正常运行路径 **必须** `selector.mode === "identity"`；`legacyLocator` / `legacyBinding` 仅允许迁移器与明确标记的 dual-read 工具路径使用。解析到 0 或 >1 个 canonical source 时 fail closed，不得静默挑选。

### 8.1.1 OpenBot adapter 对 transcript 的 seal 职责

1. 扩展 `session-files` 提取：输出每条消息的 `{ id, parentId?, role, text, turnIndex }`。
2. 维护 per-binding `TranscriptIngestWatermark`（Catalog 或 CW metadata）。
3. 仅对 watermark 之后的完整段调用 `writeBack`/`ingest`，metadata 带 `openbotSourceIdentityId`。
4. operation key / checksum 排除 path 与 syncReason（§5.3.4）。

### 8.2 记忆准入

候选记忆至少满足以下一类信号：

1. 用户明确表达“请记住”等持久意图。
2. 同一偏好或约束在多个有效场景中重复出现。
3. 已批准的协作组决策、流程规则或升级路径。
4. 管理员通过受控入口发布。

下列内容默认不晋升：

- 单次临时格式指令
- 未确认的推测
- 过期任务状态
- 纯工具输出或错误堆栈
- 无来源、无权限或来源已被 purge 的内容

### 8.3 记忆 scope

| 场景             | workspace               | project            | agent      | visibility |
| ---------------- | ----------------------- | ------------------ | ---------- | ---------- |
| 个人机器人       | 用户/租户受控 workspace | `agent:<agentId>`  | 当前 agent | private    |
| 协作组公共       | 企业 workspace          | `space:<groupId>`  | shared     | shared     |
| 协作组机器人私有 | 企业 workspace          | Agent 私有 project | 当前 agent | private    |

机器人因参与群聊而看到的信息，不得自动从 private 提升到 shared。

`conversationId` 只作为 provenance 和撤回索引，不加入 scope partition key。否则同一 agent/seat/space 的长期记忆会被切碎成互不积累的会话孤岛。

### 8.4 Archive、Restore、Forget 和 Purge

Archive：

1. transcript 完成目标存储写入和 checksum 校验后，Catalog 才进入 `ARCHIVED`，并写入 `lifecycleStatusBeforeArchive`。
2. 对该 conversation 下各 binding 的 active SourceBinding 调用 `archiveSource`（可逆 links）。
3. 是否参与搜索、Memory Center 展示或模型注入，分别由 policy 决定。

Restore：

1. 复用原 Conversation、binding、session 和 source identity；lifecycle 恢复到 `lifecycleStatusBeforeArchive ?? CLOSED`。
2. 对每个 source 调用 `restoreSource`；若 status 不是 `archived`，跳过并审计，**不得**从 forgotten/purged 恢复。
3. 恢复失败不得创建第二条 live transcript 或重复 ingest。

Forget：

1. 是记忆治理操作，不等同于删除聊天记录。
2. 多来源 atom 只移除指定来源的支撑，仍有有效来源时不得误删。

Purge 必须由持久、幂等状态机执行（步骤可逆性见 §5.7.1）：

1. 校验权限和 legal hold。
2. 将 Conversation 的 `retentionState` 标记为 `PURGE_PENDING`；保存 pre-purge 快照供可取消窗口使用。
3. **FREEZE**（可逆）：阻止新 run、projection 和 memory ingest；拒绝 history/search（ACL 标记，**非** purgeSource）。
4. 在任何 irreversible 步骤前写入不可变 purge manifest。
5. **原子写入 `irreversibleStartedAt`**，然后 **MEMORY_REVOKE**：`purgeSource` / hard unlink + recompute + tombstone，分步 receipt。此后禁止 CANCELLED。
6. **DERIVED_DELETE**：projection、全文/向量索引及派生对象。
7. **CONTENT_DELETE**：transcript、archive aliases 和附件；云端删除通过 durable outbox 重试。
8. **VERIFY**：所有 locator 不可读、source 不可检索、多来源 atom 未误删。
9. 写入 purge receipt（无原文）。
10. lifecycle → `DELETED`，保留最小 tombstone。

若 MEMORY_REVOKE 暂时失败：原文保持 FREEZE 且不可访问，保留 manifest 与定位信息，job 为 `FAILED_RETRYABLE`，**不得**取消，只能重试。

### 8.5 Checkpoint / transcript 截断与记忆撤回（关闭 B3）

现有 `chat.restore` 会截断 live transcript（`truncateTranscriptToBoundary`）并可能归档尾部，但 `SessionTranscriptUpdate` 仅有 `sessionFile`，记忆层无法区分 append 与 revoke。

#### 8.5.1 事件契约

```typescript
type TranscriptChangeKind =
  | "APPENDED"
  | "TRANSCRIPT_RANGE_REVOKED" // checkpoint restore / user undo tail
  | "TRANSCRIPT_TRUNCATED" // hard truncate without archive
  | "FILE_REMOVED"
  | "ARCHIVED"
  | "RESTORED";

type SessionTranscriptUpdate = {
  sessionFile: string;
  kind: TranscriptChangeKind;
  sessionId?: string;
  bindingId?: string;
  conversationId?: string;
  /** Inclusive boundary remaining in live transcript (last kept message id). */
  boundaryTurnId?: string;
  boundaryTurnIndex?: number;
  /** Source identities fully after boundary that must be forgotten. */
  revokedSourceIdentityIds?: string[];
  /** Optional archive path of removed tail. */
  revokedTailArchivePath?: string;
  occurredAt: string;
};
```

#### 8.5.2 处理要求

1. `chat.restore` / 任何截断 live transcript 的路径在完成文件操作后 **必须** 走 §8.5.3 的同步撤回路径（不得仅依赖现有 void `emitSessionTranscriptUpdate(sessionFile)`）。
2. 事件 payload 使用 §8.5.1：`kind` 为 `TRANSCRIPT_RANGE_REVOKED` 或 `TRANSCRIPT_TRUNCATED`，填入 boundary 与 `revokedSourceIdentityIds`（由 sealed ranges + ingest watermark 计算）。
3. 对每个 `revokedSourceIdentityId` 执行幂等 `forgetSource`（可经 outbox 异步 drain，见 §8.5.3）；不得等待下次全量 scan。
4. ingest watermark 回退到 boundary；boundary 之后的 unsealed 文本丢弃。
5. 仅 `APPENDED` 时才 seal 新 range；revoke 不得触发对旧 range 的 re-ingest。
6. 负向验收：`chat.restore` **返回成功之后**的任意 `searchMemory` / Memory Center / 模型注入，尾部独有 atom 召回为 0；多来源 atom 保留其他有效来源。

#### 8.5.3 同步确认机制（关闭 B6）

现状：`SessionTranscriptListener` 返回 `void`，`emitSessionTranscriptUpdate` 无法等待 CogniWeave 完成 `forgetSource`。仅广播 payload **不足以**满足“同一请求周期内不可召回”。

备选机制（实现择一即可；**P0 选定第 3 种**）：

| 编号 | 机制                                                | 要点                                                                                                                         |
| ---- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | `emitSessionTranscriptUpdateAndWait`                | listener 可返回 `void \| Promise<void>`；REVOKED/TRUNCATED 时 `await Promise.allSettled`；失败则 restore 失败或进入强制 deny |
| 2    | `chat.restore` 直接等待 revoke service              | restore 路径同步调用 `ConversationMemoryRevokeService.revokeRanges(...)`，不经 fire-and-forget bus                           |
| 3    | **durable outbox + 同步 deny watermark（P0 选定）** | 见下                                                                                                                         |

**P0 强制采用机制 3**（与现有 void listener 兼容，且 fail-closed）：

```text
chat.restore / truncateTranscriptToBoundary 成功截断文件后，在同一请求内原子完成：

  1. 计算 boundaryTurnId + revokedSourceIdentityIds
  2. 同步写入 MemoryRecallDenyWatermark（或 per-scope deny set）：
       - dataPlaneId, bindingId/sessionId
       - deniedSourceIdentityIds[]
       - boundaryTurnId / boundaryTurnIndex
       - reason = CHECKPOINT_RESTORE | TRANSCRIPT_TRUNCATE
       - createdAt
     该写入必须在 restore RPC 返回成功之前 fsync/commit。
  3. 追加 durable revoke outbox 行（同一事务或严格先 watermark 后 outbox）：
       - payload = SessionTranscriptUpdate (kind=TRANSCRIPT_RANGE_REVOKED|…)
       - status = PENDING
  4. 可选：best-effort 同步 drain outbox（调用 forgetSource）；失败不回滚 transcript，
     但 watermark 已生效，召回仍拒绝。
  5. 然后才可 emit 兼容 APPENDED 风格的通知（void listener 仅作缓存刷新提示）。

检索 / 注入 / Memory Center 路径：

  - 在返回任何 atom/evidence 前必须检查 deny watermark。
  - sourceIdentityId ∈ denied 集合 → 过滤；不得因 forgetSource 尚未完成而放行。
  - forgetSource 全部成功且 recompute 完成后，outbox → SUCCEEDED；
    deny 条目可保留（幂等）或在 status=forgotten 可证明后回收。
```

约束：

1. **召回正确性**由同步 deny watermark 保证，不由 void 事件总线保证。
2. **记忆状态收敛**由 durable outbox 保证；进程崩溃后启动必须 drain PENDING revoke。
3. 禁止：`chat.restore` 在未 commit deny watermark 时返回成功。
4. 若实现额外采用机制 1 或 2 以加速 forget，仍 **不得**省略 deny watermark（双重保障允许；省略 watermark 不允许）。

---

## 9. 协作小组执行设计

### 9.1 三层上下文

```text
Group public transcript
  -> Shared Task Context
    -> per-agent execution session and private memory
```

公共 transcript 记录员工可见的输入、机器人可见回复、协作轮次和受控系统事件。

Shared Task Context 只保存：

- 使命与当前阶段
- 已批准目标与决策
- 硬约束
- 任务、交付物和审阅引用
- 未解决问题

机器人私有执行 session 保存：

- 角色专用的执行细节
- 私有工作区证据
- 未发布草稿
- 不应暴露给其他成员的数据

### 9.2 写入权限

| 对象        | 提议                 | 批准                         | 覆盖                 | 查看       |
| ----------- | -------------------- | ---------------------------- | -------------------- | ---------- |
| 使命/硬约束 | owner/coordinator    | owner/授权管理者             | 同批准权             | 有效成员   |
| 决策        | 成员机器人/人        | owner/coordinator/指定审批者 | 批准者               | 有效成员   |
| 任务状态    | assignee/coordinator | 按任务规则                   | assignee/coordinator | 有效成员   |
| 交付物引用  | owner/assignee       | 按交付规则                   | owner/资产所有者     | 按资产 ACL |

具体角色名称必须复用现有 Group Profile 与 Participation Overlay，不新建第二套成员权限表。

### 9.3 成员变更

1. 新成员默认只读加入后的上下文，是否可读历史由组策略决定。
2. 移除成员后立即禁止其检索公共 transcript 和 shared memory。
3. 移除机器人不得删除已发布的公共消息或其他来源支撑的公共 memory。
4. 组归档后停止新轮次和 memory promotion，但按 retention policy 保留查看、导出和审计。

---

## 10. 员工端产品与交互

### 10.1 信息架构

```text
机器人
├── 新建对话
├── 当前对话
├── 最近对话
└── 已归档

协作小组
├── 新建讨论
├── 当前讨论
├── 最近讨论
└── 已归档
```

侧边栏不默认展开无限历史。每个入口首屏只显示最近有限数量，其余进入独立历史视图。

### 10.2 会话行为

| 行为   | 用户结果           | 系统结果                                        |
| ------ | ------------------ | ----------------------------------------------- |
| 新建   | 打开空白对话       | 创建 Conversation + Session + transcript header |
| 切换   | 加载最新历史页     | 更新活跃 conversation，不复制 transcript        |
| 重命名 | 标题立即更新       | `titleSource=USER`，禁止自动标题覆盖            |
| 关闭   | 标记任务完成       | 生成最终 projection，保持可搜索                 |
| 归档   | 移出默认列表       | 归档 transcript，保持可恢复                     |
| 恢复   | 回到最近列表       | 恢复为 CLOSED 或 ACTIVE，不重建新会话           |
| 删除   | 显示风险与策略结果 | 进入 purge FSM，可能因 legal hold 拒绝          |

### 10.3 历史加载

1. 首次打开只加载最新一页。
2. 向上滚动时通过 cursor 加载更旧消息。
3. 切换会话时取消上一会话未完成的历史请求。
4. 消息高度不得因旧页插入而使当前视口跳动。
5. 归档历史显示明确的只读状态，发送前必须恢复或创建新对话。

### 10.4 自动标题

1. 优先用第一条有效用户消息做规则标题。
2. 只有标题无法读或达到明确阈值时才异步使用模型优化。
3. 标题生成不阻断首次回复。
4. 用户重命名后永不自动覆盖。
5. 标题输出必须过敏感信息与长度限制。

### 10.5 搜索交互

搜索首版不以“AI Search”作为唯一入口，应先提供可预期的筛选和关键词搜索：

- 关键词
- 机器人或协作组
- 时间范围
- 参与者
- ACTIVE/CLOSED/ARCHIVED
- 有无决策、待办或交付物

语义搜索作为第二层能力，每个命中必须返回可见的会话、时间、摘要和证据定位。

---

## 11. 企业治理与安全

### 11.1 必须的治理能力

1. 租户级 retention policy。
2. 按用户、席位、机器人、组和时间的导出。
3. legal hold 及其审批、解除和审计记录。
4. 归档、删除、恢复、purge 和记忆撤回审计事件。
5. 企业私有部署和云端部署一致的 repository 契约。
6. 静态加密、传输加密、密钥轮换和备份保留需纳入部署验收。

### 11.2 数据分类

| 类型              | 默认分类             | 搜索                | 记忆晋升             |
| ----------------- | -------------------- | ------------------- | -------------------- |
| 普通用户消息      | confidential         | 按 conversation ACL | 按准入策略           |
| 凭证、token、密钥 | restricted           | 不建索引            | 禁止                 |
| 工具输出          | inherited/restricted | 默认不全文          | 默认禁止             |
| 已批准组决策      | group confidential   | 组 ACL              | 可晋升到 group scope |
| 公开交付物引用    | 按资产策略           | 按资产 ACL          | 只记引用/稳定结论    |

### 11.3 禁止行为

1. 不得依赖前端隐藏作为权限控制。
2. 不得将其他租户的命中先放入结果后过滤。
3. 不得在异步摘要队列中携带无过期时间的完整原文副本。
4. 不得因用户从列表移除会话就默认 purge transcript。
5. 不得在 legal hold 期间通过迁移、缓存清理或索引重建绕过保留。

---

## 12. 可观测性与 SLO

### 12.1 主要指标

| 类别         | 指标                                                       |
| ------------ | ---------------------------------------------------------- |
| Conversation | create/list/get/archive/restore/purge 成功率和 P50/P95/P99 |
| History      | 首页加载时延、页大小、超大消息替换数                       |
| Context      | 总 Token、各来源 Token、裁剪数、overflow 数                |
| Summary      | 生成时延、成功率、重试率、重复生成率、证据覆盖率           |
| Memory       | ingest 延迟、准入率、冲突率、ACL 拒绝数、撤回时延          |
| Retention    | 待归档数、待 purge 数、legal hold 拦截数、失败重试数       |
| Quality      | 任务续接正确率、决策保留率、记忆错误召回率、隐私越界数     |

### 12.2 初始 SLO

以下是评审起点，上线前必须用真实数据回放调整：

- Conversation metadata API P95 小于 100 ms。
- 本地 history 最新页 P95 小于 150 ms。
- Context assembly P95 小于 150 ms，不含模型推理。
- 本地 memory retrieval P95 小于 200 ms。
- Projection 生成不增加主对话首 Token 延迟。
- 租户或用户越权返回数为 0。
- Purge 收据与实际删除对象不一致数为 0。

### 12.3 成本验证

不把“Token 降低 90%”作为固定验收标准。建立回放数据集，对比：

1. 未压缩历史。
2. 现有 compaction。
3. 本方案的动态预算 + projection + governed memory。

同时检查输入 Token、输出 Token、首 Token 延迟、总延迟、任务正确率、决策丢失率和错误记忆注入率。

---

## 13. 分阶段执行计划

### 13.1 P0 契约、来源生命周期与治理基线

目标：先冻结并验证 Conversation、tenant data plane、transcript 和 CogniWeave 的集成边界，使后续 UI、runtime、搜索和 retention 可独立演进。P0 未通过前不得开放 Archive、Restore 或 Purge 产品入口。

#### CL-P0-01 域模型和 ID 契约

Owner: Gateway/Architecture

Deliverables:

- ConversationRecord 类型与 schema validation（含 `lifecycleStatusBeforeArchive`）
- ConversationSessionBinding 类型
- Conversation 聚合多个 transcript stream 的 cardinality 约束
- USER/SEAT/GROUP ownership scope 与 usage ACL 分离
- lifecycle/storage/retention 枚举与 §3.8 状态机
- ID 生成、大小写、编码与稳定性契约
- 从现有 session 到 Conversation 的惰性映射规则

Acceptance:

- 同一 session 重复映射得到同一 conversationId。
- 不同租户、用户或组不会发生 ID 冲突。
- 兼容 `main`、`agent:<id>:main` 和 `space:<id>` 等现有 key。
- 单机器人恰有一个 `PRIMARY`，协作会话恰有一个 `GROUP_PUBLIC` 且可绑定多个 `AGENT_EXECUTION`。
- 企业席位继任不改变 Conversation、transcript 或 memory provenance。
- Archive→Restore 恢复到归档前 ACTIVE/CLOSED（缺省 CLOSED），用例可测。

#### CL-P0-02 Conversation Catalog repository

Owner: Persistence/Gateway

Deliverables:

- 本地与托管模式共用 repository interface
- 本地 Catalog 位于 Data Root，托管 Catalog 位于 authenticated tenant data plane
- 原子 create/update/list/get
- cursor 分页
- etag 并发控制
- Catalog 备份、migration 和损坏恢复规则
- legal hold、审计和 purge receipt 的 canonical durable tables

Acceptance:

- Catalog 故障不损坏 transcript。
- 可从 session store 和 transcript header 重建非治理字段的最小 Catalog；治理字段从 Catalog 备份或治理日志恢复。
- 不保存消息正文。
- State Dir 中不存在 Catalog、legal hold 或 purge receipt 的唯一副本。

#### CL-P0-03 ACL 和 retention 契约

Owner: Enterprise Governance/Security

Deliverables:

- Conversation principal 与现有租户/席位/组身份的映射
- authenticated TenantContext 到 `dataPlaneId/tenantId` 的 fail-closed resolver
- 读、写、归档、导出、purge 权限矩阵
- RetentionPolicy schema
- legal hold 状态机和审计事件

Acceptance:

- 跨租户、非组成员和已移除成员用例全部拒绝。
- legal hold 可拦截 purge，但不阻止授权查看和导出。
- Catalog、archive、export 和 CogniWeave 在同一请求中解析到同一 data plane。
- 缺失或伪造 TenantContext 不得回退到默认路径。

#### CL-P0-04 CogniWeave source identity、分段与生命周期契约

Owner: CogniWeave/Gateway Memory

Deliverables:

- **从零**交付持久化 `SourceBinding` / `SourceObjectLink`（或等价）及 schema migration
- SDK 公共契约与实现：`archiveSource`、`restoreSource`、`forgetSource`、`purgeSource`（四项齐全，§8.1.0）
- `MemorySourceIdentity` + `turnIndexRange` + `contentChecksum` canonical encoding 与 validation（§5.3）
- 消息 ID 保留：JSONL 写入、`session-files` 提取、合成 ID 规则
- `TranscriptIngestWatermark` + 确定性 seal 算法；禁止整文件 path 重放
- operation key 排除 path / syncReason
- live/archive/cold locator alias repository
- archived source 检索与模型注入策略
- manager 对 `SessionTranscriptUpdate.kind`（含 `TRANSCRIPT_RANGE_REVOKED`）的显式处理（§8.5）
- 旧 `openbotPath` → identity + alias 幂等迁移器
- projection dependency 规则，禁止重复来源计数
- Source 状态机测试：`restoreSource` 拒绝 forgotten/purged

Acceptance:

- 同一 transcript 在 live/archive/cold 路径间移动后 source ID、atom 数和来源计数不变。
- 追加 N 条消息只 seal 新 range；已 seal range 的 atom 数不因 append 增加。
- archive 后 links 保留；restore 不 re-ingest；forgotten/purged 不可 restore。
- forget/purge 唯一来源后 atom 不可检索，多来源 atom 仍保留其他有效支撑。
- `chat.restore` 截断后，尾部独有记忆在同一请求周期内不可召回。
- manager 重启、文件移除、事件重放不会留下无法追踪的 active source。

#### CL-P0-05 Purge FSM 契约和最小执行器

Owner: Enterprise Governance/Persistence

Deliverables:

- purge manifest、step state、receipt、`irreversibleStartedAt` 与最小 tombstone schema
- 步骤 `irreversible` 标记；取消仅允许屏障前（§5.7.1）
- 分步幂等、重试；屏障后禁止 CANCELLED
- legal hold 与并发 run/archive/restore 的互斥规则
- transcript、附件、projection、index 和 CogniWeave 的 adapter contract
- 本地模式最小执行器和故障注入 harness（含：屏障后取消被拒、MEMORY_REVOKE 失败可重试）

Acceptance:

- manifest 与 FREEZE 完成前不会调用 `purgeSource` 或物理删除。
- `irreversibleStartedAt` 写入与首个 irreversible 步骤的启动同事务或先写后执行。
- 屏障后 `conversations.purge.cancel`（若有）返回错误；崩溃重启后从已记录步骤续跑。
- receipt 与实际可读取对象、source binding 和索引状态一致。

#### CL-P0-06 Transcript 事件与 checkpoint 撤回

Owner: Gateway Runtime / CogniWeave

Deliverables:

- 扩展 `SessionTranscriptUpdate`（§8.5.1）
- **`MemoryRecallDenyWatermark` + durable revoke outbox**（§8.5.3 机制 3）
- `chat.restore` / truncate：截断文件后 **先** 同步 commit deny watermark 与 outbox，**再** 返回成功
- outbox worker：幂等 `forgetSource`；崩溃可续跑
- 检索/注入路径强制检查 deny watermark
- 契约测试与集成测试

Acceptance:

- `chat.restore` 返回成功后的**同一请求周期及之后**任意召回：尾部独有 atom 为 0（即使 forgetSource 尚未完成）。
- 多来源 atom 不被误删。
- 未写入 deny watermark 时 restore 不得返回成功。
- 仅 path 的 legacy emit 在 P0 兼容期内映射为 `APPENDED` 并打 metric，P1 后禁止。

#### P0 Gate

- 领域类型、repository、ACL、retention、**完整四项** source lifecycle、分段 watermark、revoke 事件与 purge FSM 通过架构评审与契约测试。
- 明确 JSONL transcript 是唯一消息事实源。
- 不存在新 `conversation_message` 双写。
- 完成上述权限负向测试与 B1–B4 验收用例。
- Catalog 位于正确 data plane，路径迁移不产生重复 memory source。
- Archive/Restore/Forget/Purge SDK 行为与 purge 最小执行器通过重启故障注入。
- `lifecycleStatusBeforeArchive` restore 目标用例通过。

### 13.2 P1 员工端显式会话

目标：让用户可见、可操作地管理多会话，不修改 Agent 上下文逻辑。

#### CL-P1-01 Conversation CRUD API

Owner: Gateway

Deliverables:

- create/list/get/rename/close/archive/restore 及持久 job 状态查询
- `sessions.list` 到 Conversation Catalog 的兼容投影
- 自动标题规则与异步优化 hook
- 完整审计事件

Acceptance:

- 同一机器人可创建两个完全独立的对话。
- 归档不删除 transcript，恢复后消息完整。
- 归档前完成目标副本 checksum 校验，失败时原 live transcript 和 Catalog 状态不变。
- 恢复复用原 binding/source identity，不重复形成 CogniWeave evidence 或 atom。
- 用户标题不被自动标题覆盖。

#### CL-P1-02 History cursor API

Owner: Gateway/Transcript

Deliverables:

- `chat.history` cursor 分页
- live/archive 共用的 bounding/sanitization
- 稳定顺序和页面去重
- archive 只读契约

Acceptance:

- 连续加载 10 页无重复、无丢失、顺序一致。
- 单条超大消息不使整页失败。
- 读取他人 archiveId 被拒绝。

#### CL-P1-03 Employee UI

Owner: Employee UI

Deliverables:

- 机器人/协作组下的最近会话
- 新建、切换、重命名、关闭、归档、恢复
- 历史独立视图和筛选
- 滚动分页、加载、空状态、错误、重试和离线状态
- 手机端和窄屏交互

Acceptance:

- 切换机器人、组和会话时不串历史。
- 快速连续切换时旧请求不覆盖新会话状态。
- 归档视图无法直接发送消息。
- 桌面和移动视口通过视觉回归。

#### P1 Gate

- 员工可完成多会话闭环。
- 旧员工端主 session 可无损升级。
- 不改变外部渠道的 session routing。
- 无 transcript 双写。
- Archive/Restore 不调用旧的 cfg-only best-effort helper，也不依赖 `sessions.delete` 的先移动后归档顺序。

### 13.3 P2 上下文与摘要

目标：在现有 compaction 上增加可观测的动态预算和产品摘要。

#### CL-P2-01 Context Budget Planner

Owner: Agent Runtime

Deliverables:

- 按模型解析实际 context window
- 必选/可选上下文分类
- Token 预算与裁剪原因
- 与现有 compaction/contextPruning 的唯一集成点
- context trace

Acceptance:

- 动态预算不丢失 system policy 和当前输入。
- 小上下文模型和大上下文模型都能完成回放。
- 不产生 ineffective dynamic import 警告。

#### CL-P2-02 Conversation Projection Worker

Owner: Conversation Runtime

Deliverables:

- Projection schema 和版本化
- 规则摘要优先、模型摘要可选
- 触发器、去重、重试和旧 revision fallback
- evidence refs 生成与校验
- 异步执行，不阻塞主回复

Acceptance:

- 同一有序 source identity/checksum 集合不重复生成。
- 缺少 evidence 的决策不进入 approved decisions。
- 摘要失败时 Agent 对话正常。

#### CL-P2-03 Evaluation harness

Owner: QA/Agent Quality

Deliverables:

- 长对话回放集
- 决策、金额、日期、ID、待办和文件路径保留用例
- baseline/compaction/new planner 三组对比
- Token、延迟、正确率和幻觉报告

#### P2 Gate

- 回放正确率不低于现有 compaction baseline。
- 上下文超限数不高于 baseline。
- Projection 不增加主回复 P95 首 Token 延迟。
- 所有裁剪均有可诊断原因。

### 13.4 P3 协作组共享上下文

目标：在现有公共 transcript、Agent execution session 和 group governance 上建立可控 Shared Task Context。

#### CL-P3-01 Conversation binding

Owner: Collaboration Runtime

Deliverables:

- public/execution/legacy binding
- 组会话和 Agent session 的 lineage
- 一个 `GROUP_PUBLIC` 与多个 `AGENT_EXECUTION` transcript stream 的聚合约束
- 机器人加入、移除和组归档事件

Acceptance:

- 每条 Agent 执行结果可追溯到公共 conversation/round。
- 不复制公共 transcript 到每个 Agent Catalog。
- 默认 history 只返回 `GROUP_PUBLIC`；私有 execution stream 不因共享 conversationId 自动可见。

#### CL-P3-02 Shared Task Context

Owner: Collaboration Core/Gateway

Deliverables:

- SharedTaskContext schema、repository 和 revision
- 从现有 task/decision/deliverable/group profile 投影
- 提议、批准、覆盖和 supersede 规则
- context injection 预算

Acceptance:

- 未批准的决策不作为硬约束注入。
- 私有 Agent 内容不出现在 shared context。
- 决策 supersede 后旧值不再作为当前真相注入。

#### CL-P3-03 Group ACL regression

Owner: Security/QA

Deliverables:

- 成员加入/移除/停用/重新加入矩阵
- owner/member/bot/coordinator 矩阵
- 历史可见策略测试
- group archive/restore/purge 测试

#### P3 Gate

- 不存在私有内容泄露到组 context 的用例。
- 移除成员后的历史和 memory 访问在同一请求周期内失效。
- 现有协作轮次调度和回复上限测试通过。

### 13.5 P4 搜索、记忆与企业存储

目标：在 P0 已稳定的 ID、ACL、source lifecycle 和 purge contract 上开放高级检索、记忆准入与企业级存储自动化。

#### CL-P4-01 Conversation search

Owner: Search/CogniWeave

Deliverables:

- metadata 筛选
- transcript 全文索引
- projection 结构化索引
- CogniWeave evidence 语义检索
- 命中合并、去重、排序和 evidence deep link
- transcript 与 projection 的依赖去重，禁止同一 source 重复增加相关性或置信度

Acceptance:

- 所有搜索候选在排序前已通过 ACL。
- 归档命中尊重 `archiveSearchEnabled`。
- 点击命中能定位到对话和消息附近，不泄露不可见原文。

#### CL-P4-02 Memory admission and revocation

Owner: CogniWeave

Deliverables:

- 明确/重复/批准三类晋升信号
- 单次临时指令抑制
- 在 P0 source lifecycle 上实现 candidate/admitted/active/superseded 状态与 conflict 规则
- 用户可见来源与忘记操作

Acceptance:

- 删除唯一 source 后 atom 不再可检索。
- 删除多来源 atom 的一个 source 不会误删其他有效来源。
- private atom 不出现在 shared scope。

#### CL-P4-03 Retention and storage tier worker

Owner: Persistence/SRE

Deliverables:

- hot/warm/cold 迁移状态机
- archive object manifest 和 checksum
- 失败重试、断点恢复和幂等
- retention/legal hold/purge scheduler
- 本地和企业存储 adapter
- locator alias 原子切换和旧 locator 回收

Acceptance:

- 中断迁移后 canonical transcript 至少保留一份完整副本。
- checksum 不一致时不删除源文件。
- legal hold 对所有定时清理生效。
- storage tier 迁移前后 CogniWeave source identity 和来源计数不变。

#### CL-P4-04 Export and purge

Owner: Enterprise Governance

Deliverables:

- 用户和管理员导出
- 导出 manifest、校验和、范围和审计收据
- 将 P0 purge FSM 扩展到完整 adapter、批处理调度和 CogniWeave 级联撤回
- 失败修复和完成校验工具

Acceptance:

- 物理删除前存在完整、不可变且可重放的 purge manifest。
- 任一 adapter 失败不会将任务误标为完成，重启后可继续。
- 完成收据与 transcript、archive aliases、附件、索引和 CogniWeave 的实际状态一致。
- legal hold 和租户边界在所有定时与人工 purge 路径上生效。

#### P4 Gate

- 语义搜索通过隐私和准确率门槛。
- 完成 archive/restore/export/purge/Forget 全链路故障注入。
- 私有部署和托管部署使用同一契约测试套件。
- 全部审计收据不包含未脱敏原文。

---

## 14. 迁移方案

### 14.1 迁移原则

1. 惰性回填，不在首次升级时扫描所有 transcript 生成模型摘要。
2. 只先生成最小 ConversationRecord 和 binding。
3. 打开、搜索或归档时按需回填 projection。
4. 迁移期间旧 `sessions.list` 和 `chat.history` 继续可用。
5. 回填必须幂等，并保留 migration version 和错误记录。

### 14.2 惰性映射

当 `conversations.list/get` 发现 session 无 Conversation binding 时：

1. 解析 session key 的 agent/group/surface 身份。
2. 从已验证的当前请求上下文取 tenant/user/seat。
3. 使用由服务端生成的 `dataPlaneId + sessionId + bindingRole` 稳定 migration key 查找既有 binding；不使用可变 session key 或客户端 tenantId 作为唯一键。
4. 不存在时原子创建 ConversationRecord 和 binding。
5. 本地个人会话回填 `USER` ownership；企业机器人会话优先使用已验证 seat；协作会话使用 group ownership，禁止把员工账号误写为企业资产 owner。
6. 标题使用现有 derived title/label/subject 回填。
7. 不打开 transcript 也可完成最小回填。

### 14.3 CogniWeave 来源迁移

当前 local metadata canonical store（见 `packages/cogniweave-sdk` adapters）**没有**独立 `SourceBinding` 表；既有结构为 `ingestions`、`events`、`atoms`、`evidence`、`journals` 等。迁移 **不得**假定已有 SourceBinding 行可枚举。

1. **从 legacy provenance 合成初始 SourceBinding**（只读扫描，不复制 atom 正文）：
   - 扫描 `ingestions` / `events` / `evidence` / `journals` 中与 OpenBot transcript 相关的 locator 与 provenance 字段（如 `openbotPath`、session 路径、sessionId、历史 `sourceTurnRange`、content checksum 若有）。
   - 按 `(dataPlaneId, normalizedLocator 或 sessionId, turn 边界或整文件 legacy key)` 聚类为候选来源。
   - 为每个候选 **insert** 新 `SourceBinding`（status 由是否仍可检索推导，默认 `active`）+ `MemorySourceIdentity`（能确定 turn 边界则用 range；否则整文件 legacy 标记 `sourceType` 兼容值并进入待分段队列）。
2. 通过 authenticated data plane、Conversation binding 和（若可得）稳定 turn boundary 计算/回填 `MemorySourceIdentity`；无法确定边界的 legacy 源在首次 seal 时再切分为不可重叠 ranges。
3. 将原路径/旧 locator 登记为 **locator alias**，**不**复制 atom/evidence，**不**增加 source count；atom↔source 链接改为指向新 binding/identity（soft rewrite 或映射表）。
4. 同一 transcript 已存在 live 与 archive 路径时合并为一个 source identity，并保留 checksum 冲突记录供人工修复。
5. 双读验证期：lifecycle API 的 `legacyLocator` / `legacyBinding` 选择器可解析到合成后的 binding；所有**新写**只使用 `sourceIdentityId`。
6. 完成逐租户校验后停止 legacy locator 新写；旧 alias 仅用于追溯和 purge。
7. 迁移任务保存版本、cursor、失败原因和幂等 operation key，可中断恢复；重复运行不得产生重复 binding 或重复 atom 来源计数。

### 14.4 兼容开关

建议开关：

- `conversation.catalog.enabled`
- `conversation.catalog.lazyBackfill`
- `conversation.ui.enabled`
- `conversation.history.cursorEnabled`
- `conversation.sourceIdentity.enabled`
- `conversation.sourceLifecycle.enabled`
- `conversation.projection.enabled`
- `conversation.contextPlanner.enabled`
- `conversation.search.semanticEnabled`
- `conversation.retention.enforceEnabled`

开关必须支持按本地部署、租户、席位或内部试点范围逐步开放。

### 14.5 回滚

1. 关闭 Conversation UI 后回到现有机器人/协作组主 session 入口。
2. 关闭 Catalog 投影不删除 Catalog 数据，不改动 session/transcript。
3. 关闭 context planner 回到现有 compaction/contextPruning。
4. 关闭 semantic search 保留 metadata 和关键词搜索。
5. retention enforce 回滚为 warn-only，不自动恢复已 purge 数据。
6. 任何回滚都不要求 transcript 格式逆向迁移。
7. source identity 开始新写后不得回滚为路径主键；只能关闭高级生命周期入口并继续兼容读取 legacy alias。
8. **已设置 `irreversibleStartedAt`，或已进入任一 irreversible 步骤**（含 `MEMORY_REVOKE` / `purgeSource` / 硬 tombstone、`DERIVED_DELETE`、`CONTENT_DELETE`）的 purge job **不参与功能回滚**，必须继续修复到 `SUCCEEDED`/`DELETED` 终态。不得以“transcript 尚未物理删除”为由取消、回滚或降级为可逆删除。仅 `irreversibleStartedAt == null` 且尚未 SUCCEEDED 任何 irreversible 步骤的 job 可随功能开关回滚为取消（见 §5.7.1）。

---

## 15. 测试矩阵

### 15.1 单元测试

- Conversation ID 与 session binding 稳定性
- USER/SEAT/GROUP ownership 与员工离职、席位继任
- 单 Agent/协作组 binding cardinality
- MemorySourceIdentity canonical encoding、locator alias 和 legacy mapping
- lifecycle/storage/retention 状态迁移
- Catalog cursor 和 etag
- history cursor 顺序与去重
- context budget 分配与 overflow
- projection checksum、版本和 evidence validation
- memory admission、conflict、unlink 和 tombstone
- archive/restore/forget/purge 的状态转换和幂等 receipt
- retention 时间计算和 legal hold

### 15.2 集成测试

- 创建对话 -> 发送 -> 关闭 -> 恢复
- 旧 session -> 惰性回填 -> 新 UI 切换
- live transcript -> 校验归档副本 -> archive history -> 原 source identity 恢复
- live/archive/cold 路径迁移 -> source/atom/evidence 数量不变
- purge manifest -> CogniWeave 撤回 -> projection/index 删除 -> transcript/附件删除 -> receipt 校验
- purge 各步骤故障 -> Gateway 重启 -> 幂等续跑
- 协作组公共 session -> 多 Agent execution -> lineage
- 成员移除 -> history/search/memory 立即拒绝
- Catalog 损坏 -> 从备份恢复治理字段，并从现有数据校验非治理字段
- legacy `openbotPath` -> stable source identity -> alias 合并且不重复 ingest
- 冷存储中断 -> 断点恢复 -> checksum 验证

### 15.3 安全测试

- 跨租户 conversationId/sessionKey/archiveId/cursor 交换
- 缺失、伪造或错配 TenantContext 时 Catalog/archive/CogniWeave 全部 fail closed
- 删除成员使用旧 cursor 继续读取
- 恶意标题、摘要和搜索片段注入
- 路径穿越与符号链接 archive
- purge/legal hold 竞态
- archive/restore/purge 与并发新消息或 Agent run 的竞态
- 语义索引中的已撤权结果
- tool result、凭证和敏感附件的索引抑制

### 15.4 UI 测试

- 机器人与协作组分层列表
- 空状态、加载、错误、离线和权限拒绝
- 快速切换竞态
- 分页滚动锚点
- 长标题、多语言、窄屏和触摸交互
- archive 只读和 purge 确认
- 键盘导航、焦点、读屏和对比度

### 15.5 性能和长稳测试

- 1 万个 Conversation Catalog 条目分页
- 10 万条消息的单会话分页读取
- 多用户并发创建、切换和归档
- 单个协作 Conversation 绑定大量 execution stream 的分页与 ACL
- Projection 队列积压与恢复
- CogniWeave 连续 transcript delta sync
- 大批量 locator alias 迁移与 legacy source backfill
- retention worker 大批量扫描与限速
- Gateway 重启、磁盘空间不足、文件损坏和索引重建

---

## 16. 发布策略

### 16.1 试点顺序

1. 开发环境和自动化回放。
2. 内部单机器人试点。
3. 内部协作组试点。
4. 单租户小流量，retention 保持 warn-only。
5. 多租户小流量，开启归档但不开启自动 purge。
6. 完成数据导出、legal hold 和 purge 演练后再开启 retention enforce。

### 16.2 发布阻断条件

出现任一项必须停止扩大范围：

- 跨用户或跨租户历史可见
- 切换对话后消息写入错误 transcript
- 归档或迁移导致 transcript 丢失
- 归档或恢复生成重复 CogniWeave source/evidence/atom
- purge 绕过 legal hold
- purge receipt 与实际对象或 source binding 状态不一致
- 删除一个 source 导致其他有效来源的 memory 误删
- context planner 丢失 system policy 或当前输入
- 新方案在回放中的任务正确率明显低于 baseline

---

## 17. 团队边界和交付顺序

### 17.1 建议所有权

| 工作流                      | 主责团队                          | 主要边界                                     |
| --------------------------- | --------------------------------- | -------------------------------------------- |
| Tenant data plane resolver  | Gateway/Security                  | 认证上下文、fail-closed 路由、禁止全局回退   |
| Conversation domain/catalog | Gateway/Persistence               | canonical 元数据、治理状态和 binding         |
| Transcript/history          | Agent Runtime/Gateway             | 保持 JSONL canonical 与读取安全              |
| Employee UI                 | Employee Frontend                 | 只通过受控 API 读写                          |
| Context planner             | Agent Runtime                     | 和现有 compaction 唯一集成                   |
| Conversation projection     | Conversation Runtime              | 异步、版本化、可重建                         |
| Group shared context        | Collaboration Runtime/Core        | 复用 group profile/task/decision/deliverable |
| Memory                      | CogniWeave                        | stable source、生命周期、准入、撤回和检索    |
| Retention/export/purge      | Enterprise Governance/Persistence | 策略、审计、legal hold 和收据                |
| Quality and security        | QA/Security                       | 跨模块 Gate 验收                             |

### 17.2 交付顺序

1. Architecture 冻结 schema、聚合 cardinality、data plane、ACL 和 lifecycle。
2. CogniWeave/Gateway Memory 交付 stable source identity、alias migration 和 Archive/Restore/Forget/Purge 契约。
3. Governance/Persistence 交付 purge manifest/FSM 最小执行器和故障注入 harness。
4. Gateway/Persistence 交付 Catalog repository、TenantContext resolver 和 Conversation API。
5. Transcript 团队交付安全 cursor history 与原子 archive/restore adapter。
6. Employee UI 基于已通过 P0 Gate 的 API 交付显式会话。
7. Agent Runtime 交付 context planner 和 trace。
8. Projection 团队交付结构化摘要与 source dependency。
9. Collaboration 团队交付 Shared Task Context。
10. CogniWeave 交付 memory admission/revocation/search 产品能力。
11. Governance 交付完整 retention/export/purge 自动化。
12. QA/Security 通过全链路 Gate 后扩大发布。

每个实施 spec 必须指定唯一 owner，并为修改路径定义互斥的 ownership glob。共享热点文件由对应 spec owner 集成落地。

---

## 18. 工期与资源估算

以一个完整产品小队为估算单位，不将估算视为承诺：

| Phase | 建议工期      | 主要交付                                               |
| ----- | ------------- | ------------------------------------------------------ |
| P0    | 2.5 到 4 周   | 契约、Catalog、data plane、source lifecycle、purge FSM |
| P1    | 2 到 3 周     | Conversation API、员工端、history cursor               |
| P2    | 2 到 3 周     | Context planner、projection、回放评估                  |
| P3    | 2 到 3 周     | Group binding、Shared Task Context、ACL 回归           |
| P4    | 3 到 5 周     | 搜索、memory 治理、storage tier、export/purge          |
| 合计  | 11.5 到 18 周 | 不含大规模企业存储采购和外部合规审计                   |

建议最小角色配置：

- 1 名架构/Tech Lead
- 1 到 2 名 Gateway/Runtime 工程师
- 1 名员工端工程师
- 1 名 Collaboration/CogniWeave 工程师
- 1 名 QA/Security 工程师
- 产品、UX、SRE 和企业治理按 Gate 参与

---

## 19. 实施红线

1. 不新建与 JSONL transcript 长期双写的 `conversation_message` 真相表。
2. 不将固定 8k 作为所有模型的 Active Context 默认。
3. 不把 Agent policy 放在历史、summary 或 memory 之后裁剪。
4. 不用结构化产品摘要替换 runtime compaction summary。
5. 不把公共 transcript 复制成每个 Agent 的私有完整历史。
6. 不在未通过 ACL 前执行全局语义检索。
7. 不把归档、从列表移除、删除和忘记派生记忆混为一个操作。
8. 不在无 provenance 或只有一次临时指令时晋升稳定 Memory Atom。
9. 不在未完成 legal hold、导出和 purge 演练前开启自动永久删除。
10. 不以“延迟小于 2 秒”或“Token 降低 90%”的未测量宣传值代替真实回放。
11. 不把 Conversation Catalog、legal hold 或 purge receipt 的唯一副本放入 State Dir。
12. 不使用物理路径、可变 session key 或客户端 tenantId 作为 MemorySourceIdentity。
13. 不把 Projection 当作与原 transcript 并列的独立 memory source。
14. 不复用 Forget 实现 Archive，也不在 Restore 时重新 ingest 同一 source。
15. 不在 purge manifest 持久化和访问冻结前删除 transcript、附件或来源定位信息。
16. 不允许 Catalog、archive、export 与 CogniWeave 在同一请求中解析到不同 data plane。
17. 不假设 SDK 已有 forget/purge/archive/restore；P0 必须交付完整四项与 SourceBinding 持久化。
18. 不使用整文件 path 重放已 seal 的 transcript range；operation key 不得含 path/syncReason。
19. 不在 `irreversibleStartedAt` 已设置后接受 purge 取消或功能回滚。
20. 不允许 `restoreSource` 从 forgotten/purged 回到 active。
21. 不允许 checkpoint/`chat.restore` 在未同步写入 deny watermark 时返回成功；不允许仅依赖 void transcript listener 保证撤回。
22. 不允许 SourceLifecycle 选择器空输入或多重输入；正常路径必须 `sourceIdentityId`。
23. 不允许假定 legacy store 已有 SourceBinding 表；必须从 ingestion/event/evidence/journal 合成。

---

## 20. 项目完成定义

只有同时满足以下条件，才能将本项目标记为完成：

1. 员工可以在单机器人和协作组中完成多会话全闭环。
2. 现有 session/transcript 无损升级，无第二消息真相源。
3. 动态上下文预算通过长对话回放，不丢失必选策略和当前输入。
4. Runtime summary 和 Conversation projection 责任分离，且 projection 可追溯、可重建。
5. 协作组 Shared Task Context 不包含未授权私有内容。
6. 搜索、记忆和归档在排序或读取前已通过 ACL。
7. archive/restore/export/purge/Forget 及 legal hold 通过故障注入。
8. 私有部署和托管部署通过同一契约测试套件。
9. 主要 SLO、审计事件和运维修复工具已落地。
10. 发布阻断条件全部解除，完成可回滚小流量试点。
11. Conversation 可正确聚合一个公共与多个 execution transcript，且默认 history 不泄露私有 execution stream。
12. live/archive/cold 迁移不改变 stable source identity、证据数量或 Memory Atom 来源计数。
13. Archive/Restore 可逆，Forget/Purge 语义独立，且所有操作幂等可审计。
14. Catalog、governance、archive 与 CogniWeave 均通过 authenticated TenantContext 路由并在缺失上下文时 fail closed。
15. Purge 在逐步骤故障和重启后仍能完成，receipt 与全部物理、派生和记忆对象状态一致；屏障后不可取消。
16. transcript 分段与 watermark 保证 append 不重复 seal；checkpoint 回滚后尾部记忆不可召回。
17. Archive 恢复目标由 `lifecycleStatusBeforeArchive` 决定；Source 状态机禁止 forgotten/purged → active。

---

## 21. v1.2 验收对照（最终实施基线）

| 验收项                       | 文档锚点                     | 关闭条件                                         |
| ---------------------------- | ---------------------------- | ------------------------------------------------ |
| B1 Source Lifecycle 从零     | §2.3、§8.1.0、CL-P0-04       | contracts + 持久化 + 四 API 测试绿               |
| B2 分段与数字 range          | §5.3、§8.1.1                 | watermark 单测；append 不重复 atom               |
| B3 checkpoint 撤回           | §2.1、§8.5、CL-P0-06         | restore 后召回负向测试                           |
| B4 purge 屏障                | §5.7.1、§6.4、CL-P0-05       | 屏障后 cancel 拒绝；崩溃续跑                     |
| M1 archive 恢复目标          | §3.8.1、§5.1、§6.4           | beforeArchive 字段与 restore 用例                |
| B5 purge 回滚边界            | §14.5、§5.7.1                | 文案与 irreversible 步骤一致；无“仅物理删除”表述 |
| B6 revoke 同步确认           | §8.5.3、CL-P0-06             | deny watermark 先于 restore 成功返回             |
| T1 legacy 合成 SourceBinding | §14.3                        | 从 ingestion/event/evidence/journal 合成         |
| T2 lifecycle 选择器互斥      | §8.1 SourceLifecycleSelector | exactly one；冲突/缺失 fail closed               |

**Status 已标记为「最终实施基线」；可启动 P0 编码（CL-P0-01…06）。**
