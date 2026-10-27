# 批次 0：交付发布基线（openbot-vp）

| 项               | 值                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 日期             | 2026-10-21                                                                                                                                                                    |
| 仓库             | `flykingvip-cloud/openbot-vp`（含网关实现；不是仅 README 的 `flykingvip-cloud/openbot`）                                                                                      |
| 对照 commit      | `645648c49b24ee913fb2909b6ab68762fe714735`                                                                                                                                    |
| 与 `origin/main` | 2026-10-21 `git fetch origin main` 后，`origin/main` 与该 SHA **相同**。`git merge-base --is-ancestor 645648c49… origin/main` 为真。盘点基于该工作树 / 默认分支上的网关代码。 |
| 性质             | 只读盘点 + 实施合同。**无运行时行为变更、不开旗、不放宽权限。**                                                                                                               |
| 行号             | 均相对上述 SHA。                                                                                                                                                              |

`readable` 在本文只表示**服务端文件可读**（settle 在无群根时的技术结果）。预览是否打开（路由 / 权限 / 渲染）单列，不等于用户已看到。

---

## 1. 路径确认

| 合同路径                                                        | 本树 | 盘点锚点                                                                                          |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| `src/gateway/server-methods/chat.ts`                            | 存在 | `broadcastChatFinal`、`chat.send`、`chat.inject`、`chat.restore`                                  |
| `src/gateway/workspace-resolver/settle-declared-deliverable.ts` | 存在 | `settleDeclaredDeliverableText`、`settleCollaborationDeclaredDeliverable`                         |
| `src/gateway/collaboration-learning/`                           | 存在 | `claim-contract-entry.ts`（propose / confirm）、`self-advance-entry.ts`、`owner-decision-emit.ts` |
| `src/gateway/collaboration-dispatch/`                           | 存在 | `group-task-heartbeat.ts`、`self-advance.ts`、`executor-private-todolist.ts`、`claim-contract.ts` |

群心跳引导：`src/gateway/group-task-heartbeat-scheduler-boot.ts` 把 tick 接到 `runCollaborationGroupTaskHeartbeat`。调度器默认休眠：`collaboration.task.groupTaskHeartbeat.schedulerEnabled === true` 才启用（`resolveGroupTaskHeartbeatSchedulerEnabled`）。

---

## 2. `chat.ts` 内全部 final 发布入口

`state: "final"` 的聊天事件**并不都经过** `broadcastChatFinal`。下表是本文件内的全部出口，外加 1:1 代理回合的旁路（不在 `chat.ts`，但会发出同一类 `chat` final）。

### 2.1 经 `broadcastChatFinal`（`chat.ts` 约 3076）

函数做三件事，顺序固定：

1. `broadcastChat` + `nodeSendToSession`，载荷 `state: "final"`。
2. 删除 `agentRunSeq` 上的 run。
3. 若能抽出助手正文，调用 `maybeAutoCaptureAgentDeliverable`。捕获异常被吞掉，注释写明不得打断 final。

| #   | 调用点                              | 场景                                                                                                   | settle                                                           | 载荷                                                                                                          |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| G1  | `runGroupBotDiscussionTurn` 约 3744 | 群内单个机器人**可见回复**。runId = `` `${clientRunId}:${agentId}` ``，sessionKey = 群 `rawSessionKey` | **之前**调用 `settleCollaborationDeclaredDeliverable`（约 3697） | 已写入群 transcript 的助手消息；登记失败时仍是结算后的正文（见 §3）                                           |
| G2  | `chat.send` 群回合收尾 约 5197      | 回合结束再发一条 final。runId = 父级 `clientRunId`                                                     | 否                                                               | 有中止文案或点名确认文案时带上该消息；正常可见回复时 `message` 为 `undefined`（只关流，不再发第二份成果正文） |
| D1  | `chat.send` 约 5586                 | 点名路由 `skipHostAgent`，宿主代理不再跑                                                               | 否                                                               | **无 message** 的空 final，dedupe 记 `ok: true`                                                               |
| D2  | `chat.send` 约 5793                 | **1:1**，且 `onAgentRunStart` 没触发（`agentRunStarted === false`）的回退                              | **否**                                                           | 有合并正文时先 `appendAssistantTranscriptMessage`，失败则仍用内存消息广播                                     |

G1 在广播前还会把执行账记为 `status: "completed"`（约 3751），**不看** settle 的 `confirmed` / `retryable` / `unwritten` / `conflict`。

