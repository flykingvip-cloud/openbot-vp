# OpenBot CogniWeave CW2 完整性修复执行指令

**日期：** 2026-07-18  
**目标执行者：** Grok  
**建议 Agent ID：** `grok-cogniweave-cw2`  
**Task trailer：** `Task: cogniweave-memory-engine-v2`  
**状态：** 待执行  
**优先级：** P0，阻断 CogniWeave CW2 商业 GA

## 1. 指令目的

本指令用于完成 CogniWeave Memory Engine v2 的最终整合与完整性修复，使以下能力在同一条可构建、可测试、可提交、可恢复的 OpenBot 产品链上成立：

1. CogniWeave SDK 是独立、可发布、契约稳定的本地优先记忆 SDK。
2. OpenBot 使用 CogniWeave 作为真实运行时记忆后端，而不是仅有静态包、测试辅助函数或旁路索引。
3. transcript ingest、增量 seal、Archive、Restore、Forget、Purge、checkpoint rollback 和 recall deny 形成闭环。
4. tenant、user、seat、agent、space 和 shared scope 具备可信主体授权与跨租户隔离。
5. canonical metadata 是唯一真相；graph、vector、mirror 是可重建派生层。
6. 进程重启、并发、部分失败、网络离线、数据库迁移和重复请求不会造成记忆重复、泄露或永久状态分叉。
7. REST、Python、CLI、外部 adapter 和文档只声明已经真实实现并通过验证的能力。

本任务不是继续扩展新记忆类型，也不是增加营销 UI。首要目标是修复当前分支整合、生命周期和运行链完整性。

## 2. 已核实的当前事实

执行前必须接受以下事实，不得以已有测试数量或文档状态覆盖这些问题。

### 2.1 分支存在两套不一致实现

1. 本次审计快照中，`fix-scoped-package-templates` 位于 `435af51b45871d3128fb48b73d72e9e5c421b279`，只包含 CogniWeave v1 本地持久化基线。
2. 本次审计的 `release/candidate-20260712` 位于 `6d48918329484e2ef87c7afab1b98bb8dbb2a494`，包含约 9,841 行额外 CW2 实现，包括：
   - `packages/cogniweave-sdk/src/domain/**`
   - `packages/cogniweave-sdk/src/sync/**`
   - `packages/cogniweave-sdk/src/storage/schema-migrations.ts`
   - MemorySubject、混合检索、durable outbox、write freeze 等实现
3. Conversation lifecycle 及其 memory bridge 主要存在于未跟踪文件和 stash tree `1a0707b907`。
4. `1a0707b907` 同时包含 Docker layer、cloud-drive、UI、cron 等大量无关文件，禁止整体 cherry-pick 或整体 restore。

### 2.2 当前工作树不能形成完整构建

根级 `pnpm tsgo` 已确认存在以下直接契约断裂：

- `src/conversations/cogniweave-bridge.ts` 向 `getMemorySearchManager` 传入当前签名不支持的 `tenantId` / `dataPlaneId` / `dataRoot`。
- LocalMetadataStore 已支持 `source_bindings` + `source_lifecycle_operations` + `source_object_links` + `write_operations`（schema v4 / `data_plane_id`）；evidence/atom/event/relation/entity/scenario/problem 多来源 forget/purge（CW2-P1-00 全 objectType）、writeBack op-key 短路、`recoverFromCanonical` / `compactJournals`、CLI `doctor|recover|compact|journal-stats` 已接通；Postgres 已对齐 SourceBinding / object_links / write_operations / data_plane_id（schema + adapter）；**P0 Gate 已关闭**；**CW2-P1-02a**：canonical 默认落在 `{dataRoot}/.meta/cogniweave/` 并对 stateDir 旧库懒 cutover；**CW2-P1-03**：export/migration denylist + restore 清空 runtime 子树；**CW2-P1-02b**：memory-lifecycle→SDK Forget/Purge；**CW2-P1-02c**：durable migration FSM（freeze/rollback/roll-forward/switch-back）；**CW2-P0-04**：Ops SLO soak（Local recover p95；满配 10k 经 env）；**CW2-P1-04**：真实 Postgres 迁移演练（`createPgSqlClient` + Local→PG + recover；`COGNIWEAVE_POSTGRES_URL` / `cogniweave_drill`）。
- Conversation purge 和 source identity migration 同样依赖当前分支不存在的 CW2 API。

