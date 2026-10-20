# Requirements Document

> 中文名：对话检查点与回滚（Chat Checkpoint & Rollback）— **为会话补齐"逐回合检查点 + 定向恢复（回滚工作区文件 + 截断对话）+ 二次确认"的完整机制**
> 参照 Kiro 的 checkpoint/restore 交互：在每个已完成回合之后、下一轮之前展示「📍Checkpoint ⸺ 恢复」分隔条；点「恢复」弹出确认卡，确认后把工作区回滚到该检查点并从对话中移除其后的消息。

## Introduction

本规格定义 OpenBot 会话（employee 端优先）的**检查点（Checkpoint）与回滚（Restore/Rollback）**机制：为每个已完成回合建立一个可定向恢复的检查点，检查点同时捕获**工作区文件快照**与**对话边界**；用户可在任意历史检查点触发恢复，将工作区文件回滚到该时点、并把该时点之后的对话消息移出会话。

### 定位修正（Scope Framing）

本规格**不是**从零做"记忆/上下文续接"——**会话续接（session-continuity）内核已存在**：`commitSessionContinuityForCurrentSession(reason:"turn_completed")` 已经在每个回合完成后写入一个 `MemoryCheckpoint`（摘要/任务/工件/偏好/`evidence_refs`=最近消息 id），存于 `memory/checkpoints/<created_at>-<id>.json`（`src/auto-reply/reply/session-continuity.ts:441`、`commitSessionContinuityForCurrentSession` 同文件）。

本规格的准确定位是：**把"记忆检查点"升级为"可回滚检查点"，并新增真正的工作区快照与定向恢复执行 + 前端逐回合 UI**。据此区分两类工作：

- **既有事实（复用，不重做）**：逐回合 checkpoint 创建时机、`MemoryCheckpoint` 元数据、continuity prompt 注入、会话 transcript（JSONL）读写与 `resolveTranscriptPath`。
- **增量（本规格新增）**：① 每个检查点绑定**工作区文件快照**（内容寻址 / git-shadow）；② `chat.restore` 支持 `checkpointId` **定向恢复**并**真正回滚文件 + 截断对话**（当前仅追加一条消息）；③ 检查点清单可被前端拉取并**逐回合**渲染分隔条；④ Kiro 风格**二次确认卡**；⑤ 破坏性操作的**安全闸口**（运行中禁恢复、外部副作用告警、工作区根目录围栏、可逆截断）。

### 被替换 / 修复的现状（Current State，带证据）

- `chat.restore`（`src/gateway/server-methods/chat.ts:3017`）当前只做**加法式上下文重注入**：读取**最近一个** checkpoint（`loadLatestSessionContinuityCheckpoint` → `readLatestCheckpoint` 取排序后最后一个文件，`session-continuity.ts:412`），格式化成 `formatSessionContinuityCheckpointRestoreText` 文本，用 `appendAssistantTranscriptMessage` **追加**进 transcript。**不回滚任何文件，也不删除任何消息**。入参仅 `{ sessionKey }`，**无法定向到特定检查点**。
- 前端 restore 是**线程顶部的单个全局按钮**（`ui/src/ui/views/chat.ts:1097` 的 `.chat-restore-bar`，文案 `t("chat.restore")`），可用条件 `canRestore = 消息数>0`（`ui/src/ui/app-render.ts:964`）；取消按钮则贴在输入框（`.chat-compose__working`，`chat.ts:1298`）。二者位置不对称，恢复动作在长对话中会滚出视野；且**没有逐回合检查点、没有二次确认**。此单动作形态由 `7035dd7444 "UI: simplify restore to a single action"`（2026-07-04）引入。
- **无工作区快照**：`MemoryCheckpoint` 只含记忆字段，**不含任何文件内容/引用**，因此当前架构下"回滚文件"无从谈起。
- 会话 transcript 为 JSONL，逐行 `{message:{...}}` 追加（`appendRawTranscriptMessage`，`src/gateway/server-methods/chat.ts:1247` 附近）；无"截断/归档到某边界"的能力。

### 目标架构（Target Architecture）

