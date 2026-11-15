# S0 限量核准一页映射（2026-11-13）

依据：`s0-s1-next-execution-instruction-2026-11-13.md`。不重写已有六份 S0 冻结文档。开工记录时间：2026-11-13 14:22 Asia/Shanghai。

## 开工状态

| 项 | 事实 |
| --- | --- |
| 工作树 | `/workspace/openbot-vp-three-role-s0`，分支 `runtime/three-role-s1`，工作树干净（本映射写入后将出现未提交文档） |
| 开工 HEAD／当前候选 | `616697b9fb5e494f1c55694dbb7673ab48c23408` |
| 父提交 | S0 `c7892e294b123fff6889ffa13f31a7b5718e7144` → 主干 `a1433d9e533752e47a01fe8ee9790bcb6c0f0c9f` |
| origin/main | `a1433d9e533752e47a01fe8ee9790bcb6c0f0c9f`（2026-11-13 14:21 已 fetch，与 HEAD 祖先检查通过） |
| 未推送 | 是。管理方无法解析本 SHA，不视为未实施 |
| 他队工作树 | 未改动。`openbot-vp` @ `5bb2a312`（five-pack）；R5 `a0b764fc`；exec-protocol `fb7c9c68`；prod-adapt `e6593628`。用户 Codex worktree 只读 |
| 管理方最新方案 | 与 11:32 修订版仅差「规则/保真施工线复用」一节；施工顺序以本指令为准（先 A 后 B，不执行「群先行」） |
| 整合包 | `/tmp/openbot-s0-s1-integrated-2026-11-13.tar.gz` 因超出本机允许的拷贝根目录未能取回；指令已声明该包已整合，不构成额外授权，本核准不阻塞 |

## 四类事实（只限本轮相关等待点）

**已通过（保留，不重写）**

- 个体等待边界、空超时／模型失败／持久化失败可见终局、`businessExecution=none/unknown`、sidecar（`sessionKey` + 原 `runId`）查询与对账、查询不改板。
- 证据：`src/agent-runtime/model/interaction-resource-wait.ts` 及测试、`interaction-terminal.s1.test.ts`、`src/gateway/chat-interaction-failure.ts` 及测试、`authorized-interaction.ts`、`get-reply-run.ts` 接线。10 文件 / 89 PASS（2026-11-13 10:04:58 Asia/Shanghai 复跑）。这是执行方原测试集，不等同管理方另一组 8 文件 / 89 PASS。

**当前缺口（归检查点 A，除非注明 B）**

- 默认交互上限仍回落到商业排队 120 秒（`resolveCommercialRunQueueMaxWaitMs`），不是 15 秒。
- `createInteractionResourceBudget.remainingMs` 下限为 1，队列等待与推理仍可能分段叠加；接近耗尽时仍可能发下一请求。
- 无隔离 Gateway 的 `chat.send` → 交互宿主 → 终局／落盘 → `chat.history` 进程级证据。
- 未按「A 挂起 60 秒、B 确定性回执 2 秒内且先于 A」的消费者矩阵重测；原 80ms 用例不能冒充该门槛。
- 取消中准入、迟到模型结果与同 request 终局去重不足；B 超时不得取消 A，尚未按必测矩阵关闭。
- 群理解仍在 `groupDiscussionQueue` 整轮等待；群证据未开始（**检查点 B**，本步只读不写群修复）。
- 管理方原 82+7 项未在本候选按文件清单复跑（A/B 收尾）。

**相关失败／约束**

- 排队 I/O 在 fake clock 下曾死锁：不为此改写生产队列或加轮询。
- 指令所列消费者测试在本 SHA 均存在：`ui/.../app-chat.node.test.ts`、`workbench-session-background-chat.node.test.ts`、`chat-interaction-failure.test.ts`、`chat.pack1-replay.test.ts`、`get-reply-run.inbound-depth-router.test.ts`、`prepared-interaction.test.ts`，以及已有 S1 终局测试。
- 动态规则／保真分支 `6fc7b411…` 不整支合入、不启用；F1/F3 仅在当前真实链路出现回归时最小修，否则标接口依赖。F2 归检查点 B，F4 归 S5。

**他队依赖**

- 管理方尚未读取 `616697b9` 源码／补丁，独立验收未做。不重置本分支，不把包内 89 PASS 写成管理方验收通过。
- `ad0c5c71`、`e5db17974`、`565a044f` 仍不可解析，不当主干 rebase 目标。

## 两条最短生产调用链

**个体：B 如何避免等待 A 的执行结束**

`chat.send`（非群讨论队列，`chat.ts` 约 6679 行之后）→ `get-reply-run.ts`：先会话／历史等准备，再 `resolveInteractionResourceWaitMs`（现默认 120s）把上限传入 `replyTurnRuntime.interaction` → `runGovernedInteraction` / `runAuthorizedInteraction`（`session.authorize` → `authorizeCommercialRun` 的 `queueMaxWaitMs` → `acquireAgentRunSlotWithQueuePolicy`）→ `invokeInteractionCompletion` → `routeInteraction`。`respond` / `clarify` 在 `runReplyAgent` 之前返回，普通问答不进准入。实际等待点是：商业 `agent_run` 槽位（A 占槽时 B 会排）、模型推理、关键落盘；不是 A 的执行循环本身。终局经 `broadcastChatError` 补 sidecar，`chat.history` 按原 `runId` 对账。当前缺：15s 默认贯穿 deadline、进程级该链证据、A 挂起 60s / B 2s 的消费者隔离。

**群：B 如何在 A 未结束时完成理解与回应（现状，修复留检查点 B）**

`chat.send` 群分支：约 5546 行先 `void deliverChatSendMentions`（提及启动权属 S2，本步不改）→ 约 5558 行起整轮 `understandGroupInteraction`（约 5791 行）与随后成员执行都在 `groupDiscussionQueue.enqueue(rawSessionKey, …)` 内。同群前一轮 A 未结束，B 的普通理解也被同一 keyed queue 卡住。组任务写入／认领／成员执行／共享桌面的原锁应保留。本步只记录该等待点，不写群修复。

## 下一步

检查点 A 立即在本分支、`616697b9` 之上补缺，不重写 S1，不启动 B／S2。A 绿后用 `scripts/committer` 限定提交交验；不推送、不合入、不部署。