### 2.3 Source Lifecycle 没有闭环

最终规范要求四项非可选公共 API：

- `archiveSource`
- `restoreSource`
- `forgetSource`
- `purgeSource`

当前 release candidate 只有 `forgetSource` 和 `purgeSource`，OpenBot bridge 期待的 `applyTranscriptSourceLifecycle` 在当前及 release candidate manager 中均不存在。

### 2.4 transcript seal、deny 和 revoke outbox 尚未进入运行面

以下模块目前主要由测试调用，没有完整生产调用链：

- `src/conversations/transcript-range-seal.ts`
- `src/memory/session-source-index.ts`
- `src/conversations/memory-recall-deny.ts`
- `src/memory/recall-deny-filter.ts`
- `src/memory/revoke-outbox-drain.ts`

当前 manager 仍可能按整文件执行 writeBack。`chat.restore` 没有在返回成功前完成 deny watermark 与 durable revoke outbox 的生产接线。

### 2.5 Archive/Restore 重试会绕过 CogniWeave 补偿

> **状态（2026-07-19）**：已修复。`compensateCogniWeaveBindingLifecycle` 在 Catalog/transcript 幂等重入路径仍调用 bridge，并使用稳定 `operationId`（`conv-{mode}-{conversationId}-{bindingId}`）。回归：`src/conversations/conversation-lifecycle.archive-cw-retry.test.ts`。

历史问题：Conversation service 在 transcript/Catalog 已经归档或恢复时直接按幂等成功继续处理。若第一次请求在 Catalog 成功后、CogniWeave 失败，第二次请求可能跳过 CogniWeave 调用并返回成功，形成永久状态分叉。

### 2.6 企业 ACL 修复未进入当前分支

当前 `CogniWeaveMemoryManager.readFile` 会扫描全局 `EMBEDDED_SCOPE_STATES`，没有可靠的 tenant/user/seat 主体授权。release candidate 中已有相关修复，但尚未整合到当前产品分支。

### 2.7 外部服务与多语言 SDK 仍是部分实现

1. runtime factory 无法注入真实 Postgres、Neo4j、pgvector client。
2. pgvector adapter 声明 similarity search，但没有真实 `search()`，写入 embedding 仍为 `null`。
3. Neo4j adapter 声明 path query，但没有查询接口进入 runtime retrieval。
4. Postgres metadata 尚未达到 SourceBinding、SourceObjectLink、MemorySubjectBinding 的 CW2 parity。
5. `evidenceBackend` 是配置字段，但没有独立 evidence adapter 闭环。
6. REST、Python、CLI 没有 CW2 lifecycle、hybrid search、promotion 和 Memory Center parity。

## 3. 执行基线与隔离要求

### 3.1 唯一基线

1. 由人工操作者创建隔离 worktree 和分支，建议：
   - 分支：`grok-cogniweave/cw2-integrity-remediation`
   - 已审计基线：`release/candidate-20260712` 的 `6d48918329484e2ef87c7afab1b98bb8dbb2a494`
2. 开始时记录 `git symbolic-ref --short HEAD` 与 `git rev-parse HEAD`。如 release candidate 已移动，必须先审查新增 commit 相对上述 SHA 的差异，不得盲目把可变 branch ref 当作已验证基线。
3. Grok 不得自行切换当前共享工作树分支，不得创建或删除 worktree，除非操作者明确授权。
4. 以 release candidate 的 CW2 SDK 内核为基础，定向引入 Conversation/memory 文件。
5. 不得把当前 billing、UI、cloud-drive 或其他任务 WIP 带入本任务。

