# Runtime context source map — M1 后续只读评审

工作树：runtime-convergence/openbot。源引用以当前行号为准；未编辑目标树、未运行测试。下列是源码事实，不是线上启用证明。

## 入口求值次序与来源

`src/auto-reply/reply/get-reply-run.ts` 的上下文并非一个纯文本列表；保持下列相对次序，不能将全部 builder 并行化。

| 时序/位置     | 来源与输入                                                                                    | 输出/placement                                                                                   | IO及副作用                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 1 ~946        | knowledge builder：inboundMessage、agent/session、客户端身份、scopePlan、depth/ceiling、abort | promptBlock→system；另有evidence/source IDs/receipts/diagnostics                                 | 网关身份解析及知识检索；可能live sources，不是纯格式化；随后emit阶段事件、appendContextScopeAuditRecord |
| 2 ~1014       | growth birth：cfg/agent，限growthBirthTurn                                                    | system                                                                                           | async读取，保持门控                                                                                     |
| 3 ~1018       | cron：来源job/run/name                                                                        | system                                                                                           | 入口本身同步builder；不触发调度                                                                         |
| 4 ~1030–1060  | user modeling key/profile/instructions、seat context                                          | system userProfileInstructions/seatRules；profile还影响timezone；seat还refine execution identity | async profile/seat读取；recordUserInteractionSignalSafely异步记录，不能藏进纯context                    |
| 5 ~1075–1092  | 本会话消息→语言；环境提示；focus-resume                                                       | system；opts.expectedReplyLanguage也更新                                                         | 读取会话/任务记录，opts写入                                                                             |
| 6 ~1094       | aside durable history                                                                         | untrusted-user，后~1367 append                                                                   | sidecar文件读取+4k正文预算；不得进入system                                                              |
| 7 ~1098–1120  | composer bindings + execute mentions                                                          | bindings.turnPrompt、execution.summaryPrompt→system                                              | **实际tool.execute**，见下；不属于只读来源                                                              |
| 8 ~1124       | collab分支 assembleCollaborationRuntimeContextParts                                           | 有序system parts                                                                                 | 多来源并发IO＋sessionCtx mutation，见下                                                                 |
| 9 ~1160–1230  | 普通分支meta/group→continuity→focus→objective→preflight→identity                              | 有序system parts                                                                                 | 后几项有读取；不能按数组顺序推断实际求值顺序                                                            |
| 10 ~1250–1278 | taskSurface/clarify/speaker，learningRecall                                                   | system追加                                                                                       | learning有exposure记账，不是纯读取                                                                      |
| 11 ~1355      | drainFormattedSystemEvents                                                                    | system Runtime events区块                                                                        | **drain消费**，只调用一次，不可在装配retry重跑                                                          |
| 12 ~1370      | 原UntrustedContext + aside context                                                            | user-body                                                                                        | 格式化；保留规范化边界                                                                                  |
| 13 ~1390      | runtime skill policy/preferSkillHint                                                          | filter及system hint                                                                              | policy影响能力开放，不只是文字；不能移入纯context执行                                                   |

## 五个重点组件

### runtime-context-assembly

`runtime-context-assembly.ts:201`开始assembly。先await group profile；随后`:219`起Promise.all并行读取 operatingState、charter、identity、collaboration capability、active continuity。然后格式化charter/phase、group context/intro/mission。`:280`左右await resolveDeliveryExecTurn，并**设置/删除 sessionCtx.DeliveryToolSideEffect**。最后以固定顺序输出 identity→charter→mission→delivery→phase→group→intro→continuity→capability→groupSystem→meta。

结论：它是混合用例，不是可直接整体移动的纯供给；delivery授权执行元信息要归业务/能力准备，不应被context服务暗中写入。

### knowledge

`knowledge-universe-context.ts:57`入口，`:116`身份网关，`:141`并行buildAgentCognitiveKnowledgeBundle/resolveKnowledgeSourceContext，`:152`证据budget，`:174`formatAgentKnowledgeSystemPrompt。输出不仅prompt，还包含来源、receipts、diagnostics；下游审计消费这些字段。

不得仅返回string后丢弃数据。live读取是否执行及审计由原策略和identity边界控制。

### learning

`learning-recall-context.ts:94/107`入口；`:134`并行readLearningRecall，随后merge/render；`:168/176`记录retrieved/injected暴露，末尾按exposureKey登记pending scopes。不触发curation，但有写入记账。提取时不能重复source调用，不能丢run-bound exposureKey或退化agentId共享键。

### identity

`operational-identity-context.ts:27`入口，`:69/102/119`用户/企业identity访问读取；`:89`steward workspace scope；`:138`数据能力listing。输出system说明但原授权数据仍由gateway治理。搬迁不等于把权限判定降格为提示词。

### composer

`composer-plugin-mention-execute.ts:300`入口，`:331/345`执行插件/连接器mention，`:173–181`直接tool.execute，`:294`生成host-executed摘要。它在主模型调用前已做动作；必须归capability invocation/wiring，不是context source。M1不得搬动、重排或重复调用它。

## 下一等价提取组件：优先选择

首选**协作任务说明投影** `buildCollaborationGroupMissionPrompt`（runtime-context-assembly.ts:137–174）。输入仅SessionEntry/profile的数据，输出group/purpose/mission/mode/criteria/instructions的确定文本。它是实际领域上下文组件，不是spread helper。

最小做法：context/sources/collaboration-mission.ts定义窄输入profile DTO，不依赖config/sessions；原函数保留兼容委托与profile选择，唯一格式化实现迁入。原assembly仍按原时点调用。测试逐字段、trim、空profile、空数组、显式resolvedProfile优先、完整输出字节等价。

第二选择：identity的**render部分**，保留listUser/listEnterprise读取与授权在原adapter，只将已解析access DTO转prompt的纯render迁入context。先核查内部格式函数是否已有，不能复制格式规则。

不建议下一步整体搬 knowledge/learning/runtime-context-assembly；它们均含IO/记账/执行元信息，需要先分read/resolve与render，再以source adapter契约承接。

## 回归与门槛

- runtime-context-assembly.test.ts（含profile优先和输出顺序）
- operational-identity-context.test.ts
- knowledge-universe-context.test.ts / .reply.test.ts / .selection.test.ts
- learning-recall-context.test.ts / learning-recall.test.ts
- composer-plugin-mention-execute.test.ts（确认执行次数未改变）
- get-reply-run.aside-dialogue-context.test.ts（真实入口信任/顺序）

先选component定向测试，不一口气搬五类来源。门槛：无新增模型/工具调用；无source重复执行；输出顺序/正文/信任级别不变；原门控与超时/abort保留；context不能依赖gateway执行或task mutation；无新增动态import。架构manifest复用现有检查。