G2 在失败且没有可见回复时，**先** `broadcastChatError`（约 5180），**再** G2 的 final。错误与 final 会成对出现。

### 2.2 `chat.ts` 内旁路（自建 `state: "final"`，不进 `broadcastChatFinal`，因此也不进自动捕获）

| #   | 方法                                 | 约行      | 行为                                                                                                                             |
| --- | ------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `chat.guide.append`                  | 6026–6034 | transcript 写入成功后 `broadcastChat` + `nodeSendToSession`。runId = `` `guide-${messageId}` ``，seq 固定 0。无 settle、无捕获。 |
| B2  | `chat.inject`                        | 6211–6221 | 同上。runId = `` `inject-${messageId}` ``。同行投递 / cron / peer 收据都走这里。                                                 |
| B3  | `chat.restore` **无 `checkpointId`** | 6733–6743 | 把 `formatSessionContinuityCheckpointRestoreText` 追加进 transcript 后，按 inject 同形广播 final。                               |

`chat.restore` **带 `checkpointId`**（约 6687–6699）成功时只 `respond`，**不**追加恢复文本，**不**广播 final。见 §6。

### 2.3 1:1 代理回合旁路（不在 `chat.ts`）

`chat.send` 在 `agentRunStarted === true` 时（约 5799–5802）**不再**调用 `broadcastChatFinal`。注释写明回复管线已经持久化并广播。实际出口是 `src/gateway/server-chat.ts` 的 `emitChatFinal`：

| #   | 条件                                        | 约行    | 行为                                                                                                            |
| --- | ------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| A1  | `jobState === "done"`                       | 715–748 | 普通 1:1 助手 final。协作 space 子会话键直接 return（`space_child_parent_canonical`），避免和 G1 再画一个气泡。 |
| A2  | `jobState === "error"` 且不支持的图片被软化 | 697–712 | 仍发 `state: "final"`，正文是固定对话句，不是错误态。                                                           |

这两条都是直接 `broadcastChat` + `nodeSendToSession`。**不**调用 `settleCollaborationDeclaredDeliverable`，**不**调用 `maybeAutoCaptureAgentDeliverable`。

因此：**1:1 主路径（代理已启动）没有接入 settle，也没有接入自动捕获。** 1:1 只有 D2 那条「代理没启动」的回退会进 `broadcastChatFinal` → 捕获，仍然不 settle。

### 2.4 不是 chat final、但会离开本回合的相邻广播

- `broadcastChatError`：错误态，不是 final。
- `broadcastChatUserEcho`：`state: "user_echo"`。
- `broadcastCollaborationOptionalSuggestion`：可选补充被跳过时发 `collaboration.optional_suggestion`，然后 `return null`，**不**走 G1。
- `broadcastCollaborationRoundPlan`：回合计划，不是聊天 final。

---

## 3. settle 与 `maybeAutoCaptureAgentDeliverable`

### 3.1 唯一 settle 调用点

全仓库生产调用只有 `chat.ts` 的 G1（`settleCollaborationDeclaredDeliverable`）。测试在 `src/gateway/workspace-resolver/settle-declared-deliverable.test.ts`。

G1 顺序：

1. `replyText = combinedReply`。
2. `try` settle，成功则 `replyText = result.text`。
3. `catch`：打日志 `collaboration deliverable settle failed`，**保留原来的 `combinedReply`**。
4. 无论状态如何，写入群 transcript（路径解析失败则用内存消息）。
5. `broadcastChatFinal`（其内再尝试捕获）。
6. 执行账 `completed`。

异常时仍发原回复：是。settle 抛错不会改口、不会停播。

非异常的失败（`retryable` / `unwritten` / `conflict`）会改信封属性（`settle=` / `unwritten="1"`），**不改**信封外的散文。`declare()` 夹具的首句是「三张表的字段与口径草案已写入工作区。」失败结果仍带着这句。聊天层不按 `status` 分支。

### 3.2 settle 写入 / 镜像（不是纯检查）

`settleDeclaredDeliverableText`（约 286）：

