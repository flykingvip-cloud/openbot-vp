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

## 接口收尾与前端集成复核（2026-11-06）

- Gateway 已保留映射前 sourceRunId；事件身份按 client run、source run、sequence 组成。缺省、空串和纯空白 sourceRunId 统一为缺失，防止同一证据重复入缓存。接口不提供 attemptId 的猜测映射。
- 本轮定向验证：runtime-observation 与 server-chat.agent-events 两文件共 36 项通过；包含来源身份归一化、会话隔离、断序、200 条保留上限、映射运行隔离及读取快照不可反写缓存。提交 263c8ae53、5153d38a4。
- 工作树已出现 observation 工作台及 diagnosis 集成，仍为其他任务未提交 WIP，部分路径存在归属冲突。因此上文“尚未渲染页面”指本任务已验收交付边界，不代表工作树没有页面实现。未将这些页面改动纳入本任务提交或验收。
- 给前端集成的审查要求：缺场景引用时 scope 必须 unknown，不默认 personal；没有来源证明时不得把 source=live 当数据资格；运行耗时必须匹配同一身份的 start/end，不能用任意阶段最大最小时差补齐；最后一条工具 end 不能概括整个运行全部工具完成；浏览器内缓存只代表当前连接观察范围，不代表平台跨任务查询。
- 现阶段只能供给 execution_only/partial 元数据。fully_linked、成果验收、真实归属成本、跨重启回放与平台指标仍待服务端权威关联，不通过 UI 合成。下一验收应先补场景引用与准入身份的原始挂点，再做个人/协作同版本链路；不新增状态机或执行路径。 — codex-runtime-manager

## 页面集成复验

工作台提交 a2a8c6f5b 已进入本分支，ea3722b34 修正未知场景默认个人及非配对耗时；不再将这些文件标为未提交 WIP。逻辑测试两文件 8 项通过，Chromium 两文件 3 项通过；交互准入、状态持久化、恢复与原 followup 交付九文件 74 项通过。架构 44 条规则通过；UI 构建成功，仍有大 chunk 警告。这些为独立范围，不合计成全链真实验收。没有真实模型、生产持久回放或 fully_linked 样本证明；未部署。 — codex-runtime-manager
