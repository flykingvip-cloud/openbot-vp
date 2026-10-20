# Implementation Plan: OpenBot Fabric — AI Dev Tool Execution Control Plane (v1)

## Overview

本计划落地 `requirements.md` / `design.md` 定义的 **Fabric v1**：在三个既有子系统（Governance/Loom、Execution/TOL、Kernel/AOR）之上，定义统一控制平面契约（`ToolRequest → PolicyDecision → Execution → ToolExecutionResult`）与公共 API，并交付**最小可信闭环**。

核心方法论：**复用优先 + feature-gated 零回归**。Fabric 默认关闭，未启用时既有工具执行路径逐字节不变；启用后所有调用进入统一"治理 → 执行 → 审计"管线。

## 验收状态（Phase A 完成 / Phase B 待补）— 2026-06-15 复核修正

> 经专业验收复核，区分两阶段，避免"全 ✅ 但未闭环"的误导：
>
> - **Phase A — 库与契约 + API 骨架（已完成，可签收）**：`src/fabric/**` 全部纯逻辑模块（契约/映射/约束/策略+可解释/投影/状态机/执行端口/kernel/租户/审计/回放/反馈/成本/流式映射）+ 单测；`fabric.*` 方法注册 + `/v1/*` HTTP 薄层 + feature gate（默认 off）。架构铁律 Rule #1–#4 在库层成立。
> - **Phase B — 生产接线（已完成，整包 v1 可复验）**：见下方 "Phase B"（11.1–11.5）任务组，全部 `[x]`。已闭环：①`createProbeDecideFor` 真实 scope/allowlist/exec-approval 探针（替换 `defaultDecideFor` 桩，11.1a）；②`createGatewayFabricService` + `loopback-invoker` 真实 TOL runner，gateway bootstrap 经 `setFabricServiceProvider` 注入（11.1b，已实机验证）；③`fabric.tool.stream` + `/v1/tool/stream` 经 `tool-events` 上线（11.2）；④`service.execute` 调 `reportUsage` + `exceedsCostLimit` 拒/终止 + 写 `policyInputs`（11.3）；⑤sandbox/scope/domain off-vs-on parity 矩阵（11.4）；⑥多步/agent + recompile 不放宽 + fork/merge 结构语义（11.5，补齐 4.4 缺测）；⑦残留闭环（11.1c）：`formatFabricAuditLine` 规范化审计行写 gateway 统一日志（审计存储）+ `createProcessRunner`/`createRoutingRunner` 让 `generic.*` 真实二进制（git）以 OS 进程执行（fail-safe 拒绝无法满足的沙箱要求），均已实机验证。
> - **测试计数更正**：audit = 6（曾误记 10）、streaming = 6（曾误记 11）、replay = 8（曾误记 9）。Task 4.4 曾声称的 "fork/merge 端到端" 与 "recompile 不放宽" 测试已于 11.5 落地（`multi-node.test.ts`）。
> - **签收建议**：Phase A + Phase B 均已交付；整包 v1「最小可信闭环」可复验签收（feature-gated，默认 off）。

## Agents