### 3.2 禁止整体导入 stash tree

禁止：

```bash
git cherry-pick 1a0707b907
git restore --source=1a0707b907 -- .
```

只允许按本指令列出的路径逐个读取、比较和定向导入。每个导入文件必须解释依赖和运行入口。

### 3.3 任务登记

开始代码修改前执行接管登记：

```bash
pnpm loom register \
  --task cogniweave-memory-engine-v2:codex-cogniweave-v2 \
  --owner grok-cogniweave-cw2 \
  --via verified \
  --state active \
  --session-id <uuid> \
  --ide <实际 IDE> \
  --agent grok-cogniweave-cw2 \
  --paths 'packages/cogniweave-sdk/**,src/memory/**,src/conversations/**,src/agents/tools/memory-tool.ts,src/agents/tools/memory-tool.test.ts,src/gateway/server-methods/chat.ts,src/gateway/transcript-truncate.ts,src/sessions/transcript-events.ts,.kiro/specs/cogniweave-memory-engine-v2/**'
```

这是对现有 CogniWeave 任务的 verify-then-take，不得另建 `cogniweave-memory-engine-v2:grok-cogniweave-cw2` 并行任务。现有 Codex 审计 session 必须保留在 `sessions[]`，当前 owner 改为 `grok-cogniweave-cw2`。若上述实现路径已经被其他 active task 认领，先完成 takeover 或拆分，不得制造长期 ownership overlap。

## 4. 硬性工程原则

1. Canonical metadata 是唯一真相，graph/vector/mirror 必须可重建。
2. 所有记忆对象必须具备 data plane、scope、source provenance 和生命周期。
3. 企业 ID 只能来自可信 gateway/session context，禁止从 tool 参数或客户端 payload 信任 tenantId。
4. Source Lifecycle 正常路径必须使用稳定 `sourceIdentityId`，path locator 仅限迁移兼容。
5. 所有写操作必须有稳定 operation ID、幂等 receipt 和审计主体。
6. Archive 保留 links；Restore 不重新 ingest；Forget soft unlink；Purge 不可恢复。
7. `forgotten` / `purged` 永远不能 Restore。
8. Conversation job 成功必须表示 transcript、Catalog、CogniWeave 和派生索引已达到规范终态，不能只表示文件移动成功。
9. 任何 durable outbox 都不得进入 portable Data Space export。
10. cloud sync 默认关闭；本地记忆不能依赖云端可用性。
11. 禁止 `unknown as` 绕过 SDK 契约，禁止新增平行 lifecycle API。
12. 禁止把测试 helper 当生产 wiring 的替代品。
13. 禁止通过放宽 ACL、吞掉异常或把 fail-closed 改为 fail-open 解决测试失败。

## 5. Phase 0：基线整合与可构建性

### 5.1 定向整合范围

从 release candidate 保留 CW2 SDK 与已提交 OpenBot memory 修复。根据 `1a0707b907` 定向审查并引入：

- `src/conversations/**`
- `src/gateway/server-methods/conversations.ts`
- `src/memory/recall-deny-filter.ts`
- `src/memory/revoke-outbox-drain.ts`
- `src/memory/session-catalog-identity.ts`
- `src/memory/session-source-index.ts`
- 必要的 gateway/session 接线 hunk
- 必要的 UI Conversation 文件仅在后端闭环完成后引入

不得引入本任务无关的 Dockerfile、billing、cloud-drive、cron 或 UI 重构。

### 5.2 编译闭环

完成后必须满足：

```bash
pnpm tsgo
pnpm --dir packages/cogniweave-sdk run typecheck
pnpm --dir packages/cogniweave-sdk run build
```

验收条件：

- CogniWeave、memory、Conversation 路径零 TypeScript 错误。
- 实现文件全部被 Git 跟踪。
- 不允许通过排除目录或 `@ts-ignore` 达成绿色。

