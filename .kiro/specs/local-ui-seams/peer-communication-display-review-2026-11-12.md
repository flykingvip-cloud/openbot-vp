# 个体机器人通讯与用户回复展示复核

日期：2026-11-12（Asia/Shanghai）。Task: local-ui-seams-peer-display-20261112；Agent: codex-runtime-manager。

基线 HEAD：`bad73c986cc31831e805442613fd4b1e970d6a5e`。刷新后 `origin/main=7964f7c0f274695f1de6e9120e115608f37dfcda` 为祖先。本报告对应上述基线上的本轮修复；本报告随限定补丁提交，最终提交身份以 Git 记录为准，不把基线本身当作包含修复的提交。源码快照清单摘要：`56118c7f9e5600e506aba739775babe07f504a8358502fb19b1d6d01c872fe4c`。本轮已获用户限定提交授权；未推送、未云部署、未发送真实私信或外部渠道消息。

## 1. 图一事实与根因

本地主人作用域的市场助手 transcript：07:46:05 用户要求给客户经理发会议消息；07:46:08 助手要求邮箱、微信或企业微信地址，以及会议地点；07:46:21 用户补充“发私信”。第一条答复前后没有工具调用；第二条在 Gateway 日志对应 `interaction protocol downgrade=prose_downgrade admitted=false`，没有进入内部发送链。

因此不能称“已发送但丢消息”。首要断点是交互解释缺少内部收件人目录，且当时模型输出未形成执行准入。上一候选已有 JSON 传输约束；本轮不通过关键词直接触发发送。

另有独立权限事实：只读调用现有 `listConversationPeers` 与归属记录后，当前主人可见的同主人通讯目录仅含高密度分析、市场助手、Skill孵化；客户经理已注册，但不是同一主人；熊猫学习缺有效归属记录。侧栏出现并不等于获得私信权限。本轮没有改归属、迁移用户数据或放宽跨主人通讯。

本轮处理：

- `src/auto-reply/reply/conversation-peer-context.ts` 复用现有同主人目录与会话解析器；无可信租户或主人时不读全局目录。
- `src/agent-runtime/context/sources/conversation-peers.ts` 只投影最多40个名称、身份与会话存在状态，目录是数据，不作为授权。
- `src/auto-reply/reply/get-reply-run.ts` 仅在个体交互装配目录，不向协作群分支塞入个体目录；工具仍为空，仍先语义解释、后执行准入。
- `src/agent-runtime/model/interaction-completion.ts` 与执行上下文区分内部机器人私信和外部渠道发送；“发私信”需结合历史理解，不再次索要不相关外部地址，也不虚构已发送。

## 2. 图二通路现状与边界

现役个体通路：

```text
用户表达内部通讯意图
  → 个体交互理解（共享身份、历史、目录；不运行工具）
  → 已接纳的执行请求
  → conversation_send
  → 同租户、同主人注册表与真实会话检查
  → dispatchConversationHandoff
  → 既有 agent 调用（inter_session 来源、nested lane、deliver=false）
  → 对方主会话执行
  → chat.inject / peer provenance 回件
  → 当前会话显示“消息来自某机器人”
```

代码锚点：`src/agents/tools/conversation-send-tool.ts`、`src/conversation-task/conversation-handoff.ts`、`src/diagnosis/diagnose-action-dispatch.ts`、`ui/src/ui/chat/peer-exchange.ts`。

图二的“消息来自市场助手／Skill孵化”来自消息来源标记，不是协作群任务认领。个体通讯不建立群工作项、私有计划或群验收。收到消息、对方回信、接受工作责任、成果验收是不同事实。跨用户通讯不因管理员身份或同群身份自动放开。

现有回信设计用最新 inbound 来源识别直接回信，直接回贴不再次唤醒发件者，避免回复触发循环。`answerInChat` 防止工具拿到正文后又重复复述；发送成功但等待超时也不得说“未送到”。

本轮发现并修复：等待结束后读取最近助手正文，新回合没有正文时会落到旧回复。`readLatestAssistantReply` 新增可选发送时间下界；本次个体发送和大白提及分支都传入发送时间。已证红例：空的新回复返回“上周已完成”；修复后返回无本次正文，未知时间也不拿来当回信。其他没有指定边界的旧调用保持原语义。

仍开放：时间下界只避免拿发送前旧内容，不等于严格 run 关联；同一收件主会话的并发发送、多个来信的来源覆盖、重试幂等仍需单独实测。当前不能称“所有个体通讯全程已实测通过”。

## 3. 图三与整个展示链的遗漏

已核实来源与处理：

