# 执行链审计

审计目标：`github/main` @ `470bf68e82f3e48cbb22a621bff131a27a3d9c54`  
线上运行包：容器 `openbot-gateway-rc` 的 build commit `1617926868e64b3d65e1b2f37e488ba6e8fb08f0`（是上述 main 的祖先）。本审计的新代码没有部署到这台机器。  
会话证据：数字人 `bot--agent` 会话 `15a5540c-803a-40d5-aeea-01fc9372e5f4`。只统计工具名、技能路径和失败类别，不引用正文。  
本文件记录当时的线上路径。当前分支的门、回执和焦点码见 `EXECUTION_IMPLEMENTATION_MAP.md`。

## 结论

普通对话、技能任务和定时任务已经共用 `runEmbeddedPiAgent`。缺的不是第二套执行器，而是代理自由工具循环之前的一道确定性门。技能排序、工具允许名单和长程账本各管一件事，但技能正文里的「必须 / 禁止 / 确认门」在运行时没有强制力。线上进度账本已打开，对话长程任务的检测、资格和激活没有打开。

## 真实入口

| 阶段     | 模块                                                              | 实际决定                                                                         | 证据      |
| -------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------- |
| 入站     | `src/auto-reply/reply/dispatch-from-config.ts`                    | 先观察 shadow / activation / orchestration，三者默认直接返回，然后进入同一回复链 | confirmed |
| 回复     | `get-reply-run.ts` → `runReplyAgent` → `runAgentTurnWithFallback` | 模型 HTTP 瞬时错误最多重试一次；不按技能契约分类                                 | confirmed |
| 执行     | `src/agents/pi-embedded-runner/run.ts` `runEmbeddedPiAgent`       | 对话和 `src/cron/isolated-agent/run.ts` 都调用它                                 | confirmed |
| 工具装配 | `attempt.ts` → `createOpenClawCodingTools`                        | 策略过滤之后把整套工具交给模型                                                   | confirmed |
| 定时账本 | `createCronLedgerSession`                                         | 只在进度账本开关打开且任务同时有目标与验收条时记账，不替换执行器                 | confirmed |

## 十二条判断

| #   | 判断                                               | 结论                                                                                                                                                                                  | 等级                                                                             |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | `pptx` 只是 `cyber-ppt` 的薄入口                   | 技能正文如此写。会话里 `skills/pptx/SKILL.md` 出现 2 次，`skills/cyber-ppt/SKILL.md` 出现 8 次，同时 `make_deck.py` 17 次、`python-pptx` 21 次。入口被读到了，没有挡住另一套引擎      | 已证实                                                                           |
| 2   | 技能排序只用显式偏好、always、promptPriority、名称 | `skillPromptRank` 只加这四项。`usageCount` 不参与                                                                                                                                     | 已证实                                                                           |
| 3   | 技能条数和字符上限                                 | 代码默认 150 条、30000 字符（`workspace.ts`）。线上 `skills.limits` 为空，没有单独收紧                                                                                                | 代码支持；线上使用该默认值未对本机构建包逐字节核对，标为代码支持但线上状态未证实 |
| 4   | allow/block 不做任务级排序                         | `filterToolsByPolicy` 与 `applyToolPolicyPipeline` 只做允许/拒绝。入站天花板只在 `OPENBOT_CHAT_INBOUND_TOOL_POLICY` 打开且深度为 retrieve 时收窄工具。该环境变量线上未设置            | 已证实                                                                           |
| 5   | execution router shadow 只观察                     | `decideShadowRoute` 的生产调用在工具包的 shadow record 内，且 `SHADOW_ROUTER_RECORD` 编译期为 false。`OPENBOT_EXECUTION_ROUTER_OBSERVATION` 线上未设置。`src/` 业务路径不根据它改路由 | 已证实                                                                           |
| 6   | ConversationTask 三个开关                          | `detection` / `qualification` / `activation` 都只认环境变量，默认关。线上环境变量未设置，配置里没有 `gateway.conversationTask`                                                        | 已证实                                                                           |
| 7   | Progress Ledger 线上启用                           | 线上配置 `gateway.progressLedger.enabled === true`                                                                                                                                    | 已证实                                                                           |
| 8   | 一次性复杂任务是否建任务身份或账本                 | 账本只认「目标 + 验收条」都写全的定时任务。一次「做 PPT」不会因此建账本。激活开关关闭时，对话也不会创建 ConversationTask                                                              | 已证实                                                                           |
| 9   | focus / parked / wake                              | `chat.send` 每次调用 `applyFocusSwitchGate`，读会话文件，失败则放行，不写账本。上述会话里 `[FOCUS_PARKED]` 为 0。门在生产代码里，这次会话没有拦住                                     | 代码已证实；该会话未触发                                                         |
| 10  | 重试、fallback、权限拒绝是否同一模块               | 不是。模型 HTTP 重试在 `runAgentTurnWithFallback`；执行审批在 `requiresExecApproval`；路径越界在工作区校验；技能策略在 `skill-policy`。没有统一失败类                                 | 已证实                                                                           |
| 11  | 没有验收证据仍可宣称完成                           | 会话里 `DELIVERABLE` 26 次。交付不检查咨询式演示稿的确认门或渲染质检                                                                                                                  | 已证实                                                                           |
| 12  | 技能正文的必须/禁止/确认门有无强制力               | 没有。它们只进入提示词。模型可以读完仍改走 `python-pptx`                                                                                                                              | 已证实                                                                           |