| 状态        | 写入                                                                                                                                                    | 展示用正文                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `none`      | 无 `file=` 则原样返回                                                                                                                                   | 原文                                                                  |
| `unwritten` | 不确认。可能已尝试写字节但失败则标 `write_failed`                                                                                                       | 信封 `unwritten="1"` `settle="declared"`                              |
| `conflict`  | **不覆盖**群正式根上已有的不同字节                                                                                                                      | `settle="conflict"`，群文件保持旧字节                                 |
| `retryable` | 群磁盘字节已对齐，**清单写入失败**（`manifest_write_failed`）；或群作用域但群根不可用（`missing_tenant` / `locator_failed` / `group_root_unavailable`） | `settle="retryable"`。群根缺失时**禁止**降级成只写个人区的 `readable` |
| `confirmed` | 代理工作区与群正式根字节一致，并 `upsertGroupSettleManifestDraft`                                                                                       | `settle="confirmed"`，`file=` 改成最终相对路径                        |
| `readable`  | **仅无群根**的代理工作区。可把信封正文或已有字节镜像进代理路径                                                                                          | 正文不打 `settle`                                                     |

群保留前缀 `runtime/`、`governance/`、`profile/`、`sessions/`、`.git/` 不能当成果目标。文本类扩展名可在工具没写文件时用信封正文落盘；二进制缺字节则 `binary_requires_tool_write`，不发明字节。

同相对路径且清单已指向它时，清单 upsert 幂等（约 250）。**没有**跨「检查 → 清单 → 广播」的幂等键。重复 G1 仍会再广播一条聊天 final。

### 3.3 自动捕获

只从 `broadcastChatFinal` 进入。因此 A1/A2/B1/B2/B3 **不捕获**。

`maybe-auto-capture-agent-deliverable.ts`：

- 开关默认开。`OPENBOT_DELIVERABLE_AUTO_CAPTURE=0` 或配置 `knowledge.deliverables.autoCapture === false` 则跳过。
- 有 `<<DELIVERABLE>>` 时：可 `materializeDeclaredDeliverableAtPlacedRoot`（文本正文落盘；办公格式不发明字节），再 `captureAgentOutputDeliverable`。
- `upsertGroupDeliverableDraftBestEffort` 在定位器失败时直接 return；定位器成功时也**不写**群清单（参数被 void）。群清单的写入在 settle，不在这条捕获里。
- 无信封且是群会话：直接 return。
- 无信封的员工管家会话：散文里同时有「已生成/已保存」类提示和文件名时才捕获。
- 长度启发式默认关（`autoCaptureHeuristic === true` 或 `OPENBOT_DELIVERABLE_AUTO_CAPTURE_HEURISTIC=1`）。
- 返回值被 `broadcastChatFinal` 丢弃。捕获失败只影响登记，不影响已经发出的 final。

### 3.4 1:1 是否接入 settle

**没有。** 见 §2.3。批次 1 若把 settle 接到 1:1，必须单独写明允许的写入、覆盖和失败是否回滚展示；不能把现在的群 settle 当成纯检查函数复用。

---

## 4. 最小状态字段（设计合同，本批不落代码）

一条发布记录建议至少这些字段。技术交付态与业务验收态分开：`confirmed` / `readable` 不是任务 `accepted`。

| 字段组         | 建议                                                                             | 现状缺口                                                              |
| -------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 作用域         | `tenantId`、`sessionKey`、可选 `groupId`、可选 `taskId`                          | 1:1 **允许 `taskId` 为空**。G1 有 groupId；A1 只有 sessionKey + runId |
| 交付身份与版本 | `logicalId`、`relativePath`、`versionChecksum`（sha256）                         | settle 返回值有 checksum，**没有**写进聊天事件或幂等存储              |
| 来源回合       | `clientRunId`、机器人 final 的 `` `${clientRunId}:${agentId}` ``、`messageId`    | 各入口 runId 规则不同（guide-/inject-/父 run/子 run）                 |
| 技术检查       | `none \| readable \| confirmed \| unwritten \| retryable \| conflict` + `reason` | 只活在 settle 返回值；G1 广播前丢掉 status                            |
| 登记           | `manifestOk`、捕获 `deliverableId`                                               | 清单失败仍广播；捕获结果不回写事件                                    |
| 发布           | `broadcastChat` 与 `nodeSendToSession` 是否已尝试                                | 没有投递回执。失败与成功都可能已写出 transcript                       |
| 失败原因       | settle `reason`、捕获异常、transcript `error`                                    | settle 抛错只进网关 warn，正文仍是原回复                              |

幂等键（合同，尚未实现）：

`租户或会话作用域 + 发布意图 + 交付版本绑定`

- 发布意图区分：`group-bot-final`、`group-round-close`、`direct-fallback-final`、`agent-run-final`、`guide-append`、`inject`、`restore-legacy`。
- 1:1 无 `taskId` 时，键仍须含会话作用域和这次发布意图，不能退化成全局正文哈希。
- 同键重放不得再写第二份权威版本，也不得再增加外部副作用。聊天 final 今天做不到这一点。
- `readable` 不得单独当成「已交付」展示。

