# Runtime 最终贯通实施计划（只读审查）

基线HEAD `10ae0b5af7bea5735abcade4bcd6a58ab5d4eddb`。未写目标树、未运行测试。

## 整体完成不能宣称

当前有：command四业务用例、context五纯组件、task/acceptance/blocker contracts、delivery settlement/payload preparation、execution准备参数/recovery、blocker policy。

当前没有完成：统一command入站用例、execution正常任务公开入口、完整delivery结算投递闭环、state repository消费口、能力调用契约、composition root。旧`agent-runner`仍同时处理分流/队列/flush/session reset/执行/空结果补救/验收呈现/计费通知/followup续醒。`agent-runner-execution`仍拥有provider授权、CLI/embedded选择、模型回退、计费、审计、异常重试。旧入口不薄，目录中有各层组件不能等同三层贯通。

## 最小composition root的真实用途

不建`createRuntime() => oldRun()`空wrapper。只有以下真实依赖连接被移出业务模块时才创建：

- command ports：任务板read/mutate、steer、abort main/asides、清队列。
- execution ports：runEmbedded/runCli、模型授权/预算强制校验、provider选择与原重试策略、usage/audit。
- delivery ports：候选payload准备、acceptance settlement、消息投递、任务完成/续醒回执。
- context ports：来源builder、placement/budget装配；sources仍按原时序调用。

root接收可信run身份和宿主adapter，返回本次turn所需用例依赖；不自行分流、不启动循环、不解释目标。业务用例调用这些ports，宿主提供实现。无真实移除跨层import就不计wiring完成。root可在原auto-reply协议adapter附近，不要求所有底层实现都搬agent-runtime。

## 必须完成的批次

### F0 关闭当前等价批次、固定可交付范围

保留已有检查点，不再提取一行helper。更新进度矩阵，区分“实现已归属”与“主线已接”。只允许发现失败点修复。状态、配置与生产启用事实继续分开。

### F1 State读写端口与command真实入口

把原task-board read/mutate/constraint/abort绑定集中为一份宿主adapter；原文件仍持有锁与存储实现。command处理返回明确disposition：replied/control-handled/amended/deferred/execute。复用四现成用例及原aside，禁止再实现第二分类器。原Gateway协议认证、去重、sessionFile-before-focus不迁业务层。

必须替换：agent-runner内目前散落的同类port创建；不允许有两个端口工厂各自决定权限。验证控制短路、same-task amend/aside、focus变化/旧请求、一次消费。

### F2 Execution正常回合入口（核心缺口）

从原`runAgentTurnWithFallback`确定完整用例“执行一个已接纳回合”。不是搬1500行就算模块化：先把平台host adapter连接（model admission、billing、audit、provider runner）显式注入，保留原fallback/CLI/embedded重试顺序；原函数成为兼容export或宿主adapter调用新唯一实现。

execution公开入口应被主agent-runner直接消费，不再直导旧agent-runner-execution。recovery保持已有唯一原循环，preparation参数adapter继续复用；不新增外层while。types可先legacy typed request，明确非SDK最终契约，不为去legacy一次改全输入。

退出：原auto-reply模块无独立执行循环实现；授权deny和预算门禁不能变optional；真实runner测试覆盖provider切换、compaction、abort、quota、usage只记一次。

### F3 Delivery完成的真实用例

将agent-runner执行结果后半段从候选结果→空结果/失败表达→已存在acceptance→payload→归属正确的回执→后续续醒拆成一个或少数完整用例。计费/可见notice作为ports保留，避免结果处理隐式重试模型。交付层不负责provider fallback，execution不负责面向UI气泡文本。

必须替换：原runner里重复result/payload/finalize路径，保留错误分支覆盖。投递失败与任务失败分开，任务done和turn final分开；只在原合法时点record completion/schedule continue。

退出：至少正常、empty、abort、error各路径走明确交付出口，而非只普通路径新接口、异常路径旧流程。

### F4 Composition root与入口瘦身

在F1–F3真实ports形成后建wiring。原runReplyAgent保留入口适配/调用序列，业务判断落各所属用例。协议adapter负责typing/lifecycle正确清理，不把cleanup抽成散碎类。get-reply-run仍有context source IO可留adapter，必须标明归属，不能把它称无业务“纯root”。

新增manifest单向边界及公开入口约束，实际测禁止deep import；root不包含rule/分类/重试分支。拆分有实质职责而非追LOC数字。

### F5 Capabilities与policy完整范围

以一个真实tool invocation pipeline为代表梳理注册/开放/执行/回执，建立typed能力元数据契约并适配原pi-tools。保留workspace guard→before-call→abort→inbound ceiling等原序。治理强制点不做可选插件。hooks/transform/Lobster按真实consumer处理保留/限制/迁移/退役；不能以总开关全删或只写清单不处置。

### F6 全链验收和旧路径退场

真实用户链：目标+验收→执行→异步等待→工具查询与普通aside→修改→旧结果→暂停/恢复→交付。检查所有合法渠道与扩展，不只webchat。通过后逐项关闭compat出口，外部使用尚存的标保留期限/owner，而非为了零旧文件破坏SDK。

最终要有替代证明：旧决策实现已删除、deprecated入口只有同函数export、真实调用不再穿私有路径；无数据丢失、取消/授权不能绕过、无新脚本配置。诊断差量归零，基线红灯单列；完整SHA与构建绑定。

## 推荐下一批实施

先F1+F2的接口与调用闭包设计，随后优先F2“执行已接纳回合”，因为目前execution/index只给recovery，准备入口也仍legacy，主线最重要执行节点尚无公开归属。不要继续用formatter或usage小组件代替此工作。

批次可以分绿色提交，但F2验收以主消费者已替换、原实现退场、强制门禁与重试保持为单位，不能以新增文件数宣布完成。

## Current F2 checkpoint supersedes earlier inventory

The original inventory above is historical. The current main reply consumer invokes execution/index.runAdmittedTurn with mandatory grouped host ports; the original outer normal-turn loop now exists only in execution/runner/admitted-turn.ts. The old agent-runner-execution module is a compatibility delegate. See admitted-turn-ownership.md for actual ownership, consumer changes and retained legacy dependencies. F1 command/state, F4 composition root, capability/policy and final whole-chain acceptance remain unfinished; do not infer their completion from this F2 entry checkpoint.
