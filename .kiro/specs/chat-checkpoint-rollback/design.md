# Design Document: 对话检查点与回滚（Chat Checkpoint & Rollback）

## Overview

在既有 session-continuity（逐回合 `MemoryCheckpoint`）之上，新增**工作区文件快照**与**定向恢复执行**，并把前端从"顶部单动作"改为"逐回合分隔条 + 二次确认卡"。恢复 = 回滚工作区文件到检查点 + 截断对话（尾部可逆归档）+ 追加恢复标记 + 广播刷新。整个恢复受安全闸口保护（运行中禁恢复、工作区根围栏、加锁串行、外部副作用告警）。

分层：

```
UI (employee-web, lit)          ui/src/ui/views/chat.ts            逐回合「📍检查点 ⸺ 恢复」分隔条 + 确认卡
  │ chat.checkpoints.list / chat.restore({sessionKey, checkpointId})
Gateway server-methods          src/gateway/server-methods/chat.ts  list + restore(定向) 编排 + 闸口
  │
Checkpoint 服务                 src/auto-reply/reply/session-continuity.ts (+ 新 checkpoint-store.ts)
  │  createCheckpoint(turn) / listCheckpoints(session) / loadCheckpoint(id)
Snapshot 存储                   src/infra/workspace-snapshot/*      内容寻址 blob 存储 + manifest（默认）
Transcript 截断/归档            src/gateway/(session)/transcript-*  按边界重写 JSONL + tail archive
```

## Key Decisions（关键决策，含推荐默认值——待用户确认）

> 这些决策显著影响实现与安全边界。已给推荐默认（D\*-rec），确认后落地；如需调整我据此改 design + tasks。

- **D1 快照机制**：
  - (A, 推荐) **内容寻址 blob 存储**：把工作区变更文件按内容哈希（sha256）存入 `memory/snapshots/objects/<hash>`，每检查点写一份 `manifest`（相对路径→hash + 模式 + 删除标记）。恢复 = 按 manifest 还原文件树。**不依赖用户 git、与用户 git 完全隔离、易裁剪去重、跨平台**。
  - (B) **git-shadow**：为工作区建独立 `GIT_DIR`（不碰用户 `.git`），每回合 `commit`，恢复用 `checkout`。省事但依赖 git 可用、易与用户仓库/`.gitignore` 语义纠缠、清理复杂。
  - **D1-rec = A**。首期以 A 落地，接口层抽象 `SnapshotStore`，将来可插 B。

- **D2 变更集来源（要快照哪些文件）**：
  - (A, 推荐) **回合内工具写入清单**：从工具执行事件收集本回合"写/删"的文件路径（限工作区根内），只对这些做快照——**快、准、体积小**。
  - (B) **整树扫描 diff**：与上一个快照 manifest 比对整棵工作区树。全面但大工作区昂贵。
  - **D2-rec = A 为主 + B 兜底**：优先用工具写入清单；若某回合无法可靠采集清单，退化为对工作区根做一次浅层树扫描（带忽略规则 + 体积上限）。

- **D3 对话截断方式**：
  - (A, 推荐) **尾部归档 + 重写 JSONL**：把边界之后的行移动到 `<transcript>.archive/<checkpointId>.jsonl`，主 transcript 重写到边界。**可逆**（Requirement 4.2 / 原则 2）。
  - (B) 硬删除尾部行。不可逆，风险高。
  - **D3-rec = A**。

- **D4 渠道范围**：
  - **D4-rec**：引擎渠道无关；**UI 首期仅 employee-web**。检查点采集由特性开关控制，默认对 employee/workbench 会话开启，其它渠道默认关闭（不影响既有行为/性能）。

- **D5 外部副作用策略**：
  - **D5-rec**：识别到外部副作用（发邮件/发消息/外部写 API 的工具调用信号）→ 检查点 `externalEffects=true`；**允许恢复文件+对话**，但确认卡显式告警"外部动作无法撤销"。不阻断恢复。

- **D6 恢复目标语义（边界含义）**：
  - **D6-rec**：检查点建立在"回合完成"时，快照 = **该回合结束后**的文件状态；边界 = 该回合最后一条消息。"恢复到检查点 N" = 文件回到 N 结束时、对话保留到 N 结束（移除 N 之后）。与 Kiro"回到某消息之后的稳定态"一致。

