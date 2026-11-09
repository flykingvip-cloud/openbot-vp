# Runtime 全局边界复核（只读）

范围：专用树当前 `origin/main...HEAD` 52文件、2133新增/474删除；工作区状态为空。核对src/agent-runtime现组件、实际旧消费者、manifest与spec声明；本轮未执行测试/修改代码。

## 结论

**结构方向可接受；没有发现本批新增第二执行循环或同功能双实现的直接证据。不是Runtime整体迁移完成。** 当前是“若干上下文组件＋任务type contracts＋四个command用例＋单个bounded recovery组件”完成等价归属。delivery/state/policy/capabilities/wiring尚未实质迁移，主runner/上下文IO仍原位。

## 已核实

- command/index显式导出4用例及types，无export\*。amend/control/gateway stop无直接runtime实现依赖；task-status→纯context/task-focus→type-only contracts，旧board formatter静态重依赖已解除。
- context共assembly/untrusted/aside-budget/collaboration-mission/task-focus五个组件；原输入adapter与compat出口消费同一实现。shared/normalize-newlines单源。
- contracts/task仅类型，旧board保留runtime和兼容type出口，未复制状态存储。
- bounded recovery在execution/recovery/stall-continuation唯一实现；旧agents/execution-stall-continue-loop仅public facade reexport；attempt消费execution/index。
- 原mid-task-dialogue仅兼容status/strip出口与amend ack呈现；没有继续保留第二status格式实现。
- manifest 19规则：context禁止旧runtime/gateway/IO业务依赖；command禁止task persistence/工具/runner；auto-reply/gateway只能command/index；legacy agents只能execution/index；recovery保留两项显式旧依赖。
- tasks文档多处明确“does NOT complete”“Remaining stages NOT migrated”，无发现将整个Runtime宣称已迁完成。早期checkpoint“context4组件”是历史进度，当前已5，报告时标时点避免混淆。

## 阻塞与风险分级

### 本轮结构验收阻塞

未发现需立即退回的行为/重复实现阻塞；此为静态审阅，不替代owner定向/构建回归。

### 下一迁移前必须解决的决策边界

1. recovery仍导入旧execution-stall-continue（prompts/type）与protocol-violation；已诚实记录，可暂存，**不应**因文件已移动就标全execution独立。
2. command-current-control和gateway-stop是不同协议/时序用例，不可为消除相似abort顺序而合成一个万能控制器。
3. policy/state只记录规范还未接统一目标接口；不要创建空index或把existing board facade包装一遍标完成。
4. contracts/task直接承载完整board types是迁移型接口，不是最终所有层都需依赖的最小DTO；后续用例增加时按需缩小输入，不能本轮大改schema。
5. manifest深导保护覆盖当前flat command/\*.ts；未来增加子目录须同步规则（`command/!(index).ts`不能自然覆盖嵌套）。contracts规则也应随新增capabilities/policy/wiring目录复核，当前不必预建空目录。

## 反碎片化评价

assembly几个一行函数本身价值有限，但有真实两个branch与later append/finalize消费者；之后应停止继续按数组操作拆helper。mission/task-focus是完整只读领域投影，aside-budget是算法组件，合理。四command用例含具体顺序/结果，不是只有转发；其粒度应冻结，避免再把abort/touch/cleanup各变一个component。

有type-only contracts/compat facade和真实use case不是碎片化；无独立职责的wrapper/只为了凑层数的新目录才是。不要把同一种formatter按字段拆文件。

## 下一完整切片建议：执行结果的候选成果与交付前处理边界

优先从`rewrite-visible-reply`和payload入口做一条完整“执行候选结果→验收/呈现→回写/交付”的职责提取，而不是立刻搬attempt或新增prepare facade。

先只读建立结果链：rewriteAttemptVisibleReply中的language、plan-speak pass-through、task-surface receipt、OGUI及settleTurnCompletion；区分原消息/缓冲/转录patch与业务判定。选取一个完整结果用例，保留原执行结束时点，输入message/result/task identity，返回visible text+contract+是否需更新，效果通过显式ports；投递仍原路径。

此切片应先提出契约再批准实现，避免把settlement移入纯presentation后隐藏写文件行为。通用任务交付与本轮turn completion不是同一状态，不可合并。

替代可选：execution preparation完整用例，如“本轮工具集准备”；需保留pi-tools workspace guard→policy过滤→before-call hook→abort wrapper→inbound ceiling顺序，输入身份/权限/AbortSignal，输出可用tools与治理快照。当前依赖大，只有在先完成调用闭包审计后才适合迁移。

## 结果切片验收

真实attempt/normal/aside入口：原文/顺序/副作用次数不变；取消/协议终止不被结果处理解除；partial/block/最终payload一致；A/B不同终局顺序；验收失败不伪报delivered；投递失败不重跑主任务。原消费者替换且旧实现删除/compat同符号，无新循环/模型调用/配置脚本。复用manifest+既有基线tsgo52/build209差量管理，独立可revert。
