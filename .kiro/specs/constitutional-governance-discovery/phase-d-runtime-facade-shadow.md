# Phase D §9.1 Runtime 门面 — 默认关闭的 shadow

书面范围：`phase_d_runtime_facade_shadow_only`（2026-09-25）。这是发现目录下的薄注，不是第五份 Phase A 正文，也不改写 Phase C 的 NO-GO。

## 本切片做什么

在 `@openbot/constitutional-contracts` 增加默认关闭的 Runtime 门面 `runRuntimeFacadeShadow`。它只复用已有的 `evaluateShadowConformance`。

- 调用方显式传入 `shadow: true`，或传入已打开的 `OPENBOT_CONSTITUTIONAL_SHADOW` 快照时，返回只读 shadow 报告。
- 函数不读 `process.env`。未 opt-in 时不调用评估器，不投影源账。
- 编排侧入口：`src/task-orchestration/constitutional-runtime-facade.ts` 的 `observeOrchestrationRuntimeFacade`。它回显冻结的 `ORCHESTRATION_LIVE_INVOKE`，不调用 `considerDispatch`。
- 预检侧入口：`src/agents/execution-preflight/constitutional-runtime-facade.ts` 的 `observePreflightRuntimeFacade`。它只映射调用方已经拿在手里的回执 / trace 子集，不写回执、不写 trace。
- 两个入口都没有挂进 gateway chat、tool invoke、ACP、AOR，也没有从 `dispatch` / `gateway-hook` / 预检 barrel 被 import。

打开之后仍然只报告：`enforce` / `enforced` / `liveInvoke` / `fabricDefaultOn` 为 false，`selectedPath` 为 null，不阻断、不写生产账本。

## 本切片不授权

- P8b：至少一条可被选中并执行的真实合法 Path
- P8c：影子决策与 legacy 对照，以及把它当作收紧门
- Path 涂装；Gate / Path 热路径收紧；enforce 默认开
- `ORCHESTRATION_LIVE_INVOKE` / live invoke = true；Fabric 默认开
- 第五套执行状态机；新的生产日志 / 账本库；跨域写权威
- Profile A/B 合并；Registry 物理并账；回执升成证明；插件安装写成授权
- 改写 Phase C freeze / 决策文档，或宣称 Phase C 为 GO
- §9.2 产品拆分；gateway chat / ACP / AOR 拦截器
- `PROTOCOL_VERSION` 抬升；替换 Pi；Bridge MVP

## 回滚

不要调用这两个 observe 函数。聊天热路径没有 import 它们。删掉 `runtime-facade` 模块以及两个适配文件即回到只有契约草稿与 P8a 报告的状态。`OPENBOT_CONSTITUTIONAL_SHADOW` 本身不能把 enforce、live invoke 或 Fabric 打开。