## Data Model

### Checkpoint 记录（扩展既有 `MemoryCheckpoint`）

在 `MemoryCheckpoint`（`src/auto-reply/reply/session-continuity.ts`）新增可选字段（向后兼容，旧记录读时缺省）：

```ts
type CheckpointRestorable = { files: boolean; transcript: boolean };

type WorkspaceSnapshotRef = {
  store: "content-addressed" | "git-shadow" | "none";
  manifestPath?: string; // content-addressed: 相对 snapshots 根的 manifest 文件
  commit?: string; // git-shadow: 提交 sha
  fileCount?: number;
  byteCount?: number;
};

// 追加到 MemoryCheckpoint：
interface MemoryCheckpoint {
  // ...既有字段...
  session_key?: string; // 用于按会话列检查点（既有只有 session_id）
  boundary_message_id?: string; // transcript 边界（优先）
  boundary_seq?: number; // 行序兜底
  snapshot?: WorkspaceSnapshotRef; // 工作区快照引用
  external_effects?: { present: boolean; kinds: string[] };
  restorable?: CheckpointRestorable;
}
```

### Snapshot manifest（content-addressed）

```
memory/snapshots/
  objects/<sha256>            # 去重的文件内容 blob
  manifests/<checkpointId>.json
```

manifest：

```jsonc
{
  "checkpointId": "checkpoint_...",
  "createdAt": "2026-07-07T...Z",
  "baseManifest": "<prev checkpointId>", // 增量基准（可选）
  "entries": [
    { "path": "docs/a.md", "sha256": "…", "mode": 33188 },
    { "path": "tmp/x", "deleted": true },
  ],
}
```

恢复时以 manifest 全量视图（沿 baseManifest 链合并）重建工作区根内文件树。

## Snapshot Store（`src/infra/workspace-snapshot/`）

接口（渠道/agent 无关，围栏在实现内强制）：

```ts
interface SnapshotStore {
  capture(input: {
    workspaceRoot: string;
    changedPaths?: string[]; // D2-A：本回合写/删清单（相对 workspaceRoot）
    checkpointId: string;
    baseCheckpointId?: string;
  }): Promise<WorkspaceSnapshotRef>;

  restore(input: {
    workspaceRoot: string;
    ref: WorkspaceSnapshotRef;
  }): Promise<{ restoredFiles: number; removedFiles: number }>;

  prune(input: { keepCheckpointIds: string[] }): Promise<void>;
}
```

安全实现要点：

- 所有写/删经 `writeFileWithinRoot` 同款根围栏（`src/infra/fs-safe.ts`），拒绝 `..`/绝对路径/符号链接逃逸；`workspaceRoot` 用 `realpath` 归一（对齐 `agent-scope.ts` 的 `normalizePathForComparison`）。
- 忽略规则：`.git/`、`node_modules/`、快照自身目录、超大文件（> 配置阈值）跳过并在 manifest 记为 `skipped`（不纳入可恢复集）。
- 内容寻址 blob 写入用临时文件 + rename 原子落盘。

## Checkpoint 创建（回合完成钩子）

复用既有时机：`commitSessionContinuityForCurrentSession(reason:"turn_completed")`（`session-continuity.ts`）。在其写 `MemoryCheckpoint` 的同一路径内：

1. 解析 `workspaceRoot = resolveAgentWorkspaceDir(cfg, agentId)`；无则 `snapshot.store="none"`、`restorable.files=false`。
2. 收集本回合 `changedPaths`（D2-A：来自工具执行审计/事件；来源见下）。
3. `SnapshotStore.capture(...)` → `WorkspaceSnapshotRef`；失败则降级（`restorable.files=false` + 记录原因，不阻断）。
4. 记录 `boundary_message_id`（该会话 transcript 末条消息 id）、`session_key`、`external_effects`。
5. 写检查点 JSON（既有 `memory/checkpoints/` 位置）。

`changedPaths` 来源（择一，随实现细化）：本回合工具调用中"文件写/删"类工具的目标路径归集；若管线无现成事件，则回退 D2-B 浅扫描。（实现任务中细化，见 tasks P1。）

## Restore 编排（`chat.restore` 扩展）

`src/gateway/server-methods/chat.ts` 的 `chat.restore` 改造为定向恢复：