| 入口           | 原问题                                                  | 本轮处理                                                               |
| -------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| 正式任务回执   | 拼接内部 taskId 与五个布尔状态位                        | 用户只见真实业务状态；全部绑定与原始原因保留在结构化回执和协调者上下文 |
| 团队成果结算   | 把 reason、locator、存储身份直接拼入正文                | 明确区分提交／审核，失败用中文事实；不将提交说成已验收／已送达         |
| 模型转述       | 把 source_message_not_bound 等码转述到助手正文          | 共享展示投影翻译已知运行码；不改变执行判断、授权、重试或结算           |
| 流式／最终回复 | 仅最终文本清理会先闪现内部码                            | server-chat 的 delta、节流 flush 与 final 共用投影；原模型缓冲保持原样 |
| 历史回放       | 只管 assistant 漏掉机器人 user+inter_session 回件       | Gateway 历史、UI extract/normalizer 一并处理机器人来信，保留来源标签   |
| 错误事件       | TypeError / Cannot read properties 无路径时漏过 UI 过滤 | 既有错误净化器补此类异常，不在用户气泡念堆栈内容                       |

共享实现：`src/shared/text/assistant-runtime-display.ts`。它仅属于展示投影；不是新的规则执行器，不写任务、不授予权限，不从文案决定状态。

用户应看到的示例：

- “已整理任务草案，尚未开始执行。”
- “这条消息尚未正确关联到任务，暂未开始分工。”
- “团队成果尚未与本次有效任务关联，暂不能提交审核。”

不应看到内部状态矩阵、运行错误码、租户存储 locator、执行入口名。也不能把错误完全隐藏后宣称成功。

保护范围：保留人类消息原文、已发送原文、合法成果链接及围栏代码示例；原诊断、结构化状态仍供审计和恢复。机器人 peer 来信按其可信 provenance 进入展示投影，而不是把人类输入全量改写。

仍需后续处理：未知错误码、模型把内部实现换一种自然语言转述、用户要求调试时的显式诊断视图、其他非聊天渠道的展示出口。本轮不宣称任意日志／任意工具输出已经全面脱敏，不靠列举全库关键词制造这个结论。

## 4. 验证与限制

| 范围                       | 命令／证据                                                                                                                                                                                                                                                                          | 结果                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 解释、目录、私信、流式与UI | `OPENBOT_TEST_PROFILE=low pnpm exec vitest run --configLoader runner <23个定向文件>`；`/tmp/openbot-peer-final-tests.log`                                                                                                                                                           | 23文件／424项通过                                                      |
| Gateway与历史回放          | `OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run --configLoader runner --config vitest.gateway.config.ts src/gateway/server-methods/chat.history-tool-result.test.ts src/gateway/collaboration-learning/discuss-to-task-gateway-ws.integration.test.ts` | 2文件／13项通过；真实Gateway＋模型替身                                 |
| 最终短回执用例             | receipt、chat-turn、chat-entry；`/tmp/openbot-peer-status-final-tests.log`                                                                                                                                                                                                          | 3文件／17项通过（与上行有重叠，不相加）                                |
| 诊断与格式                 | 修改的31个TS文件 oxlint，`git diff --check`                                                                                                                                                                                                                                         | 通过                                                                   |
| 隔离构建                   | `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`；`/tmp/openbot-peer-build.log`                                                                                                                                                                                                  | 通过；未切换运行Gateway                                                |
| 全仓类型                   | `pnpm tsgo`；`/tmp/openbot-peer-final-tsgo.log`                                                                                                                                                                                                                                     | 退出2，扩展缺依赖及exec-protocol错误；无本轮改动文件报错，不称全仓通过 |
| 架构                       | `pnpm lint:core:architecture-manifest`；基线与当前各32条                                                                                                                                                                                                                            | 未全绿，本轮新增0条；不修改门禁规避                                    |
| 原始私信与跨身份           | `conversation-handoff.same-user.test.ts`等                                                                                                                                                                                                                                          | 当前主人隔离回归通过；没有发送真实会议通知                             |

已保留原始失败断言：可见回执包含 taskId／状态矩阵；新发送空回复错误回退旧正文。修复后相应断言通过。构建来源是 HEAD＋本轮源码快照，不能将构建标注中的 base SHA 单独当成本轮已提交证据。

本地正在运行的 Gateway 仍为本轮之前的 `bad73c986`；本轮尚未重启加载，页面效果未作通过声明。用户要求先提交交部署团队；落地登记仅限定到本轮文件，其他任务负责人、sessions 与登记内容保留。共享登记册不夹带进本轮源码提交。部署团队仍须先完成主干集成与发布门禁；源码回归不替代真实私信和页面验收。

## 5. 结论

两条业务通路必须保持分离：个体机器人通过既有内部会话私信协作；群任务通过群工作项、认领、计划、Wake与审查链推进。执行后端和展示基础可共用，通讯回执不能自动成为群责任转移或任务完成。

本轮完成可核实的源码修复和定向验证，客户经理跨主人权限、并发回信严格关联以及真实模型私信闭环仍需明确验收；不通过改归属或隐藏阻塞伪造“链路畅通”。

— codex-runtime-manager
