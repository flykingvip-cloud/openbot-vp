# Execution 准备/结果边界规划（只读）

审计对象：专用 runtime-convergence 工作树 `src/auto-reply/reply/agent-runner-execution.ts`，并参照 agent-runner-utils、agent-run-credit-usage。未修改实现、未提交、未执行模型。行号随管理者集成变化。

## 现有主线与不可绕过部分

`runAgentTurnWithFallback`（约150）创建/继承runId，入口恢复真实task-outcome身份与预算；commercial admission/并发占槽（约530–578）→ capability routing/allowlist → embedded governance → parent model-set snapshot（约639）→ 原runWithModelFallback（约641）→ 单次候选CLI或embedded运行 → usage/反馈 → 结果返回 → finally释放运行槽并forgetRunModelSet（约1489）。

这里不只是模型调用包装，包含强治理和任务结果责任，不能整函数搬到“通用模型SDK”后旁路调用CLI/embedded。不得新增一层模型fallback、独立选择器或独立重试预算。

| 现有责任           | 证据位置                                                                              | 必保语义                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 身份与task-outcome | 函数入口约190起；inheritExecutionIdentityRunFields约925                               | 真实taskId、tenant/operator/collaboration owner，不得用runId补造taskId，不接受模型提供身份 |
| admission与并发    | tryAcquireEnterpriseAgentRun约550；modelGate/订阅快照                                 | 拒绝即终止，不启动provider；slot与snapshot成对释放/清理                                    |
| 候选与fallback     | executionRouting、consumeCapabilityRoutingResult、runWithModelFallback                | allowlist/能力失败不能通过fallback绕过；同一次run上下文保留                                |
| CLI适配            | isCliProvider约661、runCliAgent约716                                                  | CLI session/credential隔离、生命周期补发、usage归属；不是天然等价embedded                  |
| embedded适配       | buildEmbeddedRunContexts/baseParams约830；enterprise transport约849；runEmbedded约907 | 商业授权、租户transport、abortSignal、工具observer、sender身份不丢                         |
| task budget        | assertTipBudgetAllowsModelCall、chargeTipBudgetAfterModelCall                         | 每次实际模型尝试计量，不能只计最终成功；重试不能重置预算                                   |
| 流式与投递         | partial normalize、createBlockReplyDeliveryHandler、toolResultChain                   | channel表现与业务执行分离；直接发送key防重复；pending tasks生命周期保留                    |
| usage与反馈        | recordCliBackendUsage、recordCreditUsage、recordAorRunFeedback                        | 失败/重试usage保留、供应商与模型真实归属，不能以候选请求值覆盖实际值                       |
| 交付后结果提交     | AgentRunLoopResult.commitGrowthOutcome约143；返回success约1470                        | run完成不等于交付成功；由原agent-runner解析验收后恰好一次提交                              |
| 可恢复错误         | outer loop约450、软entitlement/HTTP等约1345起                                         | 保留原次数/预算和副作用保护，不抽成通用无限retry                                           |

## 目标公开契约（窄接口，分阶段）

不一次引入所有类型。先以现有types适配，公开契约不能返回含密钥的对象。

### A. Preparation / admitted scope

`prepareExecutionScope(request, trustedContext, signal) -> denied | admittedScope`

- request：run/task/message/session refs，模型候选意图、已装配输入引用、执行选项。
- trustedContext：由原入口构建的租户/用户/授权身份，不由调用者随意拼接。
- admittedScope：不透明准入结果引用、允许候选、预算句柄、生命周期finalizer；不直接暴露credentialEnv/token。
- scope在同一run内建立；finally负责release，不允许能力插件取得一个绕过准入的runner引用。

这只描述已有commercial gate职责；初始迁移不改其发生顺序，嵌入式transport解析仍随实际fallback候选进行。

### B. Existing single-candidate backend port

`invokeAdmittedCandidate(scope, candidate, input, eventSink, signal) -> BackendAttemptResult`

- 由现有runWithModelFallback调用，不能独立再次fallback。
- CLI/embedded各自适配现有runner，无新模型层。
- input显式区分system/context、用户正文、工具策略及workspace引用。
- eventSink传partial/tool/lifecycle事件，观察者不能回写任务或启动下一步。
- BackendAttemptResult含payload、实际model/provider、usage、error、compaction/tool evidence与持久化回执；保留差异，禁止为了统一抹掉abort/credential/工具语义。

### C. Result / accounting boundary

`finalizeAttemptUsage(scope, attemptResult)` + `ExecutionOutcome`

- 先仅提取纯usage构建（已存在agent-run-credit-usage），真实写审计仍由原owner执行。
- ExecutionOutcome区分候选失败、控制终止、执行返回；不把LLM返回文本等同验收完成。
- 当前commitGrowthOutcome保留兼容且一次调用；长远使用有身份的delivery outcome提交，但本切片不扩状态机。

## 首个最小迁移切片

1. 提取embedded准备中纯数据构建：runBaseParams、sender/authProfile引用、identity字段继承、toolResultFormat等，以 existing helper 为基础，不另造重复builder。
2. 公开一个 `prepareEmbeddedInvocation` 窄契约，返回无副作用参数（敏感值保持原适配域），仍在原候选回调中调用，enterprise transport与强gate不移动。
3. 原runEmbeddedPiAgent调用保持原位置；旧构建代码删除，旧入口可临时转接公开接口，不双实现。
4. 对相同输入做参数差量测试，尤其identity、governance、abortSignal、tool observer、stream callbacks；补CLI分支不受影响测试。
5. 再单独提取结果归一化/usage纯函数；最后才考虑拆有状态lifecycle。不要先把1500行改名搬目录。

## 验收与不可绕过门禁

- denied gate时CLI/embedded调用次数均0；fallback不能越allowlist。
- 任意成功/失败/abort均释放run slot且清理model-set；不误清其他run。
- 每次真实候选尝试计预算，失败usage不丢；没有新fallback循环。
- CLI保持credential scope和session引用；不把credential纳入公开事件/日志。
- embedded保持executionIdentity、commercialAuthorizationId、tenant transport、abortSignal以及工具调用观察。
- partial/block/tool投递仍按原run归属，directlySentBlockKeys与pendingToolTasks不丢。
- 任务完成只能由验收/交付结果提交，模型完成不提前结案。
- 公共接口仅允许核心wiring调用；插件/Skill不得直接构造admitted scope获得执行权。

本计划不批准代码迁移或新增模型调用层；供管理者选择下个绿色检查点。— runtime-extension-audit
