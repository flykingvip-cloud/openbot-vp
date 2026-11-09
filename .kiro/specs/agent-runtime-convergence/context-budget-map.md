# Context 预算归属只读审计

审计树 `/Users/daniel/.codex/worktrees/runtime-convergence/openbot`；采样 tip `7f782174ff6eb1b52b76a3a1c9a5e45720f6a67a`。未改树、数值、开关，未提权、提交或运行模型。代码变化中的行号仅用于本次定位。

## 归属与调用顺序

| 层/实现                                                                           | 控制对象                                                              | 生产接线与边界                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 检索证据预算 `src/gateway/context-scope/budget.ts:35,53`                          | 取数策略的 maxFiles/maxTokens、证据列表                               | `knowledge-universe-context.ts:152` 调用；是来源预算，不是完整 provider 请求预算。首条证据允许超 token 上限（kept.length>0 才 break），不宜称绝对 token hard cap                                                                  |
| 活动上下文 assembler `src/auto-reply/reply/context-budget-assembler.ts:82`        | current_task、group_decisions、constraints、summary 等 system capsule | 经 runtime-context-assembly 接线；`resolve-context-budget.ts` 合并默认/岗位/agent，未配置时实际 enabled=false，尽管 DEFAULT_CONTEXT_BUDGET.enabled=true。recent_messages loader 明确为空，归 compiler；避免误判为两处都注入转录   |
| Assembler 分段预算                                                                | maxTokens×4→maxChars，priority 裁剪                                   | 近似字符预算；estimateChars 用 grapheme，而截断使用 UTF16，上界单位并非真实 tokenizer。最终还按 maxChars 截断；不能与 provider token budget 直接等同                                                                              |
| 模型窗口 guard `src/agents/context-window-guard.ts:22`                            | 模型容量及 agent contextTokens cap                                    | `run.ts:435–442` resolve 后 cap 实际 model.contextWindow，让 Pi auto-compaction看到有效窗口；这是容量上限，不是内容选择器                                                                                                         |
| Bootstrap `src/agents/pi-embedded-helpers/bootstrap.ts:100,108,129`               | 工作区注入文件每文件/总字符，头尾保留                                 | `attempt.ts:1210–1218` 准备及 system prompt 构建；`bootstrap-budget.ts` 主要分析、告警、统计，不应把告警模块当裁剪权威                                                                                                            |
| DM 历史轮数 `src/agents/pi-embedded-runner/history.ts`                            | 按配置保留用户轮次                                                    | `attempt.ts:2165` 先 limitHistoryTurns，再工具配对修复；早于 contextEngine assemble和provider编译。被此处删掉的材料后续compiler不可复原                                                                                           |
| Conversation planner `src/conversations/context-budget.ts:104` / context-assemble | recent/summary/tool 等对话切片预算                                    | `context-engine/legacy.ts:191–228` 仅 contextPlannerEnabled 且 tokenBudget有效时动态调用；是可选前置历史选择，与compiler可能叠加。有效开关未核实                                                                                  |
| Context compiler `src/agents/context-compiler/compile.ts:181`                     | outbound消息原子单元、操作capsule、lane token admission               | `attempt.ts:1800–1830` 默认开（flag.ts OPENBOT_CONTEXT_COMPILER）；transformContext 进入provider边界。lane-budget chat/retrieve/act floor=6k/10k/16k；根据窗口缩放，上限act48k、admission0.8、估算margin1.2；本次仅记录，不调整   |
| Compiler lane与turn cap                                                           | maxRecentTurns及候选保留、估算token                                   | `compile.ts:184–204` maxRecentTurns取显式/协作策略/lane值；`install.ts:46–81` 链接原transform再编译，保留当前轮失败则拒绝；model-boundary wrapper校验泄漏。它的“sole authority”指最终消息编译，不代表负责system/bootstrap所有预算 |
| 工具结果截断 `src/agents/pi-embedded-runner/tool-result-truncation.ts:122`        | 单工具结果占窗口比例，硬字符上限                                      | 30%窗口、最多400k字符；run.ts overflow恢复在compaction后必要时 truncateOversizedToolResultsInSession，可能修改持久化会话，不能当纯临时prompt裁剪迁走                                                                              |
| TTL pruning `src/agents/pi-extensions/context-pruning/settings.ts`                | 过期工具结果soft trim/hard clear                                      | extensions.ts 接入Pi扩展；独立于compiler token admission，按TTL与占比清工具上下文。不能仅因都删除tool text就合并                                                                                                                  |
| Compaction `src/agents/pi-settings.ts`、runner                                    | 历史摘要、reserve/keepRecent token、溢出恢复                          | SDK自动compaction＋run.ts显式overflow；run.ts:1095 起避免已自动压缩后立即重复显式压缩；显式失败后可截断过大工具结果。attempt有压缩等待聚合超时与前快照恢复                                                                        |
| Aside历史 `mid-task-aside-dialogue-history.ts:25,137,387,440`                     | 旁路历史正文4000字符、turn cap                                        | 用户体不可信上下文；这是来源级额外预算，不是模型总窗口。完整有效任务约束不应被旁路历史正文预算截断                                                                                                                                |
| chat.history `gateway/server-methods/chat.ts:1343`                                | UI返回消息条数/体积                                                   | 先merge sidecar再bound；这是展示响应限制，不是模型上下文预算，不能合并为一个配置                                                                                                                                                  |

## 重叠与风险判断

1. 历史会依次经过 DM turn limit → 可选 conversation planner → compiler turn/token选择；属于串联多次裁剪，存在过早删材可能，但不能无证据取消任一层。
2. 活动capsule、focus-resume、compiler operating capsule可能覆盖同一任务事实；需以实际 assembled provider payload证实重复，不能只凭函数名宣布重复。
3. 字符、grapheme、粗估token与provider窗口不是同一单位；统一服务应携带unit/scope/source/limit/applied计量，禁止直接改成一个总数。
4. System prompt、tools schemas、bootstrap可能不在compiler消息预算内；须分别记录最终provider envelope组成，不能把消息层“sole authority”扩大成全请求预算证明。
5. 运行时pruning、持久化工具截断和compaction有不同副作用，不适合一次性搬进纯context assembler。
6. contextPlanner开关、agent预算、真实模型窗口及pruning启用仅有源码证据；生产有效值未知，不输出配置秘密。

## 下一个最小可回退迁移建议

仅提取无副作用的预算描述/归属适配，不改算法、数值、开关或删材顺序：

- 定义只读 BudgetDescriptor（scope=source/messages/envelope/display，unit=chars/graphemes/estimatedTokens/tokens/turns/files，limit、owner、stage）。
- 先覆盖 assembler、lane/compiler和aside三处，原解析函数保持权威；新接口只投影原值，禁止新增预算规则。
- 编写同一输入的新旧值快照契约测试，并证明prompt输出与drop顺序完全相同。
- 如团队已有context模块契约，直接补此描述而不另建registry或事件总线。
- 独立提交可回退；下一批才用输出证据决定是否统一来源选择。工具截断/compaction最后迁，因会修改会话与控制重试。

完成只读审计。— runtime-extension-audit
