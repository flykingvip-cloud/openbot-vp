# Implementation Plan: 对话检查点与回滚（Chat Checkpoint & Rollback）

## Overview

落地 `requirements.md` / `design.md`：在既有 session-continuity 之上新增**工作区快照 + 定向恢复（回滚文件 + 可逆截断对话）+ 逐回合 UI + 二次确认**。分四期，**非破坏性基础先行，破坏性恢复引擎放最后并以测试与安全闸口为门槛**。

## Agents

- kiro-daibai · role: owner · scope: chat checkpoint & rollback (snapshot store, checkpoint metadata, restore engine, employee-web UI) · paths: .kiro/specs/chat-checkpoint-rollback/**, src/infra/workspace-snapshot/**, src/auto-reply/reply/session-continuity.ts, src/auto-reply/reply/session-continuity.\*.test.ts, src/gateway/checkpoint-store.ts, src/gateway/transcript-truncate.ts, src/gateway/transcript-truncate.test.ts · since: 2026-07-07

> 说明：`src/gateway/server-methods/chat.ts`、`ui/src/ui/views/chat.ts`、`ui/src/ui/app-render.ts`、`ui/src/ui/app.ts`、`src/gateway/server-methods-list.ts`、`src/gateway/method-scopes.ts`、`ui/src/i18n/locales/*.ts` 为**共享热点文件**，多 agent 可能并发编辑；本任务只改其中与检查点/恢复相关的段落，落地前经 `bun scripts/agent-attribution.ts` 核对，勿动他人 WIP。签到以 `pnpm loom register` 为准（本块为派生视图）。

### 已锁定/待确认决策（对齐 design §Key Decisions）

- **D1** 快照 = 内容寻址 blob 存储（推荐，隔离用户 git、易去重/裁剪）。
- **D2** 变更集 = 回合内工具写入清单为主 + 浅扫描兜底。
- **D3** 对话截断 = 尾部归档 + 重写 JSONL（可逆）。
- **D4** 引擎渠道无关；UI 首期仅 employee-web；采集特性开关默认仅 employee/workbench。
- **D5** 外部副作用只告警不阻断。
- **D6** 检查点 = 回合结束态；边界 = 回合末条消息。
- **待确认**：`chat.restore` 不带 `checkpointId` 的旧调用是否也切到"真回滚"，还是仅在带 `checkpointId` 时启用真回滚、旧调用维持"最近检查点 + 仅上下文重注入"直至前端全量切换。（默认建议：带 `checkpointId` 才真回滚；旧无参调用维持兼容，P3 收尾时再切换。）

## Tasks

### P1 — 快照采集与检查点元数据（非破坏性）

- [x] 1. 内容寻址快照存储 `SnapshotStore`
  - [x] 1.1 新增 `src/infra/workspace-snapshot/content-addressed-store.ts`：实现 `capture/restore/prune`，blob 存 `memory/snapshots/objects/<sha256>`、manifest 存 `memory/snapshots/manifests/<checkpointId>.json`；写入用临时文件 + rename 原子落盘。
    - _Requirements: 1.2, 3.1, 9.1_
  - [x] 1.2 工作区根围栏：所有写/删经 `fs-safe` 的 root 约束 + `realpath` 归一；忽略 `.git/`、`node_modules/`、快照目录、超大文件；逃逸路径（`..`/symlink/绝对）一律拒绝。
    - _Requirements: 3.1（围栏）, 设计原则 1_
  - [x] 1.3 单测：新增/修改/删除文件的 capture→restore 往返；去重（相同内容单 blob）；围栏逃逸拒绝；忽略规则；prune 保留被引用 blob。
    - _Requirements: 1.2, 3.1, 9.1_
  - _Done — kiro-daibai: `src/infra/workspace-snapshot/{types,content-addressed-store}.ts` + `content-addressed-store.test.ts` (6 tests)._

- [x] 2. 检查点元数据扩展 + 回合钩子接入
  - [x] 2.1 扩展 `MemoryCheckpoint`（`session-continuity.ts`）新增 `session_key`、`boundary_message_id`、`boundary_seq`、`snapshot`、`external_effects`、`restorable`（可选、向后兼容）。
    - _Requirements: 1.1, 2.1_
  - [x] 2.2 在 `commitSessionContinuityForCurrentSession(turn_completed)` 内解析 `resolveAgentWorkspaceDir`、采集本回合 `changedPaths`（工具写入清单为主，无则浅扫描兜底）、调 `SnapshotStore.capture`，写入快照引用与边界；采集失败降级为 `restorable.files=false` 且不阻断回合。
    - _Requirements: 1.1, 1.3, 1.5, 3.1_
    - _Note — kiro-daibai: P1 采用全树浅扫描（D2 兜底路径），tool-write-list 优化留待后续；并在 `chat.ts` agent-run 完成分支补挂 capture（原仅非 agent 分支有）。_
  - [x] 2.3 外部副作用识别：从回合工具调用信号标记 `external_effects`（发邮件/发消息/外部写 API）。
    - _Requirements: 1.4, 5.3_
  - [x] 2.4 采集特性开关（默认 employee/workbench 开、其它渠道关），配置读取 + 默认值。
    - _Requirements: 8.3_
    - _Note — kiro-daibai: P1 以 `enableWorkspaceSnapshot` 参数 + 仅在单 agent web 路径调用实现"其它渠道关"；配置项化留待 P4。_
  - [x] 2.5 单测：检查点含快照引用与边界；无工作区→空快照可截断；采集失败降级；externalEffects 标记；开关关闭时不采集。
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 8.3_

- [x] 3. `chat.checkpoints.list` 协议方法 + 审计(created)
  - [x] 3.1 `src/gateway/checkpoint-store.ts`：`listChatCheckpoints(sessionKey)`（按会话过滤、时间升序、附 `restorable`/`externalEffects`/`boundary`）；底层 `listSessionContinuityCheckpoints` 在 `session-continuity.ts`。
    - _Requirements: 2.1, 2.2_
  - [x] 3.2 注册 `chat.checkpoints.list` 到 `server-methods-list.ts` + `method-scopes.ts`（READ_SCOPE，与 `chat.history` 同域，只读）；handler 复用 `resolveEmployeeScopedChatSessionKey` 归属闸口 + 协议 schema `ChatCheckpointsListParams`。
    - _Requirements: 2.1, 2.3, 8.1_
  - [~] 3.3 `chat.checkpoints.list` handler 单测（空列表/越权/正常列举）已完成；审计 `checkpoint.created` **暂缓**（capture 在库层 fire-and-forget，无网关审计通道；与 P3 restore 审计一并接入）。
    - _Requirements: 2.2, 2.3, 10.1_

### P2 — 前端逐回合呈现（只读，不触发真恢复）

- [x] 4. 逐回合检查点分隔条渲染
  - [x] 4.1 `ChatProps` 增 `checkpoints?`、`pendingRestoreCheckpointId?`、`restoreInFlightCheckpointId?` 及 `onRequestRestoreCheckpoint/onConfirmRestoreCheckpoint/onCancelRestoreCheckpoint`；`ChatItem` 增 `checkpoint` 项（`ChatCheckpoint` 类型）。
    - _Requirements: 7.1_
  - [x] 4.2 `buildChatItems` 按 `boundary_message_id` 在对应回合后插入 checkpoint 项，并对「最新检查点」做 bottom 兜底（id 不匹配时也可达）；`renderCheckpointDivider`「📍检查点 ⸺ 恢复」；`restorable` 全 false 时禁用 + 原因 title。
    - _Requirements: 7.1, 7.2, 7.3_
  - [x] 4.3 `app-render.ts buildChatSurfaceProps` 提供 checkpoints；`app.ts` 经 `reloadShellChatHistory` 钩子在会话切换/回合完成/工具重载后刷新清单（`loadChatCheckpoints`）。
    - _Requirements: 2.1, 7.2_
  - [x] 4.4 移除旧顶部 `.chat-restore-bar` 及 `canRestore/onRestore` 顶部单动作接线（`chat.ts` + `app-render.ts` + CSS）。
    - _Requirements: 7.5_
  - [x] 4.5 前端渲染测试：有检查点→出现分隔条；不可恢复→禁用；确认卡展示；旧顶部条已移除（`chat.test.ts`）。
    - _Requirements: 7.1, 7.3, 7.5_

- [x] 5. 二次确认卡（交互先行）
  - [x] 5.1 点"恢复"→ 就近渲染确认卡（标题/说明/取消/确认）；`externalEffects` 时追加告警行；确认为危险色。
    - _Requirements: 5.1, 5.3, 5.4_
  - [x] 5.2 活跃 run（`canAbort`）时分隔条恢复入口禁用 + 提示先中止；取消关闭卡不改动。
    - _Requirements: 5.2, 5.5_
  - [x] 5.3 i18n（zh-CN + en）：`chat.checkpoint.*`（检查点/恢复/确认标题/说明/外部副作用告警/取消/确认恢复）。
    - _Requirements: 5.4, 7.1_
  - [x] 5.4 确认卡开/关/进行态禁用的渲染测试。
    - _Requirements: 5.1, 7.4_
  - _Note — kiro-daibai: P2 确认动作已接 `chat.restore({sessionKey, checkpointId})`，当前为**定向的非破坏性上下文重注入**（已把 P3 的 7.1 schema + 按 id 加载提前落地，仅非破坏部分）；真正的文件回滚 + 对话截断在 P3。确认卡文案已按最终语义书写。_

### P3 — 恢复引擎（破坏性，测试门槛最高）

- [x] 6. Transcript 截断 + 归档
  - [x] 6.1 `src/gateway/transcript-truncate.ts`：`truncateTranscriptToBoundary({transcriptPath, boundaryMessageId, archivePath})` 按 entry id 定位边界→尾段写 `<transcript>.archive/<checkpointId>.jsonl`→主文件原子重写到边界；边界缺失时 no-op（不丢数据）。
    - _Requirements: 4.1, 4.2_
  - [x] 6.2 单测：截断正确、尾段可从归档还原（可逆）、边界缺失/未定义 no-op、尾段为空 no-op（`transcript-truncate.test.ts`，4 项）。
    - _Requirements: 4.1, 4.2, 4.4_

- [x] 7. `chat.restore` 定向恢复编排
  - [x] 7.1 `validateChatRestoreParams` 增可选 `checkpointId`；handler 解析 + 归属闸口 + 无参回退最近检查点（兼容）。（P2 已落地 schema + 按 id 加载）
    - _Requirements: 3.2, 3.3, 8.1_
  - [x] 7.2 活跃 run 拒绝（`context.chatAbortControllers` 命中 sessionKey）+ 会话级恢复锁（进程内 `withSessionRestoreLock`，串行化）。
    - _Requirements: 5.2, 6.2_
  - [x] 7.3 执行：`snapshot.store==="content-addressed"`→`restoreWorkspaceSnapshotForCheckpoint`（围栏内回滚文件）；有 `boundary_message_id`→截断+归档；追加"已恢复到检查点"标记；`broadcast("chat")` + `nodeSendToSession`。**破坏性仅在带 `checkpointId` 时触发**；无参 legacy 保持非破坏重注入。
    - _Requirements: 3.1, 4.1, 4.3_
  - [x] 7.4 失败处理：文件/截断在锁内执行，异常→结构化错误返回且不追加标记/不广播；成功返回 `{ok, checkpointId, restoredFiles?, removedFiles?, truncatedFrom?}`。
    - _Requirements: 3.5, 4.4, 6.1, 6.3_
  - [~] 7.5 审计：requested/succeeded/denied/failed 经 `context.logGateway`（info/warn）结构化记录（含 session/checkpoint/结果）；正式 audit-event bus 待后续（仓库暂无通用审计通道）。
    - _Requirements: 10.1, 10.2_
  - [x] 7.6 集成测试（`chat.restore.test.ts`）：端到端定向恢复（文件回滚 + 对话截断归档 + 广播 + 结构化返回）；活跃 run 拒绝（不回滚/不广播）；不存在 checkpoint 拒绝；无 checkpointId legacy 兼容（既有测试）。
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 5.2, 6.1, 6.2_

- [x] 8. 前端接通真恢复
  - [x] 8.1 `app.ts confirmRestoreCheckpoint(checkpointId)` 调 `chat.restore({sessionKey, checkpointId})`；确认卡"确认恢复"接线；进行态 `restoreInFlightCheckpointId`；成功后经 `reloadShellChatHistory` 钩子刷新 history + 检查点清单。（P2 已落地）
    - _Requirements: 5.1, 6.3, 7.4_
  - [x] 8.2 前端渲染测试覆盖确认→调用、取消→不调用（`chat.test.ts`）；`app.chat-restore` 单测保持。
    - _Requirements: 5.1, 5.5_

> P3 落地说明 — kiro-daibai：确认卡文案（"回滚工作区文件 + 从对话移除此后消息"）在 P3 后**已与实际行为一致**（带 checkpointId 的恢复真回滚文件 + 截断对话）。文件回滚限工作区根内（`memory`/`.git`/`node_modules` 排除）；对话截断可逆（尾段归档）。7.5 审计以结构化日志落地，正式审计事件总线留作后续。

### P4 — 保留/清理、多渠道开关与打磨

- [x] 9. 保留策略与生命周期
  - [x] 9.1 `pruneSessionContinuityCheckpoints`：按 session 保留最新 N（默认 50），删除超额检查点 JSON，再 `SnapshotStore.prune(globalKeepIds)` 丢弃无引用 manifest/blob；接入 `commitSessionContinuityForCurrentSession`（每回合后）。配置项化留后续（当前为常量默认 + 可传 `maxPerSession`）。
    - _Requirements: 9.1, 9.3_
  - [x] 9.2 `cleanupSessionContinuityCheckpoints`：删除某会话全部检查点 + 无引用快照数据（保留同 scope 其它会话）；接入 `sessions.delete`（`if (deleted)`）。
    - _Requirements: 9.2_

- [x] 10. 收尾
  - [x] 10.1 多渠道范围：采集仅在单 agent web 路径（`commitSessionContinuityForCurrentSession`）触发，其它渠道不调用；`enableWorkspaceSnapshot` 开关 + 无检查点时前端不渲染分隔条 → 其它渠道零影响（flag-off 采集测试覆盖）。
    - _Requirements: 8.2, 8.3_
  - [x] 10.2 可访问性与文案：确认卡 `role="dialog" aria-modal aria-label`；`CHANGELOG.md` 增加用户可见条目（Changes 段尾）。
    - _Requirements: 7.1_
  - [~] 10.3 `pnpm tsgo`（本特性文件全清）+ `oxlint`/`oxfmt` 全清 + 针对性 `vitest`（snapshot/continuity/retention/transcript/chat.restore/chat 视图，共 73 项）全绿。全量 `pnpm build` 目前因**其它 agent 在改的 UI 文件**类型错误而红，与本特性无关（本特性所有文件 tsgo 干净）。
    - _Requirements: 全部_

## 交接说明 — 共享热点文件待落地接线（Handoff, 2026-07-07 — kiro-daibai）

引擎 + 快照存储 + 逐回合恢复视图已于 commit `f1f21a05fc`（21 文件，单流 CCR）落地。以下 **5 个共享热点文件**因**同一文件内夹带其它 agent 的未提交 WIP**，未随该提交落地；它们各自归属其它 landing stream（见下表）。按多 agent 治理规则（不整文件提交夹带他人 WIP 的共享文件），本任务作为 **contributor 只signal 不 land** 这 5 个文件。

**给归属流 owner 的请求**：这些文件被你所在流整文件提交时，请**保留下表列出的检查点接线 hunk（勿回退）**。这些 hunk 只引用**已入库**的符号，可正常编译：

- `ChatCheckpoint` 类型 → 已在 `ui/src/ui/types/chat-types.ts`（commit `f1f21a05fc`）
- `chat.checkpoints.list` handler → 已在 `src/gateway/server-methods/chat.ts`（同上）

落地后本特性即端到端接通，我**无需再补提交**。若接线被误删，按下表恢复即可（全部可用 `grep -n "checkpoint\|Checkpoint\|chat.checkpoints.list"` 在对应文件定位）。

| 文件                                            | 归属 landing stream | 需保留的检查点接线                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gateway/server-methods-list.ts`            | ASI                 | `BASE_METHODS` 数组内、`"chat.restore"` 之后加一行 `"chat.checkpoints.list",`                                                                                                                                                                                                                      |
| `src/gateway/method-scopes.ts`                  | ASI                 | READ 域（与 `"chat.history"` 同组）加一行 `"chat.checkpoints.list",`                                                                                                                                                                                                                               |
| `ui/src/ui/app.ts`                              | ASI                 | `import type { ChatCheckpoint } from "./types/chat-types.ts"`；三个 `@state()` 字段 `chatCheckpoints` / `pendingRestoreCheckpointId` / `restoreInFlightCheckpointId`；四个方法 `loadChatCheckpoints()` / `requestRestoreCheckpoint()` / `cancelRestoreCheckpoint()` / `confirmRestoreCheckpoint()` |
| `ui/src/ui/app-render.ts`                       | OPSD                | `buildChatSurfaceProps` 内 6 项：`checkpoints` / `pendingRestoreCheckpointId` / `restoreInFlightCheckpointId` / `onRequestRestoreCheckpoint` / `onCancelRestoreCheckpoint` / `onConfirmRestoreCheckpoint`                                                                                          |
| `ui/src/ui/capability/app-view-state-slices.ts` | A                   | `import type { ChatCheckpoint } from "../types/chat-types.ts"`；`AppViewChatCapabilityState` 增 `chatCheckpoints` / `pendingRestoreCheckpointId` / `restoreInFlightCheckpointId` 三字段                                                                                                            |

**依赖 / 运行注意**：

- `server-methods-list.ts` + `method-scopes.ts` 未落地前，`chat.checkpoints.list` RPC 未注册；前端 `loadChatCheckpoints()` 已 `try/catch` 降级为空列表（不显示分隔条），**不影响其它功能**。
- `app.ts`（`@state` 字段）与 `app-view-state-slices.ts`（状态类型）需**成对存在**；三个 UI 文件在工作树中已互相一致，分批落地时各自提交当前一致版本即可编译。
- 归属校验：`bun scripts/agent-attribution.ts`；上述接线由 `kiro-daibai` 提供。

— kiro-daibai

### 落地结果 / Resolution（2026-07-07 — kiro-daibai）

5 个共享文件已由归属流落地，接线核对结果：

- **UI 接线全部保留**：`ui/src/ui/app.ts`（state + 4 方法）、`ui/src/ui/app-render.ts`（6 props）、`ui/src/ui/capability/app-view-state-slices.ts`（3 状态字段）在 HEAD 中完整存在，无需补。`app.ts` 仍 `M` 的部分是其它 agent 的 WIP（steward/seat/cron），与本特性无关。
- **`chat.checkpoints.list` 已改为 pack 化**：gateway 拆包工作把 handler 抽到 `src/gateway/server-methods/chat-checkpoints.ts` + `chat-checkpoints.pack.ts`，并登记进 `server-methods/packs/{registry,manifest}.ts`。pack 的 `methods` + `scopes.operator.read` 经 `pack-merge` 合并进 `listGatewayMethods()` 与 `getMethodScopeGroups()`，**已是注册 + 授权的单一真源**。
- **上表「server-methods-list.ts / method-scopes.ts 需保留 chat.checkpoints.list」两行已作废**：这两个文件**不再需要**手工条目（所有 pack 方法 steward-file/daibai/fabric/support 均为 pack-only）。我一度误以为是被误删而补回（commit `9326624175`），核实 pack 归属后已回退（commit `bf264df9aa`）。**请勿再向这两个文件手工添加 `chat.checkpoints.list`**——会与 pack 重复。
- **验证**：`OPENBOT_TEST_PROFILE=low pnpm test --run`（snapshot / continuity / transcript / chat.restore / pack-merge）共 **27 项全绿**。

至此本特性后端引擎 + 协议 + pack 化 handler + 注册/授权 + 前端视图/状态/接线**已端到端接通**。

— kiro-daibai

### 恢复回执改版 / Restore feedback rework（2026-07-07 — kiro-daibai）

员工端反馈：恢复后出现堆叠的「[Checkpoint] Checkpoint restored. Summary/Latest/Artifacts」气泡（泄露内部 .md、以 assistant 身份呈现、多次恢复累加）。按"更贴合原设计 + 回执从简/可无"调整：

- **定向恢复（带 checkpointId）不再注入回执消息**：`chat.restore` 的 targeted 分支不再 `appendAssistantTranscriptMessage` / `broadcast`；回滚本身（文件回退 + 对话截断到边界）即确认。前端 `confirmRestoreCheckpoint` 改为在恢复后 `reloadShellChatHistory` 重载已截断的会话（顺带刷新分隔条），因此用户直接看到对话回退到该检查点。
- **旧无参 `chat.restore` 保持不变**（非破坏性上下文重注入，未接入分隔条 UI，向后兼容）。
- 覆盖 7.3 的"追加'已恢复到检查点'标记"决策：定向恢复**不再追加可见标记**，以截断后的对话作为反馈。
- 提交：`b1b2fd892b`（chat.ts/EDGSC 去回执）、`f19bfa848f`（app.ts/ASI 重载截断历史）、`d725209e19`（chat.restore.test.ts/CCR 断言无广播、transcript 停在边界）。焦点测试 57 项全绿。

— kiro-daibai