持久化顺序合同（批次 1 才改代码）：分析正文可以发；交付展示只能绑定**已持久化**的版本和检查结果。检查过但登记失败、登记过但广播失败、重复发布，是三条必覆盖场景。今天 G1 是「先改正文 → 写 transcript → 广播 → 捕获」，登记失败仍带着成功散文。

---

## 5. 权限矩阵现状（只记录，不改）

网关方法在 `operator.write`（`src/gateway/method-scopes.ts`）。下表是**业务角色**现状，不是 scope 名。

演员来源：协作 RPC 用 `resolveDeliveryAclActor`（会话主体）。self_advance **不**调用 submit / accept。

| 动作                           | 执行者（认领人 / 计划所有者）                                                                            | 协调者                                              | 授权人（看板 `publishedBy`，且成员表为 active）         | self_advance                                                                                                                                                                                           | 代码现状                                                                                                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 生成计划候选 `proposeTodolist` | **仅所有者**。`proposedBy !== ownerMemberId` → `actor_not_owner`                                         | 不能代提                                            | 不能代提                                                | 不调用                                                                                                                                                                                                 | `executor-private-todolist.ts` `proposeTodolist`。默认新 `todolistId`（UUID）                                                                                                                                                                                        |
| 技术 settle / 登记             | 群回合里当前机器人，无第二道角色校验                                                                     | 不单独调用                                          | 不单独调用                                              | 不调用                                                                                                                                                                                                 | 仅 G1。写盘 + 群清单。失败仍广播                                                                                                                                                                                                                                     |
| `submitForReview`              | **仅认领人** `requireClaimantActor` → 否则 `actor_not_claimant`                                          | 除非自己就是认领人，否则不能交卷                    | 同左                                                    | **不** submit / accept / finalize（文件头写明）                                                                                                                                                        | 须 UUID `submissionId` + 非空 `artifactVersion` + 非空正文。同 id 同版本幂等；不同版本 `submission_version_clash`。旗标 `claimContract` 关则 `flag_off`                                                                                                              |
| accept / finalize              | 函数体**没有**「必须是协调者/授权人」检查。任何能解析出的 `actorId` 都会进入 `acceptBoardItemSubmission` | 注释写协调者/所有者；**实现未再校验该角色**         | 同左                                                    | **不得**（代码路径不调用）                                                                                                                                                                             | 必须 `expectedSubmissionId` 等于当前 pending，否则 `expected_submission_id_required` 或拒绝陈旧/错误 id。须写 reason，并勾齐看板验收标准。`requirePeerReview` 开时还要 ≥1 条非作者评审；旗标关则这道闸不生效。晚到的 accept（状态已不是 `submitted_for_review`）拒绝 |
| return / 驳回                  | 同样**没有**协调者角色校验，只要有 `actorId`                                                             | 同 accept                                           | 同 accept                                               | 不调用                                                                                                                                                                                                 | 绑 `expectedSubmissionId`。成功后清掉 pending `submissionId` / `artifactVersion`，避免旧 id 再被 accept。并 best-effort 唤醒认领人                                                                                                                                   |
| 确认 Todolist                  | 所有者默认**不能**自确认，除非该 id 同时在授权确认人或协调者名单里                                       | 可以，且必须在 operating state 里是 **active** 成员 | `publishedBy` 且 active 才进入 `authorizedConfirmerIds` | 不调用                                                                                                                                                                                                 | 见下方「待复现」                                                                                                                                                                                                                                                     |
| wake / heartbeat 推进          | —                                                                                                        | 心跳 escalate 目标含协调者 / 群主配置               | —                                                       | 默认 **dry_run**。`execute` 还要 `mode=execute` 且群在 `executeGroupAllowlist`。L2 `botMaySelfAdvanceWithoutHuman` 平台默认 false。五条资格全过才允许推进，且 `decisionMode` 必须仍是 `human_required` | 心跳调度默认关。写模式默认 `observe`；`emit` 还要 Wake Contract 开，并且配置为 emit 或群在 `emitGroupAllowlist`。未认领桥接只在非 dry-run 且 self_advance 写模式为 execute 时尝试                                                                                    |