## 6. Phase 1：完成四项 Source Lifecycle 公共契约

### 6.1 类型模型

在 SDK 中建立唯一公共类型：

```ts
type SourceLifecycleMode = "active" | "archived" | "forgotten" | "purged";

type SourceLifecycleSelector =
  | { mode: "identity"; sourceIdentityId: string }
  | { mode: "legacyLocator"; sourceLocator: string }
  | { mode: "legacyBinding"; sourceBindingId: string };

type SourceLifecycleInput = {
  operationId: string;
  selector: SourceLifecycleSelector;
  subject: CogniWeaveSubjectContext;
  reasonCode: string;
  expectedStatus?: SourceLifecycleMode;
};

type SourceLifecycleReceipt = {
  operationId: string;
  sourceIdentityId: string;
  previousStatus: SourceLifecycleMode;
  currentStatus: SourceLifecycleMode;
  affectedObjectCount: number;
  completedAt: string;
};
```

选择器必须 exactly one。不得同时接受多个 selector 字段后静默择一。

### 6.2 非可选 Engine API

`CogniWeaveEngine` 必须直接声明并实现：

```ts
archiveSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt>;
restoreSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt>;
forgetSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt>;
purgeSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt>;
```

不得继续使用 optional method 或 manager 私有平行接口。

### 6.3 状态机

允许转换：

```text
active -> archived
archived -> active
active|archived -> forgotten
active|archived|forgotten -> purged
```

禁止转换：

```text
forgotten -> active|archived
purged -> active|archived|forgotten
```

### 6.4 持久化

Local SQLite 与 Postgres metadata 均需支持：

- `source_bindings`
- `source_object_links`
- `source_lifecycle_operations` 或等价 receipt 表
- operation ID 唯一约束
- status、expected status、subject、reason、timestamps
- 按 source identity 精确查询
- schema migration ladder

同一 `operationId` 重试必须返回相同 receipt。相同 operation ID 使用不同 selector/action 必须返回 idempotency conflict。

### 6.5 多来源语义

- Archive 不 unlink。
- Restore 不增加 atom/evidence/source 数量。
- Forget 只撤销该 source 的 live links，重新计算 provenance 和 confidence。
- 仍有其他 live source 的 atom 必须保留。
- Purge 只物理删除无任何 live source 的对象。

### 6.6 必测场景

1. 每条合法状态转换。
2. 每条非法状态转换。
3. exactly-one selector。
4. 同 operation ID 并发调用。
5. operation ID 意图冲突。
6. Archive 后 links 保留。
7. Restore 前后 atom/evidence 数不变。
8. 多来源 Forget 保留其他来源。
9. Purge 不误删共享 atom。
10. 进程重启后 receipt 可重放。

## 7. Phase 2：OpenBot manager、主体与 ACL 整合

### 7.1 Manager 创建上下文

扩展并统一 `getMemorySearchManager`：

```ts
{
  cfg,
  agentId,
  purpose?,
  tenantId?,
  dataPlaneId?,
  dataRoot?
}
```

要求：

- cache key 至少包含 agent、data plane、canonical store path 和 backend config fingerprint。
- 不得让不同 data plane 共享错误 manager。
- manager status 显示 data plane、canonical path、migration、outbox 和 lifecycle health，但不泄露敏感内容。

### 7.2 可信主体

合入并保留 release candidate 的 principal 解析与 ACL 修复：

- tenantId、userId、seatId、isOrgAdmin 来自可信 gateway/session。
- memory_search 与 memory_get 使用相同 principal。
- manager 调用 SDK subject binding + authorize。
- 缺失企业主体时使用明确 local sentinel，只允许本地单租户范围。
- 企业上下文解析失败时不得退化为可读取任意共享记忆。

### 7.3 readFile 修复

禁止无 ACL 扫描全局 `EMBEDDED_SCOPE_STATES`。`memory_get` 必须：