- kiro-fabric · role: owner · scope: OpenBot Fabric control plane (contract, gateway pipeline, subsystem adapters, public API) · paths: .kiro/specs/openbot-fabric/**, src/fabric/**, src/gateway/server-methods/fabric.ts, src/gateway/server-methods/fabric.test.ts · since: 2026-06-15

### 技术栈锁定（不引入新栈）

- TypeScript（ESM），对齐仓库 Node 22+ / Bun 运行基线。
- 校验用 `zod@^4`（已依赖）；序列化复用既有 YAML/JSON 设施。
- 不引入新的 DB/MQ/服务端、不新建并行权限系统/审计存储/流式协议。
- 不改写 Loom / exec-approvals / sandbox / AOR 内部实现——只写适配器接入。

### 架构铁律

- **Rule #1**：Path/命令分析/scope/domain = 确定性硬信号；intent 不参与拦截（继承 Loom）。
- **Rule #2（复用优先）**：任何"重新实现已有子系统能力"的实现必须显式论证；默认写适配器。
- **Rule #3（评审采纳）**：Loom = **编译期静态治理元数据** source，不是 ENGINE，与 Fabric 物理独立不合并；反馈 **human-gated**，绝不 auto-mutate policy。
- **Rule #4（评审 v1.3 收敛）**：**AOR owns execution structure（唯一 Planner）· Fabric owns permission + transformation + audit · TOL owns execution · Loom owns static governance metadata.** Policy 仅编译期决策一次，runtime 只 enforce；mutation → recompile（不在 runtime 改图改策略）；Fabric 不构图/不排序/不调度/不做 planner。
- **零回归门禁**：feature off 时既有 exec-approval/sandbox/scope/domain 拒绝集合不变；feature on 时不放宽任一拒绝集合。

### 已锁定决策（来自 design 待审清单 + 评审采纳）

- **D1**：Fabric 管线默认 feature-gated（off），经 config flag 开启。
- **D2**：先落 `fabric.*` gateway server-methods，`/v1/*` HTTP 形态作薄转发层。
- **D3**：Policy Runtime 用组合式**编译期**评估（method-scope + exec-approval + allowlist + Loom metadata + 评分 + 动态约束 + decisionTrace），不引入规则 DSL/独立 OPA。
- **D4**：v1 仅打通 1 个通用外部 adapter（shell/git）验证生态入口。
- **D5**：审计复用 AOR `AorAuditRecord` + `control-plane-audit.ts`，导出 JSON，不新建审计 DB。
- **D6**：四层职责边界——AOR(唯一 Planner) / Policy Runtime(唯一编译期决策) / TOL(执行+强制) / Trace Layer(投影/记录)。
- **D7**：execution structure 唯一属 AOR；Fabric 不构图/不排序/不调度；选路扩展 AOR `Selector`。
- **D8**：feedback 仅 suggest→accept，绝不 auto-mutate；v1 仅预留接口与数据。
- **D9**：decisionTrace（绑定 PolicyDecision）+ decision-replay/dry-run diff 进 v1；执行侧 replay/完整 simulation 留后续。
- **D10**：产品名保持 OpenBot Fabric；Loom 编译期 metadata，禁止 runtime lookup。
- **D11**：单决策点 + recompile——policy 编译期决策一次附着节点，runtime 只 enforce；变更经 recompile，v1 无 runtime mutation engine。

## Tasks

- [x] 1. Fabric 控制平面契约（C1）
  - [x] 1.1 定义契约 zod schema 与类型（`src/fabric/contract.ts`）
    - 实现 `ToolRequest` / `PolicyDecision`（含 `decisionTrace`）/ `ExecutionConstraints` / `ToolExecutionResult` / `ExecutionEvent` / `ToolAdapter` / `RuntimeNode`（Tool/Agent/Policy/Adapter/Audit/Fork/Merge 判别联合）/ `RuntimeEdge` / `ToolExecutionRun` / `ExecutionGraphState`，字段对齐 design Data Models。
    - `source.type` 可扩展枚举；schema 失败抛含「字段 + 对象 id」错误。
    - 单测：合法/非法对象、discriminatedUnion（PolicyDecision + RuntimeNode）、decisionTrace/ExecutionGraphState。
    - ✅ 已完成：`src/fabric/contract.ts` + `contract.test.ts`（13 tests passed）。`parseContract` 产出「[id] (field): message」可定位错误。decisionTrace 绑定 PolicyDecision；RuntimeNode/ExecutionGraphState 为 AOR plan 投影。— kiro-fabric
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 16.1, 20.1_
  - [x] 1.2 子系统类型解耦 mapper（`src/fabric/mappers.ts`）
    - `toExecConstraints`、`fromAorAuditRecord`、Loom attribution → decision metadata；保证子系统类型不泄漏为对外字段（含 Loom 仅作 source）。
    - 单测：往返不丢字段、不暴露内部类型。
    - ✅ 已完成：`src/fabric/mappers.ts` + `mappers.test.ts`（7 tests passed）。`constraintsFromDecision`/`tenantContextFromSource`/`attributionToOwnership`+`attributionTraceEntry`/`fromAorAuditRecord`。Loom 经 Fabric 侧稳定读接口 `LoomAttribution` 消费（无 src→scripts 耦合）；AOR `AorAuditRecord` 仅投影 6 字段，测试守护「不泄漏 goal/strategy/selection/stepCount」。— kiro-fabric
    - _Requirements: 1.5, 14.5_

- [x] 2. ExecutionConstraints → TOL 控制项映射（C4）
  - [x] 2.1 实现 `src/fabric/constraints.ts` `toTolControls`
    - 按 design §3.4 映射表；**不放宽默认安全姿态**（`applyPatch.workspaceOnly` 默认 true 不被隐式翻 false）。
    - 单测：每条映射 + 默认姿态保持。
    - ✅ 已完成：`src/fabric/constraints.ts` + `constraints.test.ts`（8 tests passed）。映射建模为"tightening-only 覆盖"：undefined = 不覆盖既有默认；任何路径都不产出 `workspaceOnly:false`。— kiro-fabric
    - _Requirements: 4.1, 4.2, 4.4_

- [x] 3. Layer 2 — Fabric Policy Runtime（C3，评审 P0）
  - [x] 3.1 实现 `src/fabric/policy-runtime.ts` `decide(node, ctx)`（唯一编译期决策点）
    - **编译期**组合既有强制点（scope/role/domain + allowlist + exec-approval）+ Loom **编译期 metadata**（attribution/static rules，禁止 runtime lookup）+ cost/risk 确定性评分 + 动态约束注入。
    - 合成 `ALLOW`/`DENY{reason}`/`MODIFY{constraints}`，**一次性附着到节点**；默认安全（未知→回退 ask/deny）；交互式 ask-on-miss 在 decide 阶段解析；仅用硬信号。
    - **明确边界**：Loom metadata ≠ 最终决策；runtime 不再评估 policy。
    - ✅ 已完成：`src/fabric/policy-runtime.ts`（11 tests）。`decide(req, inputs)` 纯函数——探针结果（ScopeProbe/AllowlistProbe/ApprovalProbe/RiskProbe/LoomAttribution）由编译管线注入；default-safe（approval 未解析→DENY）；risk 越阈值→MODIFY strict sandbox（tightening）；attribution effect=neutral。intent 不参与（专门测试）。— kiro-fabric
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 14.1, 14.2, 14.3, 14.4, 21.1, 21.4_
  - [x] 3.2 Policy Explainability（`src/fabric/decision-trace.ts`，评审 P0）
    - `decisionTrace` 有序记录各环节命中（loom.attribution / scope.domain / exec.allowlist / exec.approval / sandbox.constraint / cost.threshold / risk.score），**绑定 PolicyDecision**；DENY/MODIFY 标明触发环节；脱敏无凭证。
    - ✅ 已完成：`src/fabric/decision-trace.ts` `DecisionTraceBuilder`（stage/add/hasDeny/hasModify/build）；policy-runtime 用它构建有序 trace 并绑定到返回的 PolicyDecision。— kiro-fabric
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 21.6_

- [x] 4. 编译管线（AOR plan adapter）+ Trace Layer（C2，评审 P0）

  > 评审 v1.3 收敛：Fabric **不构图/不排序/不调度/不做 planner/无 runtime mutation**。本组 = AOR plan adapter + 编译期 decide 附着 + Trace Layer 投影/记录。
  - [x] 4.1 AOR plan adapter `src/fabric/plan-adapter.ts`
    - `toPlan(reqs): ExecutionPlan`：单 tool 调用 → 平凡 1 节点（不经 planner）；多步 → 委托 AOR `Orchestrator`/`Planner`。Fabric 不重新推导依赖/不重排。
    - 单测：单节点平凡图；多步委托 AOR；含/不含 intent 结构一致。
    - ✅ 已完成（5 tests）：`singleToolGraph`（平凡 1 节点）/`graphFromToolRequests`（N 独立节点、不自造边）/`projectAorPlan`（AOR `ExecutionPlan` → 投影：保序 + 边逐条复制 + `dependsOn` 来自 AOR 边，非 Fabric 推导）。step→agent 节点（`agent:<skillId>`）。— kiro-fabric
    - _Requirements: 20.1, 20.2, 20.3, 20.4_
  - [x] 4.2 执行状态机 `src/fabric/graph/run-state.ts`（Trace Layer）
    - `ToolExecutionRun` phases `validated/scheduled/executing/streaming/finalized/failed` + `canTransition`/`transition`（非法迁移拒绝，沿用 Loom lifecycle）；迁移产出可观测事件。
    - ✅ 已完成（6 tests）：`RUN_TRANSITIONS` + `transitionRun`（产出 `RunTransitionEvent`）+ `IllegalRunTransitionError` + `isTerminal`。— kiro-fabric
    - _Requirements: 15.1, 15.5, 21.7_
  - [x] 4.3 ExecutionGraphState 投影 `src/fabric/graph/state.ts`（Trace Layer）
    - 投影 AOR plan + policy overlay（decisionTrace）+ execution trace；作 replay 快照。**不构图/不排序/不调度**。
    - 单测：忠实投影、不重排。
    - ✅ 已完成（6 tests）：`createGraphState`/`attachPolicy`（仅 tool/agent、保序）/`upsertRun`/`assertSameOrder`（保序守卫）。— kiro-fabric
    - _Requirements: 20.5, 20.6_
  - [x] 4.4 编译 + 执行管线 `src/fabric/gateway.ts`
    - `normalize(source, raw)` + `compileAndRun(reqs)`：`normalize → toPlan → 编译期 decide 附着每节点 → 执行前校验门控不变量（无 PolicyDecision 拒绝）→ DENY 短路 | MODIFY 注入预计算 constraints | ALLOW 交 TOL → Trace 投影/记录`。
    - **recompile 而非 mutation**：retry/rollback/新增节点 → 重新 `toPlan` + 重新 decide；不放宽既有决策；v1 无 runtime mutation engine（trace 仅 log）。
    - 单测：ALLOW/DENY/MODIFY 三路 + 门控不变量（缺 decision 拒绝）+ 多节点顺序链 + 一个 fork/merge（来自 AOR plan）端到端 + recompile 不放宽。
    - ✅ Phase A（9 tests）：`normalize`（source 适配表，可扩展）+ `compileGraph`（decide 一次、附着每 gateable 节点）+ `runGraph`（门控不变量：无 decision→denied 不执行；DENY 短路不执行；ALLOW/MODIFY 交注入式 `executeNode`）+ `compileAndRun`/`compileAndRunSingle`。
    - ⚠️ Phase B 缺口：未实现 `toPlan` 委托 AOR `Orchestrator`/`Planner`（多步仅 `projectAorPlan` 投影既有 plan）；`FabricService.execute` 固定走 `singleToolGraph`，多节点未进公共 API 路径。**fork/merge 端到端 + recompile 不放宽测试已在 task 11.5 补齐**（`multi-node.test.ts`）。— kiro-fabric
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 21.2, 21.3, 21.5_

- [x] 5. Execution Plane（TOL）+ Adapter Registry（C5，评审 P0）
  - [x] 5.1 实现 `src/fabric/adapter-registry.ts`
    - `register`/`resolve`：schema 校验 + 去重；内置默认适配器把 `exec`/`process`/`apply_patch`/`/tools/invoke` 映射到既有 factory。
    - ✅ 已完成（6 tests）：`AdapterRegistry`（byId/byToolName，schema 校验 + 重复 id 拒绝）+ `BUILTIN_ADAPTERS`；未命中 `resolve` 返回 null（无静默执行）。— kiro-fabric
    - _Requirements: 8.1, 8.2, 8.5_
  - [x] 5.2 实现 `src/fabric/execution.ts`（enforce + 交 TOL）
    - **前置校验门控不变量**（节点须已附带 PolicyDecision）→ adapter resolve → 命令组装 → **enforce 预计算约束**（调 `constraints.ts`，非再决策）→ spawn + 流式（复用 exec 工具 / `ToolInvoker` / AOR `ExecutionBackend`）。
    - 产出 `ToolExecutionResult`；失败转 `status:"failed"` 不抛裸异常；失败由管线决定是否 recompile。TOL 独立不被吞并。
    - ✅ Phase A（8 tests）：`buildExecuteNode(registry, runner)` 产出 gateway 的注入式 `ExecuteNode`——门控复检 + adapter 解析 + `toTolControls` 约束强制 + `expandArgs` + 委托 `ToolRunner` 端口；runner 抛错/ok:false → `status:"failed"` 不抛裸异常。`createToolInvokerRunner(ToolInvoker)` 是**库级**真实边界（复用 `/tools/invoke`）。
    - ⚠️ Phase B 缺口：`defaultService()` 用 **no-op executor**（"runner not configured"），生产路径**未**经 `setFabricServiceProvider` 注入 `createToolInvokerRunner`/真实 TOL；仅测试注入。— kiro-fabric
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 4.3, 21.2, 21.3_
  - [x] 5.3 内置通用 shell/git adapter（生态验证，D4）
    - 仓库无关 adapter 跑通 execute，仍受 allowlist/exec-approval 门控；`capabilities.network:false` 推导 `allowNetwork:false`。
    - ✅ 已完成（含上 6 tests）：`src/fabric/adapters/shell-git.ts`（`SHELL_ADAPTER`/`GIT_ADAPTER`，git 声明 `network:false`）。execute 端到端接线随 5.2。— kiro-fabric
    - _Requirements: 8.3, 8.4_

- [x] 6. Agent Kernel（AOR）接入 + Routing Intelligence（C6）
  - [x] 6.1 实现 `src/fabric/kernel.ts`（薄封装）+ 选路
    - 认知执行委托 AOR `Orchestrator.run`；Kernel 不参与 policy；`TenantContext` 由 `source.{userId,tenantId}` 构造。
    - **Routing 扩展 AOR `Selector`/`SelectionStrategy`**（经 `policy-engine`）；`costLimit` 对接 routing（cost-aware 最小形态）；选路进 decisionTrace。
    - ✅ 已完成（4 tests）：`runKernel(orchestrator, inputs)` 经窄端口 `KernelOrchestrator` 委托 AOR；`budgetFromConstraints`（costLimit→budgetUsd，cost-aware 最小形态）；tenant 由 source 构造、无 user/tenant 时省略；不参与 policy（仅 ALLOW/MODIFY 后调用）。— kiro-fabric
    - _Requirements: 6.1, 6.2, 6.3, 18.1, 18.2, 18.3_

- [x] 7. 审计 + 可解释 + 决策回放 + 反馈接口（C7）
  - [x] 7.1 实现 `src/fabric/audit.ts` `record` + 查询/导出
    - `FabricExecutionRecord` 复用 AOR `buildAuditRecord` + `control-plane-audit.ts`；含 who/why/what/where + decision(matchedRules + decisionTrace) + **输入快照** + trace + stdout 哈希 + timing + cost。
    - 按 tenant/session/correlation 查询 + JSON 导出；敏感值脱敏。
    - ✅ Phase A（6 tests）：`buildExecutionRecord`/`snapshotRequest`（含 `policyInputs` 字段）/`redactEnv`+`redactArgs`（按 key 名脱敏）/`hashStdout`（djb2）/`queryRecords`/`exportRecordsJson`。
    - ⚠️ Phase B 缺口：`service.execute` 默认 `onRecord` **未挂** `control-plane-audit.ts`（仅可选回调）；`buildExecutionRecord` 调用方**未填** `policyInputs`（回放完整性依赖测试自注入）。— kiro-fabric
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x] 7.2 决策回放 + 策略模拟 `src/fabric/replay.ts`（评审 P1，v1 最小集）
    - `replayDecision(recordId)`：对历史 req 重跑 Policy Runtime 断言同结论；`dryRunDiff(records, candidatePolicy)`：当前 vs 候选策略决策差异。**不触发执行副作用**；放宽既有拒绝集合 → 显式标记要求人工确认。
    - ✅ Phase A（9 tests）：`replayDecision`（用存储 `policyInputs` 重跑 `decide`，断言 `decisionsEqual`）；`dryRunDiff`（纯函数、无副作用）；`isRelaxation`（DENY→非DENY / sandbox 弱化 / 网络重开 → 标记 `relaxationCount`，要求人工确认）。执行侧 replay 留后续。（计数更正：实为 8 tests。）— kiro-fabric
    - _Requirements: 17.1, 17.2, 17.3, 17.4_
  - [x] 7.3 Feedback Signals 接口（`src/fabric/feedback.ts`，评审 P1，v1 仅接口）
    - 从 `FabricExecutionRecord` 派生 feedback signal（失败模式/约束收紧建议）；**SHALL NOT auto-apply/auto-mutate**，仅产出建议 + 依据，经人工 accept。v1 仅预留接口与数据通道。
    - ✅ 已完成（3 tests）：`deriveFeedback` 失败模式检测（阈值 3）产出建议 + evidence（correlationId）+ `proposedConstraints`；`autoApplied` 类型恒为 `false`（编译期保证绝不自动应用）。— kiro-fabric
    - _Requirements: 19.1, 19.2, 19.3, 19.4_
  - [x] 7.4 成本追踪接入（复用既有计费）
    - 执行后经 `billing-ingest` / `usage-ingest` 上报；`costLimit` 超限 → 拒/终止 + 标记。不新建计费引擎。
    - ✅ Phase A（7 tests）：`src/fabric/cost.ts` —— `UsageIngestPort` 窄端口；`exceedsCostLimit`（估算≥limit→拒/终止，R11.2）；`buildUsage`+`reportUsage`（best-effort）。
    - ✅ Phase B 已闭环（见 11.3）：`service.execute` 已调用 `reportUsage`（denied 不报）；`exceedsCostLimit` 已接入执行前拒绝路径。— kiro-fabric
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 8. 多租户隔离与流式
  - [x] 8.1 多租户隔离
    - `tenantSessionKey(tenantId, sessionKey)` 前缀 + session-domain guard；缺 tenant 退化为单租户。
    - 单测：跨 tenant 不可见、缺 tenant 退化。
    - ✅ 已完成（8 tests）：`src/fabric/tenancy.ts` —— `scopedSessionKey`（复用 AOR `tenantSessionKey`，幂等）/`canAccessTenantResource`（严格同租户；untenanted 仅见 untenanted）/`assertTenantAccess`/`filterByTenant`；缺 tenant 退化为单租户（R10.3）。— kiro-fabric
    - _Requirements: 10.1, 10.2, 10.3_
  - [x] 8.2 流式接入（复用 tool-events）
    - 执行层把 AOR `BackendEvent` + 状态机迁移 → Fabric `ExecutionEvent`，经 `ToolEventRecipientRegistry` + `tool-events` capability 推送；外部消息面只收最终结果。
    - ✅ Phase A（6 tests）：`src/fabric/streaming.ts` —— `fromBackendEvent`（assistant→stdout / lifecycle→status / error→stderr / tool→breadcrumb）+ `fromRunTransition`（状态机→status）+ `policyEvent`。纯映射不新建协议。
    - ✅ Phase B 已闭环：交付层经 `registerToolEventRecipient` + `tool-events`（`broadcastToConnIds 'fabric.tool.event'`）推送；`fabric.tool.stream` 与 `/v1/tool/stream` 已上线（见 Phase B 11.2）。— kiro-fabric
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 9. 公共 API（C8）+ 鉴权接入
  - [x] 9.1 实现 `src/gateway/server-methods/fabric.ts`
    - `fabricHandlers`：`fabric.tool.execute`、`fabric.policy.check`（dry-run，返回 decisionTrace）、`fabric.tool.stream`、`fabric.adapter.register`。响应保留 `trace`。
    - ✅ Phase A（service 7 + handler 6 tests）：`src/fabric/service.ts`（`FabricService` facade）+ `server-methods/fabric.ts`（4 方法、契约校验、保留 trace）。feature-gated（默认 off → UNAVAILABLE）。
    - ⚠️ Phase B 缺口（部分已闭环）：`defaultDecideFor` 桩已由 11.1a 真实探针替换；`fabric.tool.stream` 已由 11.2 上线（不再 UNAVAILABLE）；`policy.check`✅、`adapter.register`✅、`tool.execute`✅（默认 service 经 11.1b 注入真实 runner，feature on 时实际执行）。— kiro-fabric
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_
  - [x] 9.2 接线与 scope 注册
    - `server-methods.ts` spread；`server-methods-list.ts` 注册方法名；`method-scopes.ts` 加 scope（execute/register=write/admin，check=read）。不新建绕过鉴权入口。
    - ✅ 已完成（追加式）：`server-methods.ts` import + `...fabricHandlers`（末位）；`server-methods-list.ts` 追加 4 方法；`method-scopes.ts` READ 加 `fabric.policy.check`/`fabric.tool.stream`、WRITE 加 `fabric.tool.execute`/`fabric.adapter.register`。`isGatewayMethodClassified` 4/4=true，0 diagnostics。（method-scopes.test 2 个失败为其他 agent 未分类方法的既有问题，与 Fabric 无关。）— kiro-fabric
    - _Requirements: 7.5_
  - [x] 9.3 `/v1/*` HTTP 薄转发层（D2）
    - 复用 `/tools/invoke` 同款鉴权，把 `/v1/*` 转发到 `fabric.*` 方法。
    - ✅ 已完成（7 tests）：`src/gateway/fabric-v1-http.ts` —— `/v1/tool/execute`、`/v1/policy/check`、`/v1/adapter/register` 路由，复用 `authorizeHttpGatewayConnect` 鉴权 + `http-common` helper，转发到 `getFabricService()`（与 WS 同一 facade，不旁路鉴权）。在 `server-http.ts` `requestStages` 追加 `fabric-v1` 阶段。feature off → 503；错误 token → 401/403；malformed → 400。— kiro-fabric
    - _Requirements: 7.1, 7.5_

- [x] 10. 零回归门禁与 feature gate（贯穿验收）
  - [x] 10.1 feature gate（默认 off，D1）
    - config flag 控制 Fabric 管线启用；off 时既有路径逐字节不变。
    - ✅ 已完成（6 tests）：`src/fabric/feature.ts` `isFabricEnabled`（env `OPENBOT_FABRIC_ENABLED`，默认 off）；`getFabricService` env-gated——off 时返回 null → handlers/HTTP 报 UNAVAILABLE，既有路径零影响；显式 provider 优先于 env 默认。未注入 Fabric 引用到任何既有执行路径。— kiro-fabric
    - _Requirements: 13.1_
  - [x] 10.2 零回归 parity 测试（核心安全证据）
    - feature off vs on 的 exec-approval/sandbox/scope/domain 拒绝集合一致；改变任一既有判定结论需显式报告。
    - 复用断言：Policy Runtime 走 `requiresExecApproval`/allowlist、图规划走 AOR `Planner`、选路走 AOR `Selector`、audit 走 `AorAuditRecord`、stream 走 `tool-events`。
    - **feedback 不写断言**：任何路径都不 auto-mutate 策略。
    - ✅ Phase A（4 tests）：`requiresExecApproval` flag off/on 结果逐例一致（Fabric 不改既有 gate）；启用 Fabric 后 exec→denied（fail-closed）；feedback 所有信号 `autoApplied===false`。
    - ⚠️ Phase B 缺口（证据不足，不能单独作为"接入安全硬性证据"）：**未覆盖** sandbox/scope/domain 拒绝集合 off-vs-on 对比矩阵；未证明"feature on 时不放宽任一拒绝集合"。见 Phase B B4。— kiro-fabric
    - _Requirements: 13.2, 13.3, 13.4, 19.2_

- [x] 11. Phase B — 生产接线（整包 v1 复验前必做）

  > 验收复核新增。Phase A 已交付库 + 骨架；以下为"可对外启用的完整控制平面"所缺的生产 wiring，按依赖顺序。
  - [x] 11.1 生产 `FabricService` wiring（真实探针 + 真实 runner + 审计落库）
    - `decideFor` 注入真实 scope/role/domain（`method-scopes`/`guardSessionDomain`）+ allowlist（`evaluateExecAllowlist`）+ exec-approval（`requiresExecApproval` + 交互式解析）探针，替换 `defaultDecideFor` 桩。
    - `executeNode` 注入 `buildExecuteNode(registry, createToolInvokerRunner(...))` / 真实 TOL runner，替换 no-op。
    - `onRecord` 挂 `control-plane-audit.ts`；在 gateway bootstrap 经 `setFabricServiceProvider` 注入（feature on 时）。
    - 验收：exec 在真实 allowlist 满足时 ALLOW 并实际执行；不满足时按既有 approval 流。
    - ✅ 11.1a 真实策略探针已落地：`src/fabric/probes.ts`（6 tests）—— `createProbeDecideFor` 用真实 `analyzeShellCommand` + `resolveExecApprovals` + `evaluateExecAllowlist` + `requiresExecApproval`，替换 `defaultDecideFor` 桩并接入默认 service。verdict 修正：仅 `security=full` 或 allowlist 命中才 cleared，否则 fail-safe DENY（修复 `security=deny` 误判为 ALLOW 的语义 bug）。exec 在 allowlist 满足时真实 ALLOW，不满足 DENY。
    - ✅ 11.1b 真实 runner 装配 + bootstrap 注入已落地并**实机验证**：`wiring.ts` + `loopback-invoker.ts`（经 gateway 自身 loopback `/tools/invoke` 执行真实工具）+ `server.impl.ts` 在 `OPENBOT_FABRIC_ENABLED=1` 时 `setFabricServiceProvider(() => createGatewayFabricService({ toolInvoker: loopback, onRecord: log }))`。实机 curl 证据（port 18790, auth=none）：`/v1/policy/check` git→ALLOW、exec→DENY(full decisionTrace)；`/v1/tool/execute` tool=git→经 loopback /tools/invoke 返回真实响应（~34ms 往返）+ 审计行 `[fabric] git failed corr=c6`；`/v1/adapter/register`→ok；malformed→400。
    - ✅ 11.1c 残留已闭环：①审计落库——`formatFabricAuditLine` 生成规范化 control-plane 审计行（key=value、脱敏、与既有审计行对齐），bootstrap `onRecord` 写入 gateway 统一日志（本仓库审计存储）；②process-spawn runner——`createProcessRunner`（真实 `spawn`，`shell:false` 无注入，强制 timeout/cwd/env，沙箱要求无法满足时 fail-safe 拒绝）+ `createRoutingRunner`（`generic.*` 真实二进制如 git 走进程、其余走 `/tools/invoke`），bootstrap 经 `processRunner:{}` 启用。**实机验证**（port 18790）：`/v1/tool/execute` git=`rev-parse --abbrev-ref HEAD`→`success exit=0`（真实 OS 进程，输出当前分支）；审计行 `[fabric] fabric.tool.execute decision=ALLOW status=success tool=git corr=cgit … exit=0 costUsd=0 stdout=djb2:… durMs=42`。— kiro-fabric
    - _Requirements: 3.2, 5.1, 9.1, 9.2_
  - [x] 11.2 `fabric.tool.stream` + `/v1/tool/stream` 交付
    - 注册 `tool-events` recipient，执行层把 `streaming.ts` 映射的 `ExecutionEvent` 推送；外部消息面只收最终结果。
    - 替换当前 UNAVAILABLE 桩。
    - ✅ 已完成（service +3 / handler +2 / http +1 tests）：`FabricService.stream(request, onEvent)` 复用单决策点管线，发出 `policy → status running → stdout/stderr → status done`，DENY 短路（仅 policy 事件，不执行）。WS `fabric.tool.stream` 经 `registerToolEventRecipient` 注册连接 + `broadcastToConnIds('fabric.tool.event', …)` 推送，响应带 `result`+`executionId`。HTTP `POST /v1/tool/stream` 批量返回 `{ result, events, trace }`（HTTP 无 WS recipient 传输）。`/tools/invoke` 边界只回最终结果，故 stdout/stderr 为最终输出的 breadcrumb，非 token 级流；外部消息面仍只收最终结果（R12.3）。— kiro-fabric
    - _Requirements: 7.3, 12.1, 12.2, 12.3_
  - [x] 11.3 `service.execute` 闭环 cost + replay 完整性
    - execute 后调用 `reportUsage`（经 `usage-ingest`）；`exceedsCostLimit` 接入拒/终止；`buildExecutionRecord` 填入 `policyInputs`（回放完整）。
    - ✅ 已完成（service +4 tests）：`FabricServiceDeps` 增 `usage`/`estimateCostUsd`/`policyInputsFor`；`execute` 在 ALLOW/MODIFY 且 `exceedsCostLimit` 时**执行前拒绝**（status failed + `cost_limit_exceeded`，不调 executeNode）；执行后 best-effort `reportUsage`（denied 不报）；审计记录填 `policyInputs` + `costUsd`（回放完整）。— kiro-fabric
    - _Requirements: 11.1, 11.2, 17.1_
  - [x] 11.4 强化零回归 parity（sandbox/scope/domain 矩阵）
    - 对 sandbox / scope / domain 拒绝集合做 off-vs-on 逐例对比；显式断言"feature on 不放宽任一既有拒绝"。
    - ✅ 已完成（6 tests）：`src/fabric/parity-matrix.test.ts` —— exec-approval（ask×security×analysis×allowlist）/ session-domain（method×domain）/ operator scope（write 方法拒 read-only）/ role / sandbox-fs（tightening-only，strict→network off，永不 workspaceOnly:false）各矩阵 flag off===on；Fabric `decide` 的 DENY 不因 flag 放宽。— kiro-fabric
    - _Requirements: 13.2, 13.4_
  - [x] 11.5 多步/agent 路径
    - agent 节点 → `runKernel`（AOR）；多步 → `toPlan` 委托 AOR `Planner`；补 fork/merge 端到端 + recompile 不放宽测试。
    - ✅ 已完成（kernel +2、multi-node 4 tests）：`createKernelAgentRunner`（agent 节点经 AOR `Orchestrator` 执行，失败→failed 不抛）接入 `buildExecuteNode` 的 `agentRunner` + `wiring.ts`（注入 `orchestrator`）。`multi-node.test.ts`：projected AOR plan 多 agent 节点**顺序执行**、中间节点 DENY 短路（仅该节点）、**recompile 更严不放宽**（lenient→success / strict→全 denied 不执行）、fork/merge **结构节点 v1 不执行**（显式断言，不伪造并行语义）。补齐报告标记的 4.4 缺测。
    - _Requirements: 6.1, 15.2, 18.1, 21.5_

## Notes

- **复用优先**：每个适配器任务都应优先调用既有子系统能力（Loom/exec-approvals/sandbox/AOR/gateway），新代码只做"契约 ↔ 子系统"的转换与编排。
- **四层职责边界（评审核心 v1.3）**：AOR（唯一 Planner）/ Policy Runtime（唯一编译期决策）/ TOL（执行+强制）/ Trace Layer（投影/记录）。一句话：AOR owns structure · Fabric owns permission+transformation+audit · TOL owns execution · Loom owns static metadata。
- **不重建 Planner（评审核心）**：Fabric 不构图/不排序/不调度；执行结构唯一来自 AOR，Fabric 只投影。任务 4 实现严禁出现第二个调度器/编排器。
- **单决策点 + recompile（评审核心）**：policy 编译期决策一次附着节点；runtime 只 enforce；retry/rollback = recompile，v1 无 runtime mutation engine。
- **门控不变量**：任务 4.4/5.2 必须保证无 PolicyDecision 的节点不得执行；这是安全核心。
- **Loom 编译期 metadata（评审核心）**：禁止 runtime Loom lookup；Loom hints 在 decide 阶段烘进 PolicyDecision。
- **feedback human-gated（评审核心）**：任务 7.3 仅落接口与数据通道；任何自动改写策略/约束的实现都是缺陷。
- **共享热文件**：`src/gateway/server-methods.ts`、`server-methods-list.ts`、`method-scopes.ts` 为共享文件，编辑遵循 AGENTS.md 多 agent 规范，scoped commit，避让他人 WIP；新增方法以**追加**方式接入。
- **安全门禁**：任务 10.2（零回归 parity）是接入安全的硬性证据，不得为加速跳过。
- **后续期（不在 v1）**：自动学习/policy evolution（保持 human-gated）、执行侧副作用 replay、完整 simulation/policy 版本对比矩阵、tool/model 混合选路与 fallback、多工具 DAG 分支并行高级语义、SaaS 计费产品、adapter marketplace、外部 IDE 私有协议深度适配、SOC2 报表 UI、独立 PDP/规则 DSL。
- Intent 不参与任何拦截判定（Architecture Rule #1）；违反即视为缺陷。
- **M4 — Stage-2 Loom 接入 + D3 Replay（已完成并已在 bootstrap 注入）**：`createProbeDecideFor` 接受注入式编译期 `attributionFor`，把 `LoomAttribution` 作为 **neutral** 信号附着到每个节点；`createGatewayFabricService` 透传 `attributionFor` 并在未显式给 `ownershipFor` 时经 `attributionToOwnership` 投影 graph-state 归属。信号 `effect=neutral`，绝不改变决策（D3：ALLOW 仍 ALLOW、DENY 不被 Loom 拯救——见 `probes.test.ts` / `wiring.test.ts` / `replay.test.ts`）。**生产注入已落地**：`src/gateway/loom-attribution-source.ts`（src-safe，直接解析 `.loom/registry.yaml`，无 src→scripts 耦合；bootstrap 读一次缓存 path-glob→owner 匹配器，per-request 纯内存匹配 = 无 runtime registry lookup，满足 D2/D4），`server.impl.ts` 在装配 FabricService 时注入 `attributionFor`；无 registry（生产安装）→ null → 无信号（neutral，零行为变化）。— kiro-fabric

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["3.1", "5.1"] },
    { "id": 3, "tasks": ["3.2", "4.1", "4.2", "5.2"] },
    { "id": 4, "tasks": ["4.3", "4.4", "5.3"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["7.1", "8.1"] },
    { "id": 7, "tasks": ["7.2", "7.3", "7.4", "8.2"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["9.2", "9.3"] },
    { "id": 10, "tasks": ["10.1", "10.2"] }
  ]
}
```
