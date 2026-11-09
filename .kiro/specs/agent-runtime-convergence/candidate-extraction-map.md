# 单候选 callback 精确提取图（只读）

行号基于当前agent-runner-execution.ts，建议实现者以`run: (provider, model, runOptions) => {`及fallbackResult边界再次定位。

## 精确边界

- 原callback开始`:657`，结束`:1142`；外层runWithModelFallback配置及`:1144`起result/provider/model/attempts与AOR审计全部保留。
- callback内最前`:660–665` onModelSelected保留在原wrapper，随后返回已构建`invokeCandidate(provider,model,runOptions)`。
- 迁移主体`:668–1141`，含CLI分支全部credential bridge/lifecycle/synthesized assistant/usage/finally，embedded contexts/baseParams/enterprise transport/阶段事件/tool observer/callbacks/usage charge/error。不能只迁runCli/runEmbedded那两行。
- warning signature初始值`:453`保留来源读取；其可变状态可以作为工厂私有状态（由initial值传入）或typed get/set port，优先工厂私有状态，不新增全局map。

## 工厂接口避免60字段

`createAdmittedCandidateInvoker({ request, effects, state })`在原runAgentTurnWithFallback局部只创建一次，返回与runWithModelFallback.run兼容的callback。不要每个candidate新建（会重置bootstrap warnings）；外层retry时原commercial计数reset语义仍生效。

### request（按原对象分组，非字段摊平）

- `turn`: 原params的必要Pick：commandBody/followupRun/sessionCtx/opts/typingSignals/blockReplyPipeline/blockStreamingEnabled/blockReplyChunking/resolvedBlockStreamingBreak/applyReplyToMode/pendingToolTasks/isHeartbeat/sessionKey。
- `runId`。
- `getActiveSessionEntry`（CLI session id必须候选调用时读取，不提前snapshot）。
- `getModelGate`（modelGate外层可能重入刷新，不捕获初始化undefined；返回原typed EmployeeModelGateResult）。
- identity这三个已解析标量或readonly结构：runGatewayClientUser/sessionDomain/platformUserId；保持原可信来源。

这些是legacy adapter输入，type-only依赖原FollowupRun/GetReplyOptions，不宣称最终跨平台SDK。

### effects（少数完整职责port）

1. `assertModelBudget`与`chargeModelBudget`：保留原调用位置与error行为；不得把gate实现搬入backend。
2. `notifyRunStart`、`emitAgentEvent`、`emitChatInboundStage`：宿主事件adapter；不要给每一种事件单建port。
3. `handlePartialForTyping`、`normalizeStreamingText`、`normalizeReplyMediaPaths`、`onToolResult`：保留当前真实结果处理，不能在新模块重造卫生规则。
4. `observeToolEvent(evt)`：原onAgentEvent闭包的商业计数/工具成功率/modalityArtifact/compaction mutation合成一个固定原局部port，按原位置调用。**不能**传60个counter setter；tool observer自身仍可随candidate backend创建。
5. 原shouldEmit/tool output等若主体实际未引用则不传；由TS unused检查确定最小Pick。

### state

- `initialBootstrapPromptWarningSignaturesSeen`数组在工厂初始化时接收，候选成功后保持原resolveBootstrap...更新；外层若没有其他读取可以完全收口，不返回给宿主。
- commercialToolCount/classes、autoCompactionCompleted、growthTool...、modalityArtifacts留外层，通过observeToolEvent一个port保持聚合。
- runId/enterprise slot/credit snapshots留outer，不能candidate重复acquire/release。

## 内部固定依赖（不是配置注入）

new execution runner module可直接import原runCliAgent/runEmbeddedPiAgent与provider checker、CLI session helper、credential adapter、enterprise transport等；明确legacy依赖清单。是否进一步把这些依赖交wiring在下一批讨论，不以本批消除所有gateway imports为目标。工具回调内createBlockReplyDeliveryHandler依赖delivery adapter，保留原固定实现可暂存；不引动态script。

若需要测试runner替换，可采用源码typed依赖对象，固定真实defaults由宿主wiring提供。不能引config callback/modulePath加载。最重要是原caller不再import两个provider runners。

## 保持调用语义

- onModelSelected每候选最前，fallback仍原runWithModelFallback拥有。
- CLI budget在credential桥之前；start先于凭证；凭证失败host fallback保持；CLI terminal只一次。
- embedded contexts/base参数为同步prepare，在enterprise transport await之前；transport后budget/model_started/toolObserver保持顺序。
- tool-result chain必须按每次candidate构造，串行await；pending集合still shared per turn。
- onAgentEvent先conversationToolObserver，再notify，再tool typing，再商业/成长/compaction记录；不因抽port改观察时序。
- result成功更新warnings，emit model_finished/assistant_persisted，charge异常原处理不改；throw仍由outer fallback处理。
- callback返回值仍原EmbeddedPiRunResult，不包新result envelope导致fallback consumer改语义。

## 原consumer退出

原callback主体删除，保留onModelSelected+invokeCandidate调用。移除仅主体使用的runCli/runEmbedded/credential/transport/provider-specific imports；共享type换import type。原`runAgentTurnWithFallback`继续唯一外层循环与授权入口，不复制整函数。

新工厂通过execution/runner公开入口暴露，避免execution/index barrel使recovery consumer加载provider闭包；可以显式`execution/runner/index.ts`。新增真实consumer迁移证据与manifest限制旧caller不得直导provider runtimes。旧utils prepare/context类型可暂用，不回头再包相同helper。

## 实施分段/验收

A factory+完整CLI/embedded主体同时迁（约470行，低于700指南）；B outer callback与imports替换；C测试与manifest。保持一个coherent绿色提交，不先交未接consumer的新工厂。

若需要拆更小，CLI完整分支先独立candidate adapter，embedded后迁，但阶段报告明确未完成provider脱钩。

测试：原agent-runner misc/media/credits/BYOK/entitlement/run-id，新增factory候选顺序：primary失败fallback成功、CLI credential失败、CLI error/finally terminal、transport failure未budget、abort、身份/privateRunBag/skipPersist透传、block/tool callback顺序、warnings跨fallback保留、outer finally释放一次。原real入口测试必须看到new factory调用，不能只测新helper。

先用baseline事件trace固定，候选对比。原有build/tsgo差量门槛，不更改业务错误归类或fail-safe。该批不是架构全完成，只关闭原控制函数的直接provider执行依赖。