```
validate({sessionKey, checkpointId?})
 └ resolveEmployeeScopedChatSessionKey + 协作组写权限闸口（复用既有）
 └ 若无 checkpointId → 取最近检查点（向后兼容, R3.2）
guard:
 └ 若该 sessionKey 有活跃 run → 拒绝 (RUN_ACTIVE)         [R5.2]
 └ acquireSessionRestoreLock(sessionKey)（进程内互斥, R6.2）
load checkpoint by id（校验属于该 session, 否则 INVALID_REQUEST）  [R3.3]
execute（原子顺序）:
 1) 若 restorable.files → SnapshotStore.restore(workspaceRoot, ref)   [R3.1，围栏]
 2) 若 restorable.transcript → truncateTranscriptToBoundary(          [R4]
        transcriptPath, boundary, archiveTo=<transcript>.archive/<id>.jsonl)
 3) appendAssistantTranscriptMessage("已恢复到检查点…", label:"Checkpoint")
 4) context.broadcast("chat", ...) + nodeSendToSession                 [R4.3]
 └ 失败处理：步骤 1 失败→不动 transcript，报 error；步骤 2 失败→尽力回退步骤1或明确报告不一致  [R6.1]
release lock
respond({ ok, checkpointId, restoredFiles?, removedFiles?, truncatedFrom?, error? })  [R6.3]
audit(create/restore/deny/fail)                                        [R10]
```

活跃 run 判定：复用 gateway 既有运行态（与 `chat.abort` 同源；实现任务中定位具体字段）。

## Transcript 截断 + 归档（`src/gateway/.../transcript`）

新增 `truncateTranscriptToBoundary({ transcriptPath, boundaryMessageId|boundarySeq, archivePath })`：

1. 读 JSONL 全部行，定位边界（匹配 `message.id === boundaryMessageId`，或行序 `seq`）。
2. 边界之后的行写入 `archivePath`（可逆，R4.2）。
3. 主 transcript 原子重写为边界（含）之前的行（临时文件 + rename）。
4. 返回被移除条数与边界位置。

与前端一致性：前端 `buildChatItems` 读的是 `props.messages`（来自 `chat.history`），截断后 history 变短，广播触发前端刷新即可反映"消息移出会话"。

## 协议 / 方法域

- 新增 `chat.checkpoints.list`（入参 `{ sessionKey }` → `{ checkpoints: CheckpointSummary[] }`）。
- 扩展 `chat.restore` 入参 `{ sessionKey, checkpointId? }`（校验 schema：`validateChatRestoreParams` 增加可选 `checkpointId`）。
- 注册：`src/gateway/server-methods-list.ts`（加 `chat.checkpoints.list`）、`src/gateway/method-scopes.ts`（与 `chat.restore` 同域，employee 归属 + 会话域门禁）。
- 向后兼容：`chat.restore` 不带 `checkpointId` 时行为回退"最近检查点"（但语义升级为真回滚——需在决策 D 中确认是否对旧调用方也启用真回滚，或仅在带 `checkpointId` 时启用；见 tasks 决策位）。

## 前端设计（employee-web）

### 检查点分隔条（复用 divider 机制）

- `chat.ts` 的 `ChatItem` 已有 `divider`；新增一种 `checkpoint` 项（或给 divider 加 `variant:"checkpoint"` + payload）。
- 数据来源：`chat.checkpoints.list` 结果按 `boundaryMessageId` 映射到对应回合位置。`buildChatItems`（`chat.ts:1515`）在遍历 history 时，遇到某消息 id ∈ 检查点边界集，则在其后插入 `checkpoint` 分隔项（承载 `checkpointId`、`restorable`、`externalEffects`）。
- 渲染：`renderCheckpointDivider(cp)` → 「📍 检查点 ⸺⸺⸺⸺ 恢复」，右侧"恢复"按钮；`restorable` 全 false 时禁用并 title 提示原因。
- 位置：分隔条落在"已完成回合之后、下一条用户消息之前"（R7.1）；最新检查点分隔条自然靠近底部（R7.2）。
- 移除旧顶部 `.chat-restore-bar`（R7.5）；`canRestore/onRestore` 顶部单动作接线在 `app-render.ts` 移除。

### 二次确认卡（Kiro 风格）