```
回合完成 (turn_completed)
   │  ① 采集：MemoryCheckpoint（既有）+ WorkspaceSnapshot（新增，内容寻址/ git-shadow）
   ▼
Checkpoint 记录 {id, sessionKey, seq/boundaryMessageId, snapshotRef, externalEffects?, createdAt}
   │  ② chat.checkpoints.list(sessionKey) → 前端逐回合渲染「📍Checkpoint ⸺ 恢复」分隔条
   ▼
用户点「恢复」→ 二次确认卡（Kiro 风格，含"外部已执行动作无法撤销"告警）
   │  ③ chat.restore({sessionKey, checkpointId})
   ▼
恢复引擎（原子、带闸口）：
   guard(运行中禁止) → 回滚工作区文件到 snapshotRef（限工作区根内）
   → 截断 transcript 到 boundary（尾部归档，可逆）→ 追加"已恢复到检查点"标记 → 广播 chat 事件
```

### 设计原则（强约束 / 非功能性需求）

1. **围栏（Containment）**：文件回滚**只在** agent 工作区根（`resolveAgentWorkspaceDir`）内进行；**严禁**触碰工作区根以外的任何路径。
2. **可逆优先（Reversible by default）**：对话截断采用**尾部归档**（把被移除的消息尾段写入归档文件），而非硬删除；恢复本身可再被"撤销恢复"。
3. **运行中不恢复（No restore during active run）**：会话存在活跃 run（`chatRunId`）时，恢复入口禁用/拒绝；需先中止。
4. **外部副作用显式告警（External effects are surfaced, not silently implied）**：已产生外部副作用（发邮件/发消息/外部 API 写操作）的回合，检查点标记 `externalEffects`；确认卡明确提示"外部已执行的操作无法撤销"。
5. **多渠道无回归（Multi-channel non-regression）**：恢复引擎渠道无关；首期仅在 employee-web 暴露 UI；其它渠道（Telegram/WhatsApp/Discord/Slack/Signal/iMessage 等）行为不变，不因本功能报错或改变既有会话语义。
6. **原子与并发安全（Atomic & concurrency-safe）**：单次恢复对"文件 + transcript"要么全成功要么可回退；同一会话恢复串行化（加锁），失败不留半态。
7. **可追溯（Auditable）**：检查点创建、恢复请求、恢复结果（成功/拒绝/失败）均落审计，带 sessionKey / checkpointId / 操作者归属。
8. **成本可控（Bounded cost）**：快照内容寻址去重；每会话检查点数量/总体积有上限并可裁剪（prune）。

## Glossary

- **检查点（Checkpoint）**：一个回合完成后建立的可恢复时点，绑定 `MemoryCheckpoint`（记忆）+ `WorkspaceSnapshot`（文件）+ 对话边界（`boundaryMessageId`/`seq`）。
- **工作区快照（WorkspaceSnapshot）**：检查点时刻 agent 工作区文件树的可还原表示（内容寻址 blob 集 或 git-shadow 提交）。
- **恢复 / 回滚（Restore / Rollback）**：把工作区文件还原到某检查点，并把该检查点之后的对话消息移出会话。
- **对话边界（boundary）**：检查点对应 transcript 中的位置（消息 id / 行序），恢复时以此为界截断。
- **尾部归档（tail archive）**：截断时把被移除的消息尾段保存到归档文件，使截断可逆。
- **外部副作用（external effects）**：无法通过文件/对话回滚撤销的对外动作（已发送邮件、已发消息、已写第三方 API）。
- **工作区根（workspace root）**：`resolveAgentWorkspaceDir(cfg, agentId)` 解析出的目录，文件回滚的唯一允许范围。
- **活跃 run（active run）**：会话中正在执行的一次生成（前端 `chatRunId`、后端运行态）。

## Requirements

### Requirement 1: 逐回合检查点绑定工作区快照

**User Story:** 作为员工，我希望每完成一个回合系统就自动建立一个可恢复的检查点（含当时的文件状态），以便我能随时退回到任一稳定时点。

#### Acceptance Criteria

1. WHEN 一个回合完成（`turn_completed`）且该会话有解析到的工作区根 THEN 系统 SHALL 建立一个检查点，绑定该时点的 `MemoryCheckpoint`、`WorkspaceSnapshot` 与对话边界（`boundaryMessageId` 或行序 `seq`）。
2. WHEN 建立工作区快照 THEN 系统 SHALL 仅捕获工作区根内的文件，且对未变更内容进行内容寻址去重（相同内容不重复存储）。
3. IF 会话没有可解析的工作区根（例如纯外部动作会话且无 workspace） THEN 系统 SHALL 仍建立检查点但其 `WorkspaceSnapshot` 为空（文件恢复为 no-op），并保留对话边界以支持"仅截断对话"的恢复。
4. WHEN 该回合期间发生了外部副作用（发送邮件/消息、外部写 API 等可识别信号） THEN 系统 SHALL 在检查点上标记 `externalEffects=true` 并记录其类型摘要。
5. WHERE 快照采集失败（IO/权限/超限） THE 系统 SHALL 不阻断回合完成，记录降级原因，并将该检查点标记为"文件不可恢复"（`restorable.files=false`）。