1. 根据 session/principal 解析候选 scope。
2. 对每个 scope 先 authorize。
3. 只读取该 manager 在已授权 scope 内的 document。
4. forbidden 与 missing 返回同一种外部错误，避免路径枚举。

### 7.4 ACL 负向测试

- tenant A 不能读取 tenant B private/shared memory。
- 普通员工不能读取其他 seat private memory。
- group member 只能读取所属 space 的 shared memory。
- org admin 只能执行规范允许的治理操作，不能默认读取员工私密原文。
- 猜测 relPath 不能绕过 memory_search ACL。
- 相同 agentId/groupId 在不同 tenant 下不得冲突或泄露。

## 8. Phase 3：真实 transcript 增量 seal 与撤回链

### 8.1 Ingest 接线

在 session transcript 更新运行链中接入：

1. 从 JSONL 提取稳定 message ID、role、text、turn index。
2. 无 message ID 的历史记录生成稳定 synthetic ID，不重写原文件。
3. 从 Catalog 解析 dataPlaneId、conversationId、bindingId、sessionId。
4. 加载 per-binding watermark。
5. 只 seal watermark 之后的完整范围。
6. 每个 range 使用稳定 sourceIdentityId 和 operation key 调用 writeBack。
7. operation key 排除 path、mtime、syncReason。
8. canonical writeBack 成功后才更新 watermark/index。
9. 追加消息不得重放已 seal 的整文件。

### 8.2 `chat.restore` 同步撤回

在 transcript 截断成功后、RPC 返回成功前必须：

1. 计算被撤回 message IDs 和 sealed source identities。
2. fsync/commit deny watermark。
3. durable 写入 revoke outbox。
4. 将 transcript update 标记为 `TRANSCRIPT_RANGE_REVOKED` 或 `TRANSCRIPT_TRUNCATED`。
5. 只有 deny/outbox commit 成功后才能返回 `chat.restore` 成功。

### 8.3 Deny 必须覆盖全部召回面

将 deny filter 接入：

- `memory_search`
- 模型自动知识/记忆注入
- `memory_get`
- Memory Center 用户视图
- Memory Center 管理视图
- Conversation archive search

不能只过滤 path 字符串。MemorySearchResult 应携带 canonical source identity/message metadata，过滤器按结构化字段判断。

### 8.4 Revoke outbox drain

生产调用链必须在以下时机 drain：

- gateway/manager startup
- transcript revoke 后异步触发
- 周期性 worker
- doctor/manual repair

drain 通过正式 `forgetSource` API 工作，并具备：

- stable operation ID
- retry count
- next attempt time/backoff
- last error
- dead-letter/manual repair 状态
- health/status 投影

### 8.5 必测场景

- seal 两次不重复增长。
- append 只增加新 range。
- path 移动不改变 source identity。
- `chat.restore` 成功后立即搜索，尾部独有 atom 为 0。
- forgetSource 暂时失败时 deny 仍生效。
- 重启后 outbox 自动继续 drain。
- outbox 永久失败时 doctor 明确报警。

## 9. Phase 4：Conversation 与 CogniWeave 的 durable 一致性

### 9.1 禁止当前调用顺序

不得继续使用：

```text
move transcript + commit Catalog
-> call CogniWeave
-> failure only returns partial error
```

该顺序会在重试时绕过 CogniWeave。

### 9.2 建议实现

新增 durable `conversation_memory_lifecycle_outbox` 或等价 Catalog job step：

```text
1. 创建/锁定 lifecycle job 和稳定 operationId
2. 记录目标 binding/source identities/expected CW status
3. 校验并移动 transcript
4. 更新 Catalog binding 状态
5. durable 标记 CW step=PENDING
6. 调用 SDK typed lifecycle API
7. 保存 SourceLifecycleReceipt
8. step=SUCCEEDED
9. 所有 binding/CW step 完成后 job=SUCCEEDED
```

若第 6 步失败：