## 六类轨迹

字段无法从日志还原时写 `unverified`，不编造。

### 1. 普通只读

代码路径：入站深度分类存在，但工具天花板默认关闭，所以「只读」不会自动变成只剩读取工具。  
本会话有 `read` 55 次、`knowledge_search` 7 次、`memory_search` 6 次，混在同一次会话的 395 次工具调用里，不能拆成单独的只读 taskId。  
`taskId` unverified，`sessionId` `15a5540c-803a-40d5-aeea-01fc9372e5f4`，`decisionStage` tool-policy，`decisionCode` allow，`retryable` false。  
证据：confirmed（调用点），inferred（哪一次用户消息是纯只读）。

### 2. 需要执行工具的普通任务

同会话 `exec` 286 次、`write` 10 次、`edit` 4 次、`process` 16 次。执行器是嵌入式代理循环，不是单独编排器。  
`toolName` exec/write，`attemptNumber` 未按次落盘（unverified），`userVisibleOutcome` 工具结果回到同一条回复。  
证据：confirmed。

### 3. 需要用户审批的高风险任务

`requiresExecApproval` 在 ask=always，或 allowlist 未命中时要求审批。会话里「Path escapes workspace」33 次。审批拒绝与路径越界不是同一个代码。审批单次的 taskId 未从日志拆出。  
证据：审批函数 confirmed；这次会话里哪一次弹出了审批 unverified。路径越界计数 confirmed。

### 4. 明确命中某个技能

`pptx` 与 `cyber-ppt` 的 SKILL.md 都被读到。排序没有把使用次数算进去，也没有把别名收成唯一主技能。  
`skillCandidate` pptx，`selectedSkill` 未被运行时钉死。  
证据：confirmed。

### 5. 复杂多阶段任务

`cyber-ppt` 正文要求分析、蓝图、制作、质检四道确认。运行时没有阶段状态。焦点切换门没有在这次会话写入 parked。进度账本不覆盖这次一次性制作。  
证据：技能正文 confirmed；运行时没有阶段状态 confirmed。

### 6. 工具失败、超时或资源不可用

`ModuleNotFoundError` 4 次，随后会话里出现自行安装 `python-pptx` 的痕迹（`python-pptx` 21 次）。路径越界 33 次。这两类都没有进入统一的「不可重试」分类；模型自己决定再试。  
`failureClass` 当时不存在。`retryOwner` 是模型，不是重试策略模块。  
证据：confirmed。

## 冲突

- 技能策略决定技能能不能出现在提示词里，但不决定本轮唯一主技能。
- 工具策略决定工具可见性。入站天花板默认不生效。两者都不是任务排序。
- 执行审批、工作区越界、模型 HTTP 重试各自停或继续，失败语义不互通。
- ConversationTask 的资格分类是纯函数，默认不参与生产。进度账本只挂在合格定时任务上。焦点门挂在 `chat.send` 上，但是失败放行。三处都叫「长程」，只有账本在线上打开，而且都不执行任务。
- 影子路由器即使被调用，也明确 `assertImplementationClosed`，不能改工具集。

## 缺失证据

- 六类轨迹没有各自独立的 runId / attemptNumber 落盘。
- 线上构建包是否逐字节包含「150 / 30000」默认值，本次没有对运行中的 dist 做常量核对。
- 新的 preflight 没有部署，因此没有它的线上 trace。
- 审批弹窗在该会话中的精确次数未拆出。

## 线上开关核对（本次读取）

| 项                                     | 结果   |
| -------------------------------------- | ------ |
| `gateway.progressLedger.enabled`       | true   |
| `gateway.conversationTask`             | 无     |
| `OPENBOT_CONVERSATION_TASK_*`          | 未设置 |
| `OPENBOT_EXECUTION_ROUTER_OBSERVATION` | 未设置 |
| `OPENBOT_CHAT_INBOUND_TOOL_POLICY`     | 未设置 |
| `skills.limits`                        | 无     |