### Requirement 2: 检查点清单可被前端拉取

**User Story:** 作为员工端 UI，我需要拿到某会话的检查点清单及其对话边界，以便在正确的回合位置渲染恢复分隔条。

#### Acceptance Criteria

1. WHEN 前端请求某会话的检查点清单（`chat.checkpoints.list`） THEN 系统 SHALL 返回按时间升序的检查点列表，每项含 `checkpointId`、`createdAt`、`boundaryMessageId`（或 `seq`）、`summary`、`restorable`（files/transcript 可恢复性）、`externalEffects`。
2. WHEN 会话无任何检查点 THEN 系统 SHALL 返回空列表且不报错。
3. WHERE 调用者会话域/归属无权访问该 sessionKey THE 系统 SHALL 按既有会话域/归属规则拒绝（复用 `resolveEmployeeScopedChatSessionKey` 等既有闸口），不泄露他人会话检查点。

### Requirement 3: 定向恢复——回滚工作区文件

**User Story:** 作为员工，我点某个检查点的"恢复"，希望工作区文件回到那个时点的样子。

#### Acceptance Criteria

1. WHEN 收到 `chat.restore({sessionKey, checkpointId})` 且检查点 `restorable.files=true` THEN 系统 SHALL 将工作区根内的文件树还原为该检查点快照（新增文件删除、被改文件复原、被删文件恢复），且**不触碰工作区根以外任何路径**。
2. IF `checkpointId` 缺省 THEN 系统 SHALL 回退到"最近检查点"语义（保持与既有 `chat.restore` 的向后兼容）。
3. IF `checkpointId` 不存在或不属于该会话 THEN 系统 SHALL 返回 `INVALID_REQUEST` 且不做任何改动。
4. WHILE 文件还原进行中 THE 系统 SHALL 对该会话恢复操作加锁，拒绝并发的第二次恢复。
5. IF 文件还原中途失败 THEN 系统 SHALL 尽力回退到操作前状态（或明确报告不一致范围），不得留下部分还原的半态而不告知。

### Requirement 4: 定向恢复——截断对话（可逆）

**User Story:** 作为员工，恢复后我希望对话也回到那个时点，检查点之后的往返消息不再出现在会话里，但必要时还能找回。

#### Acceptance Criteria

1. WHEN 执行恢复且检查点 `restorable.transcript=true` THEN 系统 SHALL 将 transcript 截断到该检查点边界（移除边界之后的消息），并在会话中体现为这些消息不再展示。
2. WHEN 截断 transcript THEN 系统 SHALL 先把被移除的尾段**归档**到该会话的归档存储（tail archive），使截断可逆。
3. WHEN 截断完成 THEN 系统 SHALL 追加一条"已恢复到检查点"的系统/助手标记消息，并通过既有 `chat` 广播通道通知前端刷新。
4. IF 截断/归档写入失败 THEN 系统 SHALL 不提交本次恢复的对话部分，并保证与"文件回滚"整体的一致性（见 Requirement 6 原子性）。

### Requirement 5: 二次确认与安全闸口

**User Story:** 作为员工，我希望恢复是显式、可预期、且在危险时被拦住的，而不是误点一下就不可挽回。

#### Acceptance Criteria

1. WHEN 用户点击某检查点"恢复" THEN 前端 SHALL 先展示内联二次确认卡（标题 + 说明 + 取消/确认），仅在"确认"后才发起 `chat.restore`。
2. IF 会话存在活跃 run THEN 系统 SHALL 禁用恢复入口或拒绝恢复请求，并提示需先中止当前执行。
3. WHERE 检查点 `externalEffects=true` THE 确认卡 SHALL 明确提示"外部已执行的操作（如已发送邮件/消息）无法撤销"。
4. WHEN 确认卡展示 THEN 其文案 SHALL 与系统实际行为一致：说明"将回滚工作区文件到此检查点，并从对话中移除其后的消息"，不承诺系统不具备的能力。
5. WHEN 用户点"取消" THEN 系统 SHALL 关闭确认卡且不做任何改动。

### Requirement 6: 原子性、锁与失败处理