- job 必须为 `FAILED_RETRYABLE`。
- 重试即使发现 binding 已 ARCHIVED/LIVE，也必须继续检查并执行未完成 CW step。
- 不得因为 transcript 已达到目标状态就直接 `continue`。

### 9.3 Archive/Restore/Purge 语义

- Archive 调用 `archiveSource`，保留 source-object links。
- Restore 调用 `restoreSource`，复用原 source identity，不 re-ingest。
- Forget 调用 `forgetSource`。
- Purge 调用 `purgeSource`，完成前保留不可恢复步骤标记。
- 多 binding Conversation 每个 binding/source range 都有独立 receipt。

### 9.4 故障注入

至少覆盖以下 crash point：

1. transcript copy 后、Catalog commit 前。
2. Catalog commit 后、outbox step 写入前。
3. outbox PENDING 后、CW 调用前。
4. CW commit 后、receipt 保存前。
5. 一个 binding 成功、另一个失败。
6. lease 过期后旧 worker 尝试写终态。
7. 重启后恢复所有未完成 step。

验收标准：任何 crash point 重启/重试后，Catalog 与 CW 最终一致；不会重复 ingest，不会返回错误 session binding。

## 10. Phase 5：SQLite 并发事务修复

当前实例级 `transactionDepth` 不能区分真正嵌套调用和不同异步请求。

修复要求：

1. 使用 AsyncLocalStorage 标记同一异步事务上下文，或使用明确串行 mutex。
2. 只有同一事务上下文允许嵌套 runner 复用事务。
3. 不同顶层 operation 必须串行进入单 SQLite connection 事务，或使用独立连接。
4. 第一个 operation rollback 不得回滚/污染第二个 operation。
5. transaction 状态必须在异常后恢复。

必测：

- 两个不同 operation key 并发成功。
- 第一个中途失败、第二个仍独立成功。
- 同 operation key 并发只产生一个 canonical write。
- process restart 后不存在半提交 source link/receipt。

## 11. Phase 6：外部 adapter 和服务表面诚实化

### 11.1 Runtime dependency injection

`createCogniWeaveRuntime` / adapter factory 必须能够接收真实：

- Postgres client/pool
- Neo4j client/driver
- pgvector client/embedding provider
- evidence store

仅选择 backend 字符串但无法提供连接对象不算支持。

### 11.2 Postgres parity

实现与 LocalMetadataStore 一致的核心能力：

- write operation claim
- schema migration
- SourceBinding/SourceObjectLink
- lifecycle receipt
- MemorySubjectBinding
- scope-aware query
- transaction isolation

### 11.3 pgvector

必须二选一：

1. 实现真实 embedding 写入、`search()`、`delete()`、scope filter；或
2. 移除 `similarity-search` capability，并明确标记为 write-only projection。

不得继续把 `embedding=null` 的 write-only adapter 声明为 similarity search。

### 11.4 Neo4j

必须二选一：

1. 实现 path query 并接入 retrieval；或
2. 移除 `path-query` capability，明确 graph boost 当前来自 metadata relations。

### 11.5 Evidence backend

定义 `EvidenceStore`，至少支持：

- put/get/delete
- locator + checksum
- scope authorization
- local file/object implementation
- canonical metadata 只保存 locator/provenance，不把外部 backend 配置当作无效装饰字段

### 11.6 REST / Python / CLI parity

对外 SDK 至少补齐：

- 四项 Source Lifecycle
- hybrid search
- trace/evidence
- promotion consent/revoke
- Memory Center 用户操作
- health/doctor/migration 状态

REST 必须引入可信认证/主体 middleware。客户端自报 scope header 不能等同授权。非 loopback 监听在没有 auth provider 时必须拒绝启动或明确标记 unsafe development mode。

Python client 与 REST 契约必须有对应测试。版本和 package description 在达到 prerelease gate 后更新，不得继续用 “scaffold” 描述完整产品。

## 12. Phase 7：Cloud Intelligence 边界

