# Runtime wiring / policy 边界只读评审

本评审依当前专用树与管理者给定六个议题归纳；未收到“用户六点”逐字文本，不将下述归纳冒充原文。不编辑目标树。

## 六项可采纳与需纠正

1. **业务三层＋单一执行主线：采纳。** 不等于所有Gateway处理都移到同一巨型run函数。协议、认证、去重、sessionFile准备、焦点控制与终止应有确定入口顺序。
2. **组件独立接口：采纳。** 每层必须有真实业务用例与消费者替换；不要先建空command/execution/delivery facade，仅转发原大函数却宣布分层完成。
3. **统一execution公开入口：采纳，但后迁。** 先厘清Gateway的控制短路、aside、queued任务与正常execution的不同输出，不能把暂停也当一次模型执行。
4. **上下文source可替换：部分采纳。** 任务上下文/转录是核心连续性输入，不是可任意关闭的检索插件；memory/knowledge可选来源可按能力、授权与预算降级。
5. **规则与治理插件化：部分采纳。** 可替换算法、政策数据与adapter；授权/身份隔离/取消/审批执行点必须强制存在。AOR与constitutional的核心约束不能因名称带可扩展就一律optional。
6. **wiring集中组装：采纳。** wiring持有实例与ports连接，不拥有路由判断、任务变更、retry、工具执行或投递规则。每次提取后原业务主体删除，不以多层wrapper替代边界。

## Gateway与execution迁移顺序

先固定现有Gateway：认证→请求去重→sessionFile可靠落定→焦点/任务板控制→必要abort/清队列→控制ACK并return→普通dispatch。现有暂停/取消独立短路是必要责任，不是冗余执行器。

第一批提取Gateway stop用例与command控制ports（已存在者审消费者），Gateway保留协议对象和会话身份映射。第二批固定command返回结果（已答/控制结束/待执行/排队），再把正常任务请求送execution port。最后从agent-runner-execution提纯execution facade及平台adapter注入。

不得先强迫所有消息经过execution：进度只读、普通aside、取消均会受不必要的执行占用/回合副作用影响。不能把控制入口删除后依靠模型理解停。

## runner五段契约

1. **接纳与分流**：可信身份、run/message/task关联、active/streaming、原队列模式；输出直接回复/控制结束/注入结果/排队/正常执行。
2. **准备与上下文**：按原时序解析sources与权限/模型/技能可用范围，保持system/user placement；不丢receipt/exposure账。
3. **执行**：原runAgentTurnWithFallback→embedded/CLI；唯一工具/模型循环；AbortSignal、超时、恢复额度和model admission保留。
4. **结果核验与任务结算**：步骤证据、回合契约、当前任务身份；不将模型stop等于任务done，不因旁问结束清主任务。
5. **交付与后续处理**：payload/stream/final归属、投递回执、用量与审计、task-board continue票据；恢复先校验，不重开独立循环。

这五段描述契约，不要求建5个类/5次模型调用。控制短路可以在第一段结束；execution端不能自动执行第一段的所有分流。

## transcript不是可选source

转录是会话事实、消息身份及恢复依据，优先尊重当前用户轮与任务板。可预算截取但不任意关闭；旁路sidecar是需合并的原角色历史，不是随意RAG知识。任务结果追问、复述、resume都依赖此连续性。memory/knowledge降级不应顺带清转录或更换作用任务。持久化/去重/隐私边界保留原路径。

## AOR / constitutional不可一律可选

`agent-runner-execution.ts`包含model entitlement scope、capability admission、AOR反馈与审计消费。应逐项区分强制入场/授权与可选策略优化/观测：前者缺失须拒绝或明确受控退化；后者可默认关闭。constitutional名称下也需区分shadow观察与实际强制停止/权限规则，不能全局按plugin开关关掉。是否optional由调用契约与实际门禁决定，不由目录或品牌决定。迁移时不得把deny错误捕获成“无插件，继续执行”。

## 下一切片：focus formatter纯投影

当前`command/task-status.ts`静态导入`conversation-task/session-task-board.ts`的formatTaskBoardFocusLine，造成command barrel加载board/infra闭包。函数本体在`:238`仅trim current.title、读parked.length，返回3种固定文本。

建议目标为`agent-runtime/context/task-focus.ts`（或现有纯投影约定目录），接口只需 `{current?: {title?: string}; parked: readonly unknown[]}` 或`Pick`纯contract。推荐窄命名DTO，不引整个SessionTaskBoard运行时。仅type import，固定函数名与字符串语义。

原board import并compat reexport同一函数（内部消费者使用import符号），command直接引用纯context入口；不得形成context→command→board闭环。旧board函数删除，单一实现，兼容不是复制。

风险：不要将parked.length改filter unfinished；不要将current.title fallback goalText；不要改变title.trim或引入live运行状态；context纯投影不能读取文件。三分支+空白title+数量+输入不变/同函数identity测试。command barrel加载测试应证明不再导入board（mock抛错或静态依赖边界），但不要求创造通用依赖容器。

## 回归/门槛

现有command四用例tests、原mid-task-dialogue/aside、任务板focus tests、Gateway stop入口；manifest规则/公开出口自检。上下文与公共policy为静态接口，不新增脚本配置。新增wrapper若无职责变化不计成果；组件完整性以明确数据所有权、决策与副作用边界衡量。

## 与目标 execution 五段对应

上面的实际入口/后处理次序不是另造 execution 分段。目标五段仍为 selection（选取原有效步骤/请求）、preparation（上下文与能力准备）、runner（唯一模型工具循环）、verification（结果证据与步骤判定）、recovery（等待/重试/恢复）。每段先有真实输入输出与测试，再迁移逻辑；不把 attempt.ts 整体搬进 runner 后以四个空目录宣称完成。Gateway 协议与 delivery 后处理仍在对应边界之外。