- 点"恢复"→ 组件内 open 态记录 `pendingRestoreCheckpointId`；在该分隔条下方（或就近）渲染确认卡：
  - 标题：`恢复工作区到此检查点？`
  - 说明：`将把工作区文件回滚到此检查点，并从对话中移除此后的消息。`（+ 若 `externalEffects`：`注意：已执行的外部操作（如已发送的邮件/消息）无法撤销。`）
  - 动作：`[取消]` `[确认恢复]`（确认为危险色）。
- `确认` → `onRestoreCheckpoint(checkpointId)` → `app.ts handleRestoreChat(checkpointId)` → `chat.restore({sessionKey, checkpointId})`；进行中禁用（R7.4）。
- `取消` → 清 `pendingRestoreCheckpointId`。
- 活跃 run 时（`canAbort`）分隔条恢复入口禁用并提示先中止（R5.2）。

### 状态与 props（`ChatProps`）

- 移除/替换：`canRestore`、`onRestore`（顶部单动作）。
- 新增：`checkpoints?: CheckpointSummary[]`、`pendingRestoreCheckpointId?: string | null`、`onRequestRestoreCheckpoint?(id)`、`onConfirmRestoreCheckpoint?(id)`、`onCancelRestoreCheckpoint?()`、`restoreInFlightCheckpointId?: string | null`。
- `app-render.ts` 在 `buildChatSurfaceProps` 提供这些；`app.ts` 拉取 `chat.checkpoints.list`（会话切换/收到新 `chat` 广播后刷新）。

## 并发、失败与安全

- **锁**：进程内 `Map<sessionKey, Promise>` 串行化恢复（R6.2）；活跃 run 时直接拒绝（R5.2）。
- **围栏**：所有文件写/删限 `workspaceRoot`（realpath 归一 + `fs-safe`），单元测试覆盖 `..`/symlink/绝对路径逃逸。
- **原子**：blob 与 transcript 均用临时文件 + rename；恢复分步且失败可报告不一致（R6.1）。
- **降级**：快照采集失败不阻断回合；恢复时若 `restorable.files=false` 仅截断对话；若二者皆 false，分隔条禁用（R7.3）。

## 保留与清理（R9）

- 每会话检查点上限 `N`（配置，默认如 50）与快照总字节上限；超限按最旧优先 `prune`，保留被现存检查点 manifest 引用的 blob（引用计数/标记清扫）。
- 会话 `/new`/删除时，纳入既有会话生命周期，清理/归档其检查点、manifests、archive（R9.2）。

## 审计（R10）

- 复用既有审计通道，事件类型：`checkpoint.created` / `checkpoint.restore.requested` / `checkpoint.restore.succeeded` / `checkpoint.restore.denied` / `checkpoint.restore.failed`，字段含 `sessionKey`、`checkpointId`、owner/tenant/seat（若可解析）、结果、原因。

## 测试策略

- 单元：SnapshotStore capture/restore/prune（含围栏逃逸拒绝、去重、删除/新增/修改还原）；transcript 截断+归档（可逆）；checkpoint 创建（含降级、externalEffects 标记）。
- 集成：`chat.restore` 定向恢复端到端（文件 + 对话 + 广播）；活跃 run 拒绝；并发锁；无 checkpointId 向后兼容。
- 前端：`chat.ts` 渲染逐回合分隔条、确认卡开/关、进行态禁用、活跃 run 禁用；`app.chat-restore` 定向恢复调用参数。
- 回归：其它渠道会话未启用 UI 时行为不变；采集开关关闭时零影响。

## 实施分期（对应 tasks.md）

- **P1 基础采集（非破坏）**：SnapshotStore（content-addressed）+ 回合钩子接入 + checkpoint 元数据扩展 + `chat.checkpoints.list` + 审计 created。测试齐备。**不含任何破坏性恢复。**
- **P2 前端只读呈现**：逐回合分隔条渲染（数据来自 list）+ 确认卡 UI（先只做交互，不触发真恢复或指向兼容旧 restore）。移除旧顶部条。
- **P3 恢复引擎（破坏性，测试门槛最高）**：transcript 截断+归档 + `chat.restore({checkpointId})` 定向回滚文件 + 锁 + 活跃 run 拒绝 + 原子/失败处理 + 审计。
- **P4 保留/清理 + 多渠道开关 + 打磨**：prune、生命周期整合、特性开关、文案与可访问性、e2e。