1. `cloudSync=false` 保持默认。
2. 未配置生产 endpoint/token 时不得发送网络请求。
3. outbox 不包含 raw transcript、完整 evidence、凭据或个人身份原文。
4. push/pull/delete/probe 全部验证 tenant、device、nonce、timestamp、idempotency 和 rate limit。
5. 本地召回不依赖 cloud。
6. portable export 排除 cloud outbox、writeback queue、lease 和 device cursor。

在真实 staging 完成以下验证之前，不得标记 cloud GA：

- mTLS/HMAC 握手
- KMS encrypt/decrypt
- residency pin
- cross-tenant false allow = 0
- offline queue/retry
- consent revoke/delete

## 13. CI 与验收门禁

### 13.1 SDK 门禁

```bash
pnpm --dir packages/cogniweave-sdk test
pnpm --dir packages/cogniweave-sdk run typecheck
pnpm --dir packages/cogniweave-sdk run build
pnpm --dir packages/cogniweave-sdk run smoke:install
pnpm --dir packages/cogniweave-sdk run eval:mvp:gate
pnpm --dir packages/cogniweave-sdk run benchmark:mvp:gate
pnpm --dir packages/cogniweave-sdk run benchmark:longrun:gate
```

Python（在 `packages/cogniweave-sdk/python` 目录执行）：

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
```

### 13.2 OpenBot memory/Conversation 门禁

至少运行：

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 \
pnpm exec vitest run \
  src/memory/cogniweave-manager.test.ts \
  src/memory/cogniweave-flags.test.ts \
  src/memory/session-source-wiring.test.ts \
  src/memory/session-catalog-followup.test.ts \
  src/data/cogniweave-store.test.ts \
  src/agents/tools/memory-tool.test.ts \
  src/conversations
```

### 13.3 必须新增的 E2E

不得只 mock `forgetSource` callback。新增使用真实：

- LocalMetadataStore
- CogniWeave engine
- CogniWeaveMemoryManager
- Conversation Catalog
- transcript files
- gateway `chat.restore` handler 或等价 service path

的端到端测试。

至少包含：

1. transcript append -> seal -> search。
2. archive -> CW archived -> 默认 search 不可见。
3. restore -> CW active -> source/atom 数不增长。
4. checkpoint restore -> deny immediate -> outbox forget eventual。
5. multi-binding group archive/restore。
6. tenant A/B 交换 IDs 全部拒绝。
7. Catalog commit 后 CW 故障，重启重试最终一致。

### 13.4 根级门禁

```bash
pnpm tsgo
pnpm check
git diff --check
bun scripts/agent-attribution.ts --fail-on-unattributed --fail-on-conflict
pnpm loom lint
```

若共享工作树的无关错误阻断根级命令，必须提供：

- 完整命令
- 第一条错误
- 证明与本任务无关的路径列表
- 本任务隔离 worktree 中的绿色结果

不得只写“环境问题”。

## 14. 交付物

Grok 必须提交以下交付物：

1. 可构建的 CW2 SDK 与 OpenBot integration 代码。
2. schema migrations 和 rollback/repair 路径。
3. typed Source Lifecycle 公共契约。
4. Conversation memory lifecycle durable outbox/job step。
5. transcript seal、deny、revoke drain 生产 wiring。
6. enterprise principal 与 ACL 负向测试。
7. Local/Postgres/graph/vector capability truth table。
8. REST/Python/CLI parity 或明确的未支持能力清单。
9. `docs/design/openbot-cogniweave-cw2-final-acceptance-report-<date>.md`，包含：
   - 基线与 commit SHA
   - 迁移版本
   - 测试命令与数量
   - 故障注入结果
   - 未完成项
   - cloud 是否启用
10. 更新 `.kiro/specs/cogniweave-memory-engine-v2/tasks.md`，每个完成项以 Grok agent ID 签名。

## 15. 提交治理

每个绿色 checkpoint 立即提交，不要积累成一个超大 commit。建议提交序列：

