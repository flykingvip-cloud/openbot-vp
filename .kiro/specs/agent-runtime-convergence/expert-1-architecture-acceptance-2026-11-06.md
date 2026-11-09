# 独立专家1：代码架构验收

结论：部分通过，不能宣告三层架构统一完成。当前已建立真实组件和部分公开入口，仍有职责驻留旧入口及供给契约不完整。未发现本次只读审查可确认的 P0；以下 P1 阻止完整架构验收。

## P1
1. 命令入口仍是业务编排主体。src/commands/agent.ts:379 自组商业 lease，:425–439 创建三类 TaskOutcome，:493 和 :827 决定模型治理，:833 组织 fallback。此前提取 candidate/outcome/ACP 是实际进展，但旧入口仍同时承担指挥、准入、执行编排与结算参数，不满足薄适配入口。应将一致命令场景 orchestration 归执行/command 各权威组件，host 仅注入身份与端口；不是简单整体搬入 runner。
2. 上下文供给未覆盖所有真实模型入口。src/commands/agent.ts:42、:589 直接构建 workspace skill snapshot；src/agents/pi-embedded-runner/run/attempt.ts:70–80、:190–226 仍直接装配 context compiler/system prompt。保留原实现可作迁移适配，但不能宣称统一 context 服务、builder resolve/read/render/audit 已完成。需要列出每个模型入口来源、预算、顺序、暴露与副作用，并证明只经同一供给契约。
3. 能力目录是保守分类投影，不是完整适配契约。src/agent-runtime/capabilities/catalog.ts:22–39 所有能力固定 cancellation=signal_forwarded、completion=tool_result、idempotency=not_declared；Tool/MCP/插件异步作业的实际取消与恢复能力未逐项证明。unknown 副作用保守处理值得保留，但不得将传 signal 等同取消生效。必须各适配器声明并测试真实能力，异步完成/幂等/权限保持原权威。

## P2
4. wiring 仍含数据映射与准入结果处理：src/agent-runtime/wiring/interaction-turn.ts:100–113 决定授权布尔值、组装原子变更及 accepted 结果 acceptance 注入。没有新调度器，但已经超出严格依赖注入。应把事务映射归 command admission 组件，wiring 只绑定 state ports。
5. src/agent-runtime/wiring/reply-turn.ts:14 直接深引 state/interaction-transcript；state/index.ts 未公开该接口。当前公开边界并非全部一致，应审计所有同类深引；合法内部实现依赖不需要强行 SDK 化。

## 已满足证据
- execution/index、delivery/index、state/index 为真实消费者使用，并非纯目录空壳。命令候选、预算、fallback 身份、ACP 执行、outcome 及交付已有独立实现；旧 command delivery 实现已移除。
- capabilities/invocation/before-call.ts:237 使用统一 declareCapability；真实 before-action 边界存在。
- state/index 明确原任务板为唯一存储/锁适配，保留原锁/CAS 不复制第二状态机。
- model 作为共享推理基础有禁止 business-control 依赖的架构规则；新增商业 gate 候选在该层，不引入新任务状态机。

## 验收限制
本次是候选工作树只读代码审查；不以目录名称或现有记录代替运行证据。已启动 architecture manifest，父代理可收取最终结果；未跑真实模型、渠道、重启与协作实机，不据此批准旧执行器删除。最终需稳定同一 SHA、全量边界扫描、上述 P1 闭合及专家2/3闭环/退役验收。