**User Story:** 作为平台，我要求恢复这类破坏性操作要么干净完成、要么可安全回退，且并发下不产生半态。

#### Acceptance Criteria

1. WHEN 一次恢复同时涉及"文件回滚 + 对话截断" THEN 系统 SHALL 以可回退的顺序执行，任一步失败时保证不产生用户不可见的半态（文件与对话不一致必须被明确报告）。
2. WHILE 某会话正在恢复 THE 系统 SHALL 串行化该会话的后续恢复请求（加锁），并对新 run 的启动做保护。
3. WHEN 恢复成功/拒绝/失败 THEN 系统 SHALL 返回结构化结果（`ok`、`checkpointId`、`restoredFiles?`、`truncatedFrom?`、`error?`）供前端反馈。

### Requirement 7: 前端逐回合 UI（Kiro 风格）

**User Story:** 作为员工，我希望在每个已完成回合之后、下一轮之前看到检查点分隔条，一眼可发现、可恢复。

#### Acceptance Criteria

1. WHEN 渲染对话线程 THEN 前端 SHALL 在每个检查点对应的回合边界（已完成回合之后、下一条用户消息之前）渲染「📍检查点 ⸺ 恢复」分隔条。
2. WHEN 会话滚动到底部（刚完成一个任务） THEN 最新检查点的分隔条 SHALL 处于可见/可达位置（不再像旧顶部单条那样滚出视野）。
3. WHEN 某检查点不可恢复（`restorable.files=false` 且 `restorable.transcript=false`） THEN 其分隔条的"恢复"动作 SHALL 禁用并给出原因提示。
4. WHEN 恢复请求进行中 THEN 对应分隔条 SHALL 呈现进行态并禁用重复点击。
5. WHERE 旧的线程顶部全局 `.chat-restore-bar` 与逐回合分隔条并存会造成困惑 THE 前端 SHALL 移除/收敛旧顶部单动作，统一到逐回合分隔条 + 确认卡。

### Requirement 8: 协议、方法域与多渠道范围

**User Story:** 作为平台，我要求新协议方法纳入既有鉴权/方法域体系，且首期范围可控。

#### Acceptance Criteria

1. WHEN 新增 `chat.checkpoints.list` 与扩展 `chat.restore({checkpointId})` THEN 二者 SHALL 注册进 `server-methods-list` 与 `method-scopes`，并遵循既有会话域门禁与 employee 归属解析。
2. WHERE 首期范围 THE UI SHALL 仅在 employee-web（workbench 对话）暴露；恢复引擎 SHALL 渠道无关且不改变其它渠道既有会话行为。
3. WHEN 其它渠道会话未启用本 UI THEN 其检查点采集 SHALL 可开可关（配置/特性开关），默认不影响既有行为与性能。

### Requirement 9: 保留策略与成本

**User Story:** 作为平台运维，我不希望快照无限增长拖垮磁盘。

#### Acceptance Criteria

1. WHEN 某会话检查点数量或快照总体积超过配置上限 THEN 系统 SHALL 按最旧优先裁剪（prune），并保证被引用的内容寻址 blob 不被误删。
2. WHEN 会话被重置/删除（`/new`、删除会话） THEN 系统 SHALL 依既有生命周期一并处理其检查点与快照（归档或清理），不产生孤儿数据。
3. WHERE 配置提供快照保留上限 THE 系统 SHALL 读取该配置；未配置时使用安全默认值。

### Requirement 10: 可追溯与审计

**User Story:** 作为平台，我要能审计谁在何时对哪个会话恢复到了哪个检查点。

#### Acceptance Criteria

1. WHEN 检查点创建、恢复请求、恢复结果发生 THEN 系统 SHALL 写审计事件，含 `sessionKey`、`checkpointId`、操作者归属（owner/tenant/seat 若适用）、时间、结果与失败原因。
2. WHEN 恢复因闸口被拒（运行中/无权/不存在） THEN 系统 SHALL 记录标准化拒绝审计，便于售后排查。

## Non-Goals（非目标）

- 不做跨会话/跨 agent 的全局回滚；恢复范围限单会话 + 其工作区根。
- 不撤销已发生的外部副作用（发出的邮件/消息不可召回）；仅告警。
- 首期不为所有渠道提供 UI（引擎渠道无关，UI 仅 employee-web）。
- 不引入外部数据库/消息队列；沿用既有"文件/JSON + 进程内"范式。
- 不改变 `token`/`trusted-proxy` 既有访问拒绝语义。