确认 Todolist 的加载：`confirmTodolist` 用 `taskId + todolistId` 调 `loadExecutorTodolist` → `latestById`（同一 id 的日志最后一行）。RPC schema `CollaborationTaskConfirmTodolistParamsSchema` 只有 `groupId`、`taskId`、`todolistId`，**没有预期计划版本**。卡片上的 `version` 不回传。

这是待复现边界，**不宣布陈旧确认漏洞**。已知机制、尚未用失败测试钉死的点：

- 新的 `proposeTodolist` 默认换新 UUID，并把旧列表标 `superseded`。用**旧 id** 确认会读到 `superseded`，状态不是 `proposed|revise_requested`，返回 `invalid_status`。
- `reviseTodolist` **沿用同一 id** 并改 steps。确认请求不带版本，`latestById` 会确认**该 id 的最新一行**（含修订后的步骤）。旧卡是否因此确认了修订后的计划，需要失败复现后再下结论。
- 调用方若显式传入同一个 `todolistId` 再 propose，版本号会加一但仍可能是同一 id。同样待复现，不在本笔记定性。

---

## 6. 恢复调用栈

入口都是 `chatHandlers["chat.restore"]`（`chat.ts` 约 6231）。

共同前置：校验参数 → 员工会话键 → **拒绝协作群** → 外籍管家拒绝 → 群写拒绝 → 会话与 workspace → 有活跃 run 时拒绝或 `queueWhenActive` 排队。

然后分叉（约 6384–6700）：

### 6.1 指定 `checkpointId`（破坏性回滚）

1. `chatCheckpointStore.loadChatCheckpointForRestore`。找不到则 `checkpoint not found`。
2. 会话锁 `withSessionRestoreLock`。
3. `restoreWorkspaceSnapshotForCheckpoint`。
4. `truncateTranscriptToBoundary` + `materializeRewoundTranscript`。边界找不到则失败，不返回成功。
5. 截断成功后 `commitTranscriptRangeRevoked`，再异步 `drainRevokeOutbox`。
6. `respond(true, { ok, checkpointId, restoredFiles, removedFiles, unchangedFiles, truncatedFrom })` 后 **return**。

不调用 `formatSessionContinuityCheckpointRestoreText`，不 `appendAssistantTranscriptMessage`，不广播。

回归：`src/gateway/server-methods/chat.restore.test.ts`，`describe("chat.restore targeted rollback (P3)")`，用例「rolls back workspace files and truncates the transcript for a targeted checkpoint」。断言 transcript 停在边界消息，且 `broadcast` / `nodeSendToSession` 未被调用。

### 6.2 无 `checkpointId`（旧版兼容，非破坏性）

1. `loadLatestSessionContinuityCheckpoint`。没有则 `no checkpoint available`。
2. **不**回滚文件，**不**截断 transcript。
3. `formatSessionContinuityCheckpointRestoreText`（`src/auto-reply/reply/session-continuity.ts` 约 1105）。`open_tasks` 非空时拼进 `Open tasks: ...`（最多 5 条），还有 summary / completed / artifacts。
4. `appendAssistantTranscriptMessage`（label `Checkpoint`）。
5. B3：广播 `state: "final"`。

夹具：同文件 `createFixture()` 把 `open_tasks: ["task_a"]` 写进 `latest.json`。用例「restores the latest continuity checkpoint into chat」用 `params: { sessionKey: "main" }`（无 checkpointId），期望 `broadcastChat` 收到 `state: "final"`。格式化函数会把 `task_a` 写进追加文本；该用例没有再断言正文含 `Open tasks`。

### 6.3 `buildSessionContinuityPrompt`（另一条，不是 `chat.restore`）

`session-continuity.ts` 约 1122。非新会话且非群作用域则返回空。任务只注入 `sessionEntry.taskContextId` 绑到的账本行；没有绑定任务且没有 checkpoint 则返回空。checkpoint 只注入 `Latest checkpoint summary`，**不**注入 `open_tasks` 列表。与 §6.2 分开回归。

---

## 7. 两例追踪（交付失败仍成功文案 / 提案成功但卡片失败）

### 7.1 交付失败仍带着成功文案

**已有夹具（settle 单元，失败状态 + 成功散文仍在）：**

- 文件：`src/gateway/workspace-resolver/settle-declared-deliverable.test.ts`
- 助手 `declare()`（约 43）：首句固定为「三张表的字段与口径草案已写入工作区。」
- 用例：`returns retryable when group disk is OK but manifest cannot be written`
  - 把群目录下 `.manifest.json` 做成目录，清单写不进去。
  - 期望 `status === "retryable"`、`reason === "manifest_write_failed"`、信封 `settle === "retryable"`。
  - 群相对路径上的字节**已经写上**。`patchDeliverableDeclarationAttrs` 只改信封属性，首句成功文案还在 `result.text` 里。
