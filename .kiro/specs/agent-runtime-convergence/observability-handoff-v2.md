# 可观测与用户体验接入交接

Owner: codex-runtime-manager。依据用户提供的 v2 规划，附件不是已实现事实。

## 评审决定

采纳执行、上下文、工作详情与平台改善分权；观测仅投影，不写任务板。工具结束不等于任务成功，投递不等于场景验收。当前runId会经Gateway映射，不能直接当attemptId；admitted_work_id须先映射既有准入request/task binding，禁止新造平行身份。fully_linked由服务端证据决定，前端不推算；ActionIntent后置并走原授权控制面。

## 已核实数据源

- src/infra/agent-events.ts：runId、seq、ts、stream、data；内存事件，没有持久回放保证。
- src/gateway/server-chat.ts：既有agent WS推送和会话路由，可能把原runId映射为clientRunId。工具result按verbose处理，不能将现有事件视为平台脱敏数据。
- ui/src/ui/gateway-subscriptions/chat.ts → app-tool-stream.ts：既有前端事件消费，不新增订阅或任务状态。
- src/agents/pi-embedded-subscribe.handlers.tools.ts：工具phase/name/toolCallId；默认观测不收集args/result正文。
- src/infra/execution-chain-provenance.ts：工具选择等日志与有界内存查询；尚非完整前端数据源或持久事实库。
- ContextCompileTelemetry：预算、消息数量、丢弃原因、耗时；完整编译身份、权限来源和版本链仍缺。
- delivery/dispatch/confirm-pending.ts与TaskOutcome：结果、验收和投递独立；callback-only仍unknown。
- delivery/artifacts/patch-pptx.ts与workspace-file RPC：原件SHA与编辑CAS，不代表KB索引或场景采用。

## 前端agent可直接复用

ui/src/ui/runtime-observation.ts 的 projectRuntimeObservation(value, receivedAt)消费原agent WS载荷，返回局部run/seq事件身份、发生/接收时间、stream/phase/toolCallId。只返回明确字段，不复制工具参数、结果或私有推理。当前资格固定execution_only，missing明确列出场景任务、准入工作、结果版本、来源证明。不得将其显示为fully_linked或已证明live。

模块已接原agent订阅并提供每宿主最多200条元数据缓存；严格匹配当前session，去重并标记断序、缺前缀、截断，连接关闭时清理。readRuntimeObservations(host, sessionKey)供工作详情消费；尚未渲染页面。前端agent须在原会话匹配和权限过滤后调用；按session/run有界存储，去重、乱序/缺序和重连显示partial。不得创建第二事实库。默认展示做了什么、交付什么、验证什么、剩余什么；工具诊断折叠展开，声明与验证事实分开。

## 纳入现迁移任务的顺序

1. P0：后端明确原run/clientRun、task/attempt/outcome引用、来源和版本；无关联返回缺失原因。
2. P0：原挂点补元数据，保持一次副作用；个人/协作权限及生命周期分别验收。
3. P1：工作详情、任务卡、诊断共用原事件投影。原延期折叠动作体验提升为迁移配套验收项，不新增控制面。
4. P1：编译版本、预算和来源覆盖回执；不默认上传完整prompt。
5. P2：预览、编辑、保存、归档、投递与场景验收分别回执，沿原CAS与权限。
6. P3/P4：samples/coverage先于metrics；ActionIntent待原控制面具备授权、幂等、回读、回滚后实施。

最小验收：同版本一个个人与一个协作案例，覆盖对话、准入、工具、等待、暂停恢复、交付；同时提供完整和partial样本。重复、乱序、迟到、重连、未知成本和来源不可伪造为零或成功。本轮没有新RPC、生产采集或指标控制动作。 — codex-runtime-manager
