# S1 个体交互可用和终局保障（实现记录）

- 日期：2026-11-13（Asia/Shanghai）
- 工作树：`/workspace/openbot-vp-three-role-s0`
- 基线父提交：`a1433d9e533752e47a01fe8ee9790bcb6c0f0c9f`（#280 / 当时 origin/main）
- 范围：仅方案第 7 节 S1。未开始 S2–S5。未 push、未开 PR、未合并、未部署。
- 本笔记只记录本切片实际改动。S0 六份事实清册保持冻结原文；不以本笔记回写为「S0 已修复」。

## 实际改动

- 交互资源等待上限显式化：默认复用既有商业排队上限（120s，`OPENBOT_COMMERCIAL_RUN_QUEUE_MAX_WAIT_MS`），可用 `OPENBOT_INTERACTION_RESOURCE_WAIT_MS` 覆盖，并被宿主 agent timeout 封顶。不绕过授权，不新增并发容量。
- `get-reply-run` 把该上限作为交互 `timeoutMs` 传入；执行路径仍用原 agent timeout。`governed-interaction` 把同一上限传给 `queueMaxWaitMs`。
- 交互解释超时／空输出／一般模型失败由 `authorized-interaction` 转为可见 `respond`，并释放 lease；是否发生业务以回执字段 `businessExecution`（`none` / `unknown`）区分。
- 持久化失败可见文案为「记录暂不可用，不能视为已耐久保存；恢复后将按原请求身份对账。」Sidecar 按 `sessionKey` + `runId` 落盘，恢复后 `reconcileChatTurnTerminal` 按原 `runId` 对账。`chat.history` 会尝试对账；`broadcastChatError` 在无回执时补写 sidecar，不新造 Event Bus。
- 普通问答仍不走 admission，不改任务板。群理解仍在 `groupDiscussionQueue` 内，提及仍在准入前（留给 S2）。

## 测试证据与仍为 GAP 的项

见同次提交的 `interaction-resource-wait.test.ts`、`interaction-terminal.s1.test.ts` 及更新后的 `chat-interaction-failure.test.ts`。

- 有用例证据：S1-A、S1-B、S1-C、S1-D、S1-E、I-C1、I-T1、I-T2、I-E1（回执与对账机制）。
- 仍为 GAP（未做进程级 `chat.send` / `chat.history` 集成，也未跑全量 CI）：
  - 交互预算在 `get-reply-run` 的接线只有代码审查，无该文件专用集成测试。
  - `broadcastChatError` / `chat.history` 对账接线只有代码审查，无 gateway 进程级测试。
  - 方案所称「后端 6 文件/82 项、前端 2 文件/7 项」仍未在本切片复跑。
  - 队列等待与解释推理若顺序发生，最坏可接近 2×预算；本切片未再收成单一墙钟截止。
