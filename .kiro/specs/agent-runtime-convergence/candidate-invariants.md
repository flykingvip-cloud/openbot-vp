# 后端候选执行组件提取不变式

只读对象：runAgentTurnWithFallback内runWithModelFallback.run(provider,model,runOptions)候选段。Contributor runtime-mainline-audit。不得将外层重试/admission/accounting整体搬成新引擎；以下是迁移前闭包清单。

## 外层拥有的读写闭包

| 状态/port                                                    | 候选内行为                                                | 不能改的生命周期                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| params/followupRun/sessionCtx/opts                           | 读身份、run参数、session文件、origin、callbacks、取消信号 | 身份来自host，不能由prompt重建；异步后current guard保留                 |
| modelGate/executionRouting/governance/runOptions             | transport/tenant优先级、auth、允许probe、model映射        | logical provider/model与transport provider/model有区别，计费/回调别错用 |
| getActiveSessionEntry                                        | CLI候选执行时读取cliSessionId                             | 必须lazy读最新，不能提取时预先snapshot                                  |
| assertTipBudgetAllowsModelCall/chargeTipBudgetAfterModelCall | 每次实际候选执行前检查、成功usage后计费                   | fallback多候选逐次计量；TaskBudgetExceededError必须重抛                 |
| bootstrapPromptWarningSignaturesSeen                         | 每次CLI/embedded读最新，结果后替换                        | 后续fallback看到上一尝试结果，不按构造时值捕获                          |
| didLogHeartbeatStrip                                         | normalization首次strip时set                               | 外层多候选共享，不能每个候选reset或重复日志                             |
| directlySentBlockKeys                                        | block flush直接发送时add，最终返回用于去重                | 同一Set引用贯穿候选和payload，不复制造成重复发送                        |
| commercialToolCallCount/classes                              | tool start增计；外层轮次重置                              | 不把retry计数挪进每个candidate或漏/重计                                 |
| modalityArtifacts                                            | image/music成功result按relativePath追加                   | 原增长/验收证据保留，不只返回text                                       |
| autoCompactionCompleted                                      | compaction end事件设置                                    | 最终通知及usage依赖，不能在候选返回后才“猜测”                           |
| pendingToolTasks                                             | 串行toolResultChain promise登记并finally删除              | 调用链不能变fire-and-forget失去drain/顺序                               |
| growth observation ports                                     | tool result按原event触发                                  | 尽力记账失败与产品失败边界不变                                          |

## CLI顺序

onModelSelected → isCli → budget precheck → startedAt/notifyAgentRunStart → lifecycle start → lazy cliSessionId → async credential scope/secret resolve（失败降级不泄漏）→ assertOriginalTaskCurrent → runCliAgent(host abortSignal) → bootstrap signatures回写 → assistant final event → lifecycle end → credential usage attribution best-effort → budget charge → result。

错误发lifecycle error后throw；finally若无终态再防御终态。当前预算charge抛错发生end后，可能再error，这是已有行为不能借迁移偷偷重排。host abort保留AbortError阻止failover；session expired retry是CLI内部已有逻辑。

## Embedded顺序

onModelSelected → buildEmbeddedRunContexts + baseParams（固定spread）→ resolveEnterpriseEmbeddedTransport（异步、tenant优先级）→ modelStartedAt/firstToken latch → budget precheck → model_started → tool observer创建 → assertOriginalTaskCurrent → runEmbedded。

参数spread：embeddedContext→trigger/group→senderContext→runBase→transport provider/model/override→trusted identity inheritance→bootstrap/images/abort/task binding/callbacks。identity最后相关优先级不可因DTO merge改变。

callbacks：partial先normalize/typing，再first-token，原opts回调；tool event先conversation observer，再原opts.onAgentEvent，再商业计数/growth/artifact/compaction；block handler保持pipeline/direct sent keys；tool result一条串行chain，normalize（审批卡特殊规则）→typing→opts tool callback，异常log且不毒化后续chain。

结果：更新bootstrap warning → model_finished ok → assistant_persisted → budget charge（预算错误重抛）→返回。catch model_finished false再throw。不得把provider返回视为已完成整任务。

## 提取接口约束

- 一个候选调用用例可以是完整组件；固定源码ports可接受，但不能把所有外层变量包装成any context或可配置callback registry。
- 可变状态用明确shared state/reader-writer ports保留引用及lazy读取；避免spread快照多个boolean/counter后不能回写。
- 原fallback选择/外层snapshot/admission/credit finalizers仍原owner；候选不另开retry、queue、subagent。
- 提取不得双注册events、tool observer或重复notify；错误原样交回fallback，不吞AbortError/TaskBudgetExceededError。
- no tool结果回执或artifact证据不能被文本化裁掉。

## 必测（原入口与组件结合）

1. CLI与embedded正常返回/失败：event顺序和数量、selected logical model与transport映射。
2. fallback连续候选：bootstrap read-after-write、计数和heartbeat去重状态保留；auth profile不跨provider泄漏。
3. budget拒绝零provider；charge budget exceeded继续重抛、不误报普通可恢复失败。
4. async credential/transport期间task暂停/切换：零候选启动；host signal中途cancel无迟到成功。
5. block flush/pipeline已发payload与最终去重；跨target messaging不压掉当前回复。
6. toolResult慢callback串行、pending集合最终清空；一个callback失败后后续仍发；审批卡安全CTA和silent/heartbeat抑制保留。
7. tool start/result/growth/modality/compaction证据次数原样；first_token最多一次。
8. credentials resolve失败不泄漏值，usage attribution仅真实选中凭据时记录。
9. fallback error保持原class/code/cause语义，计费与release finalizers仍跑。
10. 新公开入口导入无循环、无重复实现，基线/候选types/build warnings差量和实际e2e执行配置明确。

## 不可宣称

候选后端组件提取不是整runner拆完；CLI/embedded宿主、state、上下文与外部工具都有既有依赖。无signal或跨进程取消、通用异步恢复、任务验收等仍需各自证据，不因本次模块化变成已完成。
