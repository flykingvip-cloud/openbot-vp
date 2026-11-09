# Runtime convergence 独立整体代码审阅

审阅者 runtime-mainline-audit；只读，无树修改/提交。范围：专用树 `origin/main...37243a25f08ce78c58f75500a4d91595ee8091e1` 的全部产品变更、架构manifest及测试/文档范围。该结论是源码审阅，不替代owner已执行测试/build/tsgo差量，也不代表生产部署或有效配置全覆盖。

## 结论与severity

**未发现本次patch引入的P0/P1/P2功能阻塞。** 当前差异为契约与完整用例/纯投影提取，原入口、状态存储、权限、回调和核心循环未新增另一实现。可在owner差量验证完成后接受本阶段，不应宣称整runtime迁移完成。

## 核对证据

1. 任务类型：脚本比较origin/main原TaskStop到IncomingTurnResult连续定义与contracts/task.ts，除新说明头外字节完全一致。旧state模块type import/reexport保持消费者兼容，无schema迁移。
2. 原子状态与任务身份：commitSameTaskConstraint、mutateSessionTaskBoard、commitBoardMutation的实现未改；amend用例仍在steer前读taskId一次，persist闭包使用该ID；限制先persist、普通steer后persist、失败与defer顺序保持。
3. 控制：runner控制原条件仍先于status/aside；applyControl先原子提交，abortMain→abortAsides→clearPending依次；touch/cleanup/原文案仍入口。同Gateway异步abort await后owner-only embedded+queue，参数、keys、转录/ack/final位置不变，不强行合并两个适配的合法差异。
4. 异常：纯command用例没有新增catch、retry或吞错；apply/persist/abort异常仍阻断后续副作用。Gateway嵌套await只转接原async调用；无新状态或取消registry。
5. 循环：恢复新文件把两legacy import路径还原后与origin/main原loop全文字节一致。rg生产仅新stall-continuation一处定义，attempt原位置一处调用。旧loop是同函数reexport；ledger claim/send/onContinued/session副作用仍原适配位置。
6. 上下文：get-reply-run保持初始filter、late append与join原语义；builder调用顺序/次数不动；untrusted仍user侧，header/换行/字面escape处理不变；aside budget原算法及常量单源迁移；collaboration mission原resolvedProfile整体优先和字段投影不变；focus formatter字节等价。
7. 依赖：contracts无运行依赖；command经公开index供入口消费，ports为源码依赖而非配置脚本；command不直接import models/tools/board；context不引入源读取。execution/recovery保留显式legacy prompts/protocol checker依赖，不冒充已独立内核。
8. 权威：未改会话板、群shared contract、executor-private todolist之间关系；未新增统一Todo driver；未将回合contract、任务完成与投递成功合一。

## 非阻塞维护债务/已有局限

- `appendSystemContextPart`仅包spread，价值有限；此后应优先迁完整业务组件，不按helper文件数计算架构完成度。
- command仍是原入口固定ports调用，不是新的配置驱动调度中心。禁止把ports开放为动态config callbacks。
- 现有“限制已记录+steer”不等于每个tool前的强制程序屏障；相关既有文案与保护未在本次修正，不应扩大安全保证。
- execution仅迁有界stall，模型failover、CLI、压缩、异步恢复、账单与growth仍混在原执行适配，后续按契约逐项拆。
- 显式deny manifest能约束当前已知依赖，但不等于禁止全部未来IO（例如node:fs）；应按后续组件职责追加规则，而非宣称静态规则证明纯度。

## 覆盖边界

未重新运行完整测试或模型实机；未验证生产开关/扩展启用；未独立测试plugins/hooks/外部workflow；未覆盖所有渠道/协作回执及跨重启外部作业。既有tsgo/format红与媒体两失败由owner基线差量报告归因，本审阅不为其无条件背书。上线仍需fresh main、构建差量、原停止及A/B历史隔离回归。