1. `CogniWeave: unify CW2 baseline and contracts`
2. `CogniWeave: complete source lifecycle persistence`
3. `Memory: enforce tenant principal and read ACL`
4. `Memory: wire transcript sealing and revoke outbox`
5. `Conversations: make memory lifecycle restart-safe`
6. `CogniWeave: harden transactions and external adapters`
7. `CogniWeave: close SDK service parity and gates`

必须使用：

```bash
scripts/committer "<message>" <owned-file...>
```

每个 commit trailer：

```text
Task: cogniweave-memory-engine-v2
Agent: grok-cogniweave-cw2
```

禁止：

- `git add .`
- 提交其他 agent WIP
- 提交 `.cursor/`
- 提交 `src/canvas-host/a2ui/.bundle.hash`
- 提交无关 Docker layer
- 用格式化批量改动掩盖功能提交

提交前执行：

```bash
node --import tsx scripts/worktree-audit.ts --group E --manifest
node --import tsx scripts/worktree-audit.ts --group F --manifest
node --import tsx scripts/worktree-audit.ts --group H4 --manifest
node --import tsx scripts/worktree-audit.ts --cached --fail-on-risky-mix
```

`E` 覆盖 SDK package，`F` 覆盖 spec/design docs，`H4` 覆盖当前 legacy 规则中的 OpenBot memory manager 文件。若 Conversation 新路径未匹配 legacy group，必须依赖 Loom registry attribution 显式认领，不得将 `UNMATCHED` 当作可忽略状态。

## 16. 完成定义

只有以下条件全部成立，才能声明本任务完成：

1. 当前目标分支包含唯一一套 CW2 代码，没有依赖未跟踪文件或 stash tree。
2. 根级 TypeScript 构建对 CogniWeave/memory/Conversation 零错误。
3. 四项 Source Lifecycle 是非可选公共 API，并在 Local + Postgres canonical store 实现。
4. Archive/Restore/Forget/Purge 均有 durable operation receipt。
5. Conversation 重试不会绕过未完成 CogniWeave step。
6. transcript seal 在真实 session ingest 上运行，append 不重放历史。
7. `chat.restore` 返回成功前 deny/outbox 已持久化。
8. deny 覆盖 search、get、模型注入和 Memory Center。
9. revoke outbox 在 startup/worker/doctor 路径可 drain。
10. tenant/user/seat/space/agent ACL 负向用例全部通过。
11. SQLite 不同 operation 并发事务隔离通过。
12. adapter capability 与真实实现一致。
13. REST/Python/CLI 不再缺失已宣布的 CW2 商业能力，或明确降级为 internal preview。
14. SDK、OpenBot integration、package smoke、Python、eval、benchmark 和故障注入全部绿色。
15. 所有相关文件已跟踪并按 agent/task 合规提交。

## 17. 停止与升级条件

出现以下情况时停止编码并报告 blocker，不得自行做高风险选择：

1. 需要覆盖或提交其他 agent 的未完成 hunk。
2. release candidate 与目标分支存在无法通过定向整合解决的语义冲突。
3. 必须改变 tenant/seat ownership 规范才能继续。
4. 需要真实生产 cloud secret、KMS 或 mTLS 证书。
5. migration 可能破坏现有 canonical store 且没有可验证 rollback。
6. 需要删除现有用户数据或重写 source identity。

Blocker 报告必须包含：

- 具体文件和代码位置
- 已执行命令
- 失败证据
- 可选方案及数据/兼容性影响
- 推荐选择

## 18. 最终执行口径

本任务的成功标准不是“新增了很多 CogniWeave 文件”，也不是“SDK 单测数量增加”。

最终必须证明：

> 同一条 OpenBot 对话从增量写入、长期召回、归档、恢复、撤回、遗忘到永久删除，都由稳定 source identity、可信主体、canonical store、durable operation 和可恢复 worker 贯穿；任何重启、重试和部分失败都不会造成重复记忆、跨租户泄露或 Catalog/CogniWeave 状态分叉。
