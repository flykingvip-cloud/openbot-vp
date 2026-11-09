# Execution 五段现状映射（只读）

范围：专用树当前代码；contributor runtime-mainline-audit。以下按职责分段，不主张把attempt整体迁入runner或新增外层执行循环。源码行号用于定位，不代表生产有效配置。

## 五段映射

| 目标段       | 现有真实路径                                                                                                                               | 当前职责及写入                                                                                           | 混合职责/边界                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| selection    | agent-runner分流、queue-policy；agent-runner-execution.ts:641 runWithModelFallback；pi-embedded-runner/run.ts:393 resolveModel             | 当前任务焦点选择、队列准入、模型/供应商回退与auth候选选择；run.ts:283/285进入global/session lane         | 任务选择≠模型选择。并无已证通用待办选择器，模型提出业务下一步。不能新增Todo外循环 |
| preparation  | get-reply-run上下文；attempt.ts:1279 createOpenClawCodingTools、:1545 buildEmbeddedSystemPrompt、:2007/2158/2175加载/净化/限历史           | skills/bootstrap/context、工具策略、sandbox/身份、会话锁和SessionManager准备；可能调整会话历史与role顺序 | 不是纯prompt formatter；工具创建/权限、锁和转录生命周期不能整体搬进context        |
| runner       | agent-runner-execution.ts:716 runCliAgent / :907 runEmbeddedPiAgent；run.ts:921 runEmbeddedAttempt；attempt模型prompt/工具运行             | active run注册、订阅、abort/timeout、usage、模型响应/工具循环、转录持久化                                | 包含计费/成长/路由反馈、UI事件、上下文错误重置，尚非纯runner组件                  |
| verification | attempt协议边界、工具结果；rewrite-visible-reply.ts的settleTurnCompletion；agent-runner后置complex-task shaping                            | 协议输出/候选成果/回合契约校验；部分会写转录或完成记录                                                   | 协议核验≠步骤验收≠业务整体验收≠投递。迁移先保留位置与门禁                         |
| recovery     | run.ts overflow/profile/backoff；agent-runner-execution.ts:1379重试fallback周期；attempt.ts:2675 stall；task-board-continue schedule/claim | auth cooldown/健康更新、压缩重试、有限隐藏continue、持久stall额度、跨回合票据重检/入队                   | 基础设施retry、回合continue、跨回合wake不能混成一个预算或可配置workflow           |

## 实际写入/副作用位置

1. **任务板**：command接受变更经原state锁内更新；checked completion、自动park、focus gate走mutate。task-board-continue主要读取身份/控制并安排队列，不是任意任务写入口。
2. **主会话转录**：attempt维护SessionManager，:2506–2517孤立user叶分支修复，:2887 appendCustomEntry(prompt-error)。原agent prompt/订阅持久化受session锁；不可改成raw JSONL。
3. **会话元数据**：agent-runner-execution.ts:1328 updateSessionStore（错误/恢复分支）；恢复可能修改会话身份/状态，非纯重试函数。
4. **凭据健康与模型状态**：pi run的auth-profile good/failure/cooldown等；必须保留真实attempt完成后的原时序，不能放到选择阶段就预记成功。
5. **额度/记账/观测**：stall ledger原子claim；agent-runner-execution.ts:1167 recordCreditUsage；growth工具/任务outcome :263/:303/:352；AOR反馈:1139/:1150。这些外部副作用应固定ports或适配器，不能遗漏/重做。
6. **技能/执行审计**：attempt.ts:3105 recordLifecycleSkillsLoadedOnRun，:3148 recordExecutionTrace；成败/取消情况下有清理与记录语义。
7. **活动与取消注册**：attempt.ts:2237 abortRun，:2365 active handle，:2387 timeout，:2418 signal；finally清理:3254附近。不可只抽start而丢准备/结束窗口。

## 优先保留的不变式

- 同一源数据与模型调用次数不增；global/session lane、sandbox和tool wrapper顺序不变。
- 用户控制状态优先，协议终止/超时不能被recovery恢复；abort影响范围按原入口。
- 每类重试额度独立；claim发生在真正发起下一轮之前；模型failover不得重放已成功外部写。
- SessionManager转录、任务板、usage记账属于不同权威，不能以一个result布尔值合并。
- reply_lane独立session/禁工具，不移入主任务推进器获得控制权。

## 推荐最小完整迁移候选

**回合内停滞恢复（bounded stall continuation）完整组件**，而非attempt整体。

已有execution-stall-continue-loop.ts拥有一次明确业务行为：给定原停止判定与额度，在取消/超时/协议门禁下发有限隐藏继续，并返回使用次数。可将其整体归execution/recovery，保持原导出兼容；连同明确输入/输出类型、错误处理和协议保护契约。attempt保留工具/消息/session上下文适配、claimStallContinue持久化及调用点，或者通过固定源码ports注入；不把cap/budget做外部可执行配置。

先审其真实catch/onContinued先后与协议中途终止行为；旧loop文件改纯reexport并确认相同函数引用，旧执行实现退出。测试覆盖取消前、发送失败、协议在隐藏轮后终止、onContinued调用次数、额度耗尽/空工具回复；已有attempt集成哨兵与真实停止序列保持。若依赖原agents/protocol模块，在contracts/公共机制未提取前使用明确adapter，不建立execution→巨大agents任意反向依赖。

该候选迁移不宣称已拆完recovery，不包含模型failover/压缩/cron。收益为一个完整、可独立管理的恢复职责，不是字段formatter；可以独立回退、无存储迁移。

## 后续分段门槛

selection先定任务与模型选择的术语；preparation先列资源获取/释放对；runner先剥离计费/观测适配而不移除；verification先分协议/成果/交付；recovery逐类保留原失败与重放语义。任何“把attempt放进新目录即完成runner”的做法不接受。