- 对照用例：`does not treat model file= alone as confirmed when bytes are missing` → `unwritten` / `binary_requires_tool_write`，同样保留 `declare()` 首句，并加上 `unwritten="1"`。

**接到聊天广播的路径（无专门集成测试，按调用栈追踪）：**

1. 群 `chat.send` → `runGroupBotDiscussionTurn`。
2. 模型正文含 `<<DELIVERABLE ...>>` 和上面那种「已写入」散文。
3. settle 返回 `retryable` 或 `unwritten` 时，`replyText` 仍含该散文（约 3692–3704）。
4. 约 3720 写入 transcript，约 3744 `broadcastChatFinal`，约 3751 账本 `completed`。
5. 若 settle **抛错**（约 3705–3708）：`replyText` 保持模型原文，原样广播。这条没有对应用例。

实施者复现「登记失败仍成功文案」：跑上述 retryable 用例看 `result.text` 仍以「已写入工作区」开头；再沿 G1 确认该 `text` 被广播且账本为 `completed`。

### 7.2 提案成功但卡片 emit 失败

**提案成功且吞掉卡片失败的代码：**

`src/gateway/collaboration-learning/claim-contract-entry.ts` `proposeCollaborationTodolist`（约 971–998）：

1. `proposeTodolist` 成功才继续。失败会 `unwrapTodolist` 抛错，RPC 不会报成功。
2. 然后 `emitOwnerDecisionCardForProposedTodolist`。
3. 返回值不检查。`try/catch` 吃掉抛错（注释 ignore emit failures）。
4. 函数返回 todolist。RPC `collaboration.task.proposeTodolist`（`server-methods/collaboration-learning.ts` 约 616–621）`respond(true, { todolist })`。

**emit 本身失败且不抛错的返回（提案侧因此仍成功）：**

`src/gateway/collaboration-learning/owner-decision-emit.ts`

| `reason`            | 约行    | 含义                                                       |
| ------------------- | ------- | ---------------------------------------------------------- |
| `build_failed`      | 351–352 | 卡片建不出来，`ok: false`                                  |
| `transcript_header` | 371–376 | 群公共 transcript 头写失败                                 |
| `transcript_append` | 394–399 | `appendPersistedAgentMessageToTranscript` 返回 `ok: false` |

`no_active_confirmer` / `idempotent_exists` 是 `ok: true, skipped: true`，不算 emit 失败。跳过时提案同样返回成功，聊天里没有新卡片。

**已有测试（只覆盖成功和跳过，没有「提案成功 + emit 失败」合例）：**

`src/gateway/collaboration-learning/owner-decision-emit.test.ts`

- 「writes ownerDecision + @mention into group public transcript」：emit `ok`，transcript 含 `ownerDecision` 与 `td-emit-1`。再调用一次为 `skipped` / `idempotent_exists` 路径（断言 `skipped === true`）。
- 「skips when no active confirmer is available」：`{ ok: true, skipped: true, reason: "no_active_confirmer" }`。

实施者复现「提案成功但卡片失败」：让 `appendPersistedAgentMessageToTranscript` 返回 `{ ok: false }`（或让 transcript 头写入抛错，得到 `transcript_header`），调用 `proposeCollaborationTodolist`。期望 todolist 对象仍返回、RPC `ok: true`，且 `emit` 结果为 `ok: false` 且 reason 为 `transcript_append` 或 `transcript_header`。仓库里还没有这条合例，上面两段就是调用栈。

---

## 8. 阻塞与非目标

- 本批不改 `chat.ts`、settle、捕获、确认、心跳、权限和旗标。
- 1:1 主路径（A1）未接入 settle，也未接入自动捕获。批次 1 要先写清 1:1 允许的写副作用。
- 聊天 final 没有「作用域 + 发布意图 + 版本」幂等键。G1 失败散文与 `completed` 账本是批次 1 的直接对账点。
- accept / return 的函数体没有协调者角色闸。这是现状记录，**不是**放宽或收紧的授权。
- Todolist 确认不传预期版本：待复现，不记成已证实的陈旧确认缺陷。
- 指定 checkpoint 与无参恢复行为不同，回归必须分开，不能改一条就当两条都覆盖了。
- 网络或审批问题只影响合入，不改变本页合同。
