# Design Document

> 产品：**OpenBot Fabric** —— AI 开发工具执行控制平面
> 需求：`.kiro/specs/openbot-fabric/requirements.md`
> 关联子系统资产：
>
> - Governance(Loom)：`.loom/registry.yaml`、`scripts/loom/*`、`scripts/worktree-audit.ts`、`scripts/agent-attribution.ts`、`.kiro/specs/loom-workspace-orchestrator/`
> - Execution(TOL)：`src/agents/pi-tools.ts`、`src/agents/openclaw-tools.ts`、`src/infra/exec-approvals.ts`、`src/infra/exec-approvals-allowlist.ts`、`src/agents/tool-fs-policy.ts`、`src/cli/sandbox-cli.ts`
> - Kernel(AOR)：`packages/aor-core/*`、`packages/aor-backend-openbot/*`、`src/gateway/policy-engine/*`
> - API/Stream/Tenant：`src/gateway/server-methods.ts`、`server-methods-list.ts`、`method-scopes.ts`、`src/gateway/server-chat.ts`、`src/gateway/control-plane-audit.ts`

## Overview

### 1.0 定位（Scope Framing）

Fabric **不是重写**，而是**抽象与编排**：在三个已存在的子系统之上，定义一个统一的控制平面契约（`ToolRequest → PolicyDecision → Execution → ToolExecutionResult`）和一组公共 API，让异构来源（Cursor / Kiro / Codex / Windsurf / Claude Code / OpenBot）的工具调用进入同一条"治理 → 执行 → 审计"管线。

交付物 = 一个 **Fabric Core 库**（契约 + 归一化 + 编排管线 + 子系统适配器）+ 一组 **gateway server-methods**（`fabric.*` → `/v1/*` 公共 API 形态）+ 复用既有 TOL/Loom/AOR。**默认 feature-gated**：未启用时既有路径逐字节不变（R13.1）。

### 1.1 核心洞察（为什么可行）

三个子系统的"对外接口"恰好已经是 Fabric 需要的形状，只缺一层统一契约把它们串起来：

| Fabric 概念            | 现成接入点（seam）                                                                  | 文件                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ToolRequest`          | `AnyAgentTool` 调用 / `ToolInvokeRequest`                                           | `pi-tools.ts`、`aor-core/tool-invoker.ts`                              |
| `PolicyDecision`       | method-scope/role/domain guard + `requiresExecApproval` + allowlist 分析            | `method-scopes.ts`、`exec-approvals.ts`、`exec-approvals-allowlist.ts` |
| `ExecutionConstraints` | `ExecHost`/`ExecSecurity`/`ExecAsk` + `ToolFsPolicy.workspaceOnly` + Docker sandbox | `exec-approvals.ts`、`tool-fs-policy.ts`、`sandbox-cli.ts`             |
| `ToolExecutionResult`  | `ToolInvokeResult` / `BackendRunResult`                                             | `aor-core/tool-invoker.ts`、`aor-core/backend.ts`                      |
| `ExecutionEvent`       | `BackendEvent` + `ToolEventRecipientRegistry`                                       | `aor-core/backend.ts`、`server-chat.ts`                                |
| `ToolAdapter`          | `ToolInvoker` + per-tool factory（exec/process/apply_patch）                        | `aor-core/tool-invoker.ts`、`pi-tools.ts`                              |
| audit/attribution      | `AorAuditRecord` + Loom attribution + `control-plane-audit.ts`                      | `aor-core/audit.ts`、`scripts/loom/attribution.ts`                     |
| tenant                 | `TenantContext` + `tenantSessionKey` + session-domain                               | `aor-core/audit.ts`、`guardSessionDomain`                              |

### 1.2 非目标（本期不做）

- 不重写/改动 Loom / exec-approvals / sandbox / AOR 内部实现。
- 不做 SaaS 计费产品、marketplace、SOC2 报表 UI、外部 IDE 私有协议深度适配。
- 不新建并行的权限系统 / 审计存储 / 流式协议（一律复用）。

## Architecture

> **Architecture Rule #1（继承 Loom）**：Path = 确定性 / Intent = 概率性。Governance 拦截**与图结构**只用硬信号。
> **Architecture Rule #2（Fabric 专属）**：复用优先。任何"重新实现已有子系统能力"的设计必须显式论证；默认是写适配器把既有能力接入控制平面契约。
> **Architecture Rule #3（评审采纳）**：Loom 是 **静态治理元数据 source**（编译期），不是 ENGINE，且与 Fabric **物理独立不合并**；反馈 **human-gated**，绝不 auto-mutate policy。
> **Architecture Rule #4（评审 v1.3 收敛 — 唯一编排器 + 单决策点）**：**AOR owns execution structure（唯一 Planner）· Fabric owns permission + transformation + audit · TOL owns execution · Loom owns static governance metadata.** Policy 仅**编译期决策一次**，runtime 只 enforce；mutation → recompile，不在 runtime 改图改策略。

Fabric = **四层职责分离（AOR → Policy Runtime → TOL → Trace Layer）**，Fabric Graph 是投影/记录层而非编排器：

```
┌──────────────────────────────────────────────────────────────────┐
│ AOR (唯一 Planner / execution structure)         packages/aor-core │
│   ExecutionPlan/PlanNode 生成 · Selector 选路                       │
│   单 tool 调用 = 平凡 1 节点（不经 planner）                        │
└───────────────────────────────┬────────────────────────────────────┘
                                 │ execution plan (DAG skeleton)
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ POLICY RUNTIME (Fabric Core) ⭐唯一决策点(compile-time)            │
│   fabric/policy-runtime.ts + fabric/decision-trace.ts               │
│   Loom metadata(编译期)+exec-approval+scope/domain → constraints     │
│   → PolicyDecision(+decisionTrace) 一次性附着到 plan 节点           │
└───────────────────────────────┬────────────────────────────────────┘
                                 │ plan + 预计算 PolicyDecision/constraints
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ EXECUTION RUNTIME (TOL — 独立)  fabric/execution.ts (adapter→TOL)   │
│   纯执行 + enforce 预计算约束（非再决策）                            │
│   → pi-tools / exec-approvals / sandbox-cli / ToolInvoker            │
└───────────────────────────────┬────────────────────────────────────┘
                                 │ result + events
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ TRACE LAYER (Fabric Graph)  执行态投影/记录，非编排  src/fabric/graph│
│   投影 AOR plan + policy overlay + execution trace                  │
│   audit.ts · replay.ts · run-state.ts  →  audit/replay/dryRunDiff   │
│   ❌不构图 ❌不排序 ❌不调度 ❌不做 planner ❌无 runtime mutation     │
└──────────────────────────────────────────────────────────────────┘
   ┊ Cross-cutting: Feedback(human-gated, v1 仅接口)  fabric/feedback.ts
```

数据流：`ToolRequest(s) → AOR plan（或单节点平凡图）→ Policy Runtime.decide（编译期，一次，附着到节点）→ TOL enforce+execute → Trace Layer 投影/记录（audit + replay-snapshot）`。变更 → **recompile**（AOR 重规划 + 重新 decide），非 runtime mutation。

### 3.0 四层职责边界（评审 v1.3 收敛）

| 层  | 名称                          | 职责                                                                                        | 既有资产                                                    | 关键约束                                |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| 1   | AOR（唯一 Planner）           | execution structure：DAG 生成、节点排序、选路                                               | `packages/aor-core`（`Planner`/`ExecutionPlan`/`Selector`） | 唯一编排源；Fabric 不重建               |
| 2   | Policy Runtime（Fabric Core） | **编译期唯一决策**：Loom metadata + exec-approval + scope/domain + 约束修改 + decisionTrace | 组合 `exec-approvals*`、`method-scopes`、Loom（编译期）     | 决策一次；runtime 不再评估              |
| 3   | Execution Runtime（TOL）      | 纯执行 + 强制预计算约束                                                                     | `pi-tools`、`exec-approvals`、`sandbox-cli`、`ToolInvoker`  | 独立；enforce 非 decide                 |
| 4   | Trace Layer（Fabric Graph）   | 投影 AOR plan + policy overlay + execution trace；audit/replay                              | `aor-core/audit`、`control-plane-audit`                     | 不构图/不排序/不调度/无 mutation engine |

> **一句话职责**：AOR owns execution structure · Fabric owns permission + transformation + audit · TOL owns execution · Loom owns static governance metadata.
> **为何不合并 Loom 与 Fabric**：Loom 是已上线、演进中的子系统（M2 cutover 进行中、task 6.3 未完），受其 spec + AGENTS.md 保护；合并会耦合可用系统到未验证系统、破坏 parity 门禁、诱导 intent-to-structure（违反 Rule #1）。Loom 仅**编译期** metadata，禁止 runtime lookup。
> **为何不在 Fabric 重建 Planner**：避免与 AOR 形成双编排（双 truth source、执行顺序不一致、调试成本指数级）。Fabric Graph 仅投影 AOR plan。

### 3.1 接缝一：控制平面契约（R1）

- 新增 `src/fabric/contract.ts`：用 `zod` 定义 `ToolRequest` / `PolicyDecision` / `ExecutionConstraints` / `ToolExecutionResult` / `ExecutionEvent` / `ToolAdapter`（schema 见 Data Models）。
- `source.type` 用可扩展枚举（`z.enum([...]).or(z.string())` 风格或注册表），默认覆盖 6 种来源。
- **解耦原则**：子系统类型经显式 `mapper` 转换（如 `toExecConstraints(decision)`、`fromAorAuditRecord(...)`），不直接暴露内部类型（R1.5）。

### 3.2 接缝二：编译管线（AOR plan adapter）+ Trace Layer（R2、R15、R20、R21）

> **评审 v1.3 收敛**：Fabric **不构图/不排序/不调度/不做 planner/无 runtime mutation**。本接缝 = ①把请求转成 AOR plan（或单节点平凡图）；②编译期对每节点 decide 并附着；③TOL 执行；④Trace Layer 投影/记录。

- **归一化入口** `src/fabric/gateway.ts`：`normalize(source, raw): ToolRequest`（source adapter 表可扩展，R2.5）+ `compileAndRun(reqs): Promise<ToolExecutionResult[]>`。
- **AOR plan adapter** `src/fabric/plan-adapter.ts`：`toPlan(reqs): ExecutionPlan`——单 tool 调用 → 平凡 1 节点（不经 planner，R20.2）；多步/agentic → 委托 AOR `Orchestrator`/`Planner` 产出 `ExecutionPlan`。Fabric **不重新推导依赖/不重排**（R20.1/R20.3）。
- **编译期决策附着**：对 plan 每个可执行节点调用 Policy Runtime `decide`（§3.3），把 `PolicyDecision(+constraints+decisionTrace)` **一次性附着**到节点（R21.1）。交互式 ask-on-miss 审批在此阶段解析（R21.4）。
- **Execution（委托 TOL）**：按 plan 顺序执行；执行前校验节点已附带 `PolicyDecision`，否则拒绝（**门控不变量**，R21.3）；`DENY → 短路`；`MODIFY → 注入预计算 constraints`；`ALLOW → 交 TOL`（§3.5）。runtime **不再 decide**，只 enforce（R21.2）。
- **Trace Layer** `src/fabric/graph/state.ts`、`run-state.ts`：`ExecutionGraphState` 投影 AOR plan + policy overlay + execution trace（`ToolExecutionRun` 状态机），作为 replay 快照（R20.5、R21.7）。**不构图/不排序/不调度**。
- **recompile 而非 mutation**：retry/rollback/新增节点 → 重新 `toPlan` + 重新 decide（R21.5）；v1 不实现 runtime mutation engine；trace 仅 log。重编译不放宽既有决策（R21.6）。
- DENY 短路：构造 `ToolExecutionResult{status:"denied", trace.policyDecisionId, output.stderr: reason}`（R2.3）。

数据流：`normalize → toPlan(AOR/单节点) → 编译期 decide 附着 → TOL enforce+execute → Trace Layer 投影/记录(audit+replay-snapshot)`；变更 → recompile。

### 3.3 接缝三：Policy Runtime（唯一编译期决策点，R3、R14、R21）→ PolicyDecision

> **评审 v1.3 收敛**：policy 是**编译期一次性决策**；Loom 仅**编译期** metadata（禁止 runtime lookup）；runtime 不再评估。

- 新增 `src/fabric/policy-runtime.ts`：`decide(node, ctx): PolicyDecision`，**组合既有强制点 + 评分 + 动态约束**，编译期执行、结果附着到节点，不新建并行权限系统、不引入规则 DSL：
  1. **Loom metadata（编译期）**：用 `attribute(registry, …)`（`scripts/loom/attribution.ts`）按 `context.repoRoot`/`fileScope` 取 owner/agent/task + static rule 命中——**编译期烘进 decisionTrace**，runtime 不再 lookup（R21、Loom compile-time-only）。
  2. **scope/role/domain**：复用 `guardSessionDomain` + `isRoleAuthorizedForMethod` + `authorizeOperatorScopesForMethod`（`method-scopes.ts`）。
  3. **命令分析 + allowlist**：对 `exec`/shell 类调用 `evaluateExecAllowlist`/`evaluateShellAllowlist`（`exec-approvals-allowlist.ts`）。
  4. **exec-approval 门控**：`requiresExecApproval({ask,security,analysisOk,allowlistSatisfied})`（`exec-approvals.ts`）；需审批 → 在 decide 阶段解析（R21.4）。
  5. **cost/risk 评分（R14.4）**：确定性评分（v1；learning 留后续），进入 decisionTrace。
  6. **动态约束（R14.3）**：依上下文计算 `ExecutionConstraints`（如高风险来源 → `sandboxMode:"strict"`），产出 `MODIFY`。
- 决策合成：拒 → `DENY{reason, matchedRules, decisionTrace}`；收紧 → `MODIFY{constraints, decisionTrace}`；通过 → `ALLOW{decisionTrace}`（R3.3、R16）。`decisionTrace` 绑定 `PolicyDecision`（R21.6）。
- 默认安全：未知 → 回退 ask/deny（R3.5）。仅用硬信号（R3.6）。
- **边界（R14.5）**：Loom 类型经 mapper 转换进 decision metadata，不直接作为对外 PolicyDecision 字段。

### 3.4 接缝四：ExecutionConstraints 映射（R4）

- 新增 `src/fabric/constraints.ts`：`toTolControls(c: ExecutionConstraints): TolControls`，把抽象约束映射到既有 TOL 控制项：

  | ExecutionConstraints          | TOL 控制项                                                           | 来源                                   |
  | ----------------------------- | -------------------------------------------------------------------- | -------------------------------------- |
  | `sandboxMode: "none"`         | `ExecHost: gateway/node`，无 Docker                                  | `exec-approvals.ts`                    |
  | `sandboxMode: "restricted"`   | Docker sandbox `workspaceAccess: "ro"`                               | `sandbox-cli.ts`                       |
  | `sandboxMode: "strict"`       | Docker sandbox + 网络禁用 + `workspaceOnly`                          | `sandbox-cli.ts` + `tool-fs-policy.ts` |
  | `allowedPaths`/`blockedPaths` | `ToolFsPolicy`（`createToolFsPolicy({workspaceOnly})`）+ fs 边界校验 | `tool-fs-policy.ts`                    |
  | `allowNetwork: false`         | sandbox 网络禁用 / `ExecSecurity` 收紧                               | `sandbox-cli.ts`                       |
  | `timeoutMs`                   | exec/process 工具超时参数                                            | `pi-tools.ts`                          |
  | `costLimit`                   | AOR `TaskConstraints.budgetUsd`                                      | `aor-core/types.ts`                    |

- **不放宽默认**：`applyPatch.workspaceOnly` 默认 true 等安全姿态在映射中保持（R4.4）。违规 → 终止 + 标记（R4.3）。

### 3.5 接缝五：Execution Plane（TOL）+ 状态机 + Adapter Registry（R5、R8、R15）

> 本接缝是 **Execution Plane**：被编译管线调用、把已附带 PolicyDecision 的节点交 TOL 实际执行；只 **enforce** 预计算约束，不再 decide。`run-state.ts` 属 Trace Layer（§3.2），记录执行态。TOL 独立不被吞并。

- 新增 `src/fabric/adapter-registry.ts`：`register(adapter: ToolAdapter)` / `resolve(toolName): ToolAdapter | null`，schema 校验 + 去重 id。内置默认适配器：把 `exec`/`process`/`apply_patch`/`/tools/invoke` 工具名映射到既有 factory。
- 新增 `src/fabric/graph/run-state.ts`（Trace Layer）：`ToolExecutionRun` 状态机，phases `validated/scheduled/executing/streaming/finalized/failed`，`canTransition`/`transition` 校验非法迁移（沿用 Loom lifecycle 模式）；每次迁移产出可观测事件进入审计/流式（R15.1、R15.5）。
- 新增 `src/fabric/execution.ts`（Execution Plane 适配 TOL）：`run(node, constraints, adapter): Promise<{result, events}>`：
  - **前置校验门控不变量**：节点须已附带编译期 `PolicyDecision`，否则拒绝（R21.3）。
  - adapter resolve → 组装命令（`execute.command` + `argsTemplate` 插值 `input.args`）。
  - **enforce 预计算约束**（调 `constraints.ts`，非再决策，R21.2）。
  - spawn + 流式（复用既有 exec 工具 / `ToolInvoker` / AOR `ExecutionBackend.run+stream+wait`）。
  - 产出 `ToolExecutionResult`（R5.4）；失败转 `status:"failed"` 不抛裸异常（R5.5）。失败 → 由编译管线决定是否 **recompile**（retry/rollback），execution.ts 本身不改图。
- **生态验证**：内置一个通用 `shell`/`git` adapter（仓库无关），经 allowlist/exec-approval 门控（R8.4/R8.5）。
- adapter `capabilities.network:false` → 推导 `allowNetwork:false`（R8.3）。

### 3.6 接缝六：Agent Kernel（AOR）接入 + Routing Intelligence（R6、R18）

- 新增 `src/fabric/kernel.ts`（薄封装）：当 `ToolRequest` 需要认知执行（LLM/orchestration）时，委托 AOR `Orchestrator.run(task, {tenant, runId, strategy})`。
- Kernel **不参与 policy**（R6.2）：policy 已在 Policy Runtime 裁决；kernel 仅在 ALLOW/MODIFY 后执行。
- `TenantContext` 由 `ToolRequest.source.{userId,tenantId}` 构造（R6.3）。
- **Routing Intelligence（R18）扩展 AOR，不另建**：选路用 AOR `Selector` + `SelectionStrategy`（经 `policy-engine`）。v1 把 `ExecutionConstraints.costLimit` 对接 routing（cost-aware 最小形态）；tool/model 混合选路、fallback tools 留 v1.x。选路决策进 decisionTrace（R18.3）。

### 3.7 接缝七：审计 + 可解释 + 可回放（R9、R16、R17）

- 新增 `src/fabric/decision-trace.ts`：`decisionTrace` 结构——有序记录各评估环节命中（`loom.attribution` / `exec.allowlist match` / `exec-approval trigger` / `sandbox constraint hit` / `cost threshold check`），随 `PolicyDecision` 携带（R16.1/R16.2），可经 `/v1/policy/check` 返回（R16.3）。脱敏，不含凭证（R16.4）。
- 新增 `src/fabric/audit.ts`：`record(req, decision, result): FabricExecutionRecord`，复用 `buildAuditRecord`（AOR）+ `control-plane-audit.ts`。
- `FabricExecutionRecord` = `ToolRequest` 输入快照 + `PolicyDecision`（含 matchedRules + decisionTrace）+ trace + stdout 哈希/摘要 + timing + cost；不可变、可按 tenant/session/correlation 查询、可导 JSON（R9.4）。
- **决策可回放（R17.1）**：记录保留足以重跑 Policy Runtime 的输入快照（req + 当时上下文摘要 + registry 版本引用）。
- 新增 `src/fabric/replay.ts`：`replayDecision(recordId)`（对历史 req 重跑 `decide`，断言同结论）+ `dryRunDiff(records, candidatePolicy)`（policy 模拟：当前 vs 候选策略的决策差异，R17.2）。**不触发执行副作用**（R17.3）；候选放宽既有拒绝集合 → 显式标记要求人工确认（R17.4）。
- 脱敏：env/args 敏感值按 key 名引用（R9.5）。

### 3.7b 接缝七补：Feedback Signals（R19，v1 仅接口）

- 新增 `src/fabric/feedback.ts`（v1 接口 + 数据通道，不实现自动学习）：从 `FabricExecutionRecord` 派生 feedback signal（失败模式、约束收紧建议、cross-tool 关联）。
- **强约束（评审核心修订）**：`feedback` SHALL NOT auto-apply / auto-mutate 策略或约束；仅产出**建议** + 依据（关联记录/decisionTrace），经人工 accept 才生效（继承 Loom `suggest→accept`，R19.2/R19.3）。
- v1 仅保证执行结果**可被后续 feedback 模块消费**（R19.4）。

### 3.8 接缝八：公共 API（R7）

- 新增 `src/gateway/server-methods/fabric.ts`：导出 `fabricHandlers: GatewayRequestHandlers`：
  - `fabric.tool.execute` → `runPipeline`（→ `POST /v1/tool/execute`）。
  - `fabric.policy.check` → 仅 `governance.decide`（→ `POST /v1/policy/check`，dry-run）。
  - `fabric.tool.stream` → 注册 `tool-events` recipient 推 `ExecutionEvent`（→ `/v1/tool/stream/:executionId`）。
  - `fabric.adapter.register` → `adapter-registry.register`（→ `POST /v1/adapter/register`）。
- 接线：`server-methods.ts` spread `fabricHandlers`；`server-methods-list.ts` 注册方法名；`method-scopes.ts` 加 scope（execute/register 需 `operator.write`/`operator.admin`，check 需 `operator.read`）（R7.5）。
- 所有响应保留 `trace`（R7.6）。HTTP `/v1/*` 形态可由既有 HTTP 层（如 `/tools/invoke` 同款）薄转发到 `fabric.*` 方法。

### 3.9 流式（R12）

- 复用 `ToolEventRecipientRegistry` + `tool-events` capability：`fabric.tool.stream` 把 `executionId` 注册为 recipient，执行层把 `BackendEvent` → `ExecutionEvent` 转发（R12.2）。
- 外部消息面只收最终结果（R12.3，遵循既有约束）。

### 3.10 多租户与成本（R10、R11）

- tenant 隔离：`tenantSessionKey(tenantId, sessionKey)` 前缀 + session-domain guard（R10.1）。缺 tenant → 单租户退化（R10.3）。
- 成本：执行后经 `billing-ingest` / `usage-ingest` 上报（R11.1）；`costLimit` 超限 → 拒/终止（R11.2）。

## Components and Interfaces

> 新代码集中在 `src/fabric/`（核心库）+ `src/gateway/server-methods/fabric.ts`（API）；子系统仅被适配，不被改写。

- **C1 契约**（`src/fabric/contract.ts`、`mappers.ts`）：zod schema + 类型 + 子系统解耦 mapper。
- **C2 编译管线 + Trace Layer**（`src/fabric/gateway.ts`、`plan-adapter.ts`、`graph/state.ts`、`graph/run-state.ts`）：`normalize` + `toPlan`（AOR plan adapter / 单节点平凡图）+ `compileAndRun` + `ExecutionGraphState`（投影）+ `ToolExecutionRun` 状态机。**不构图/不排序/不调度/无 mutation engine**。
- **C3 Policy Runtime（唯一编译期决策点）**（`src/fabric/policy-runtime.ts`、`decision-trace.ts`）：`decide(node): PolicyDecision(+decisionTrace)`，编译期一次，含 cost/risk 评分与动态约束；Loom 编译期 metadata。
- **C4 Constraints**（`src/fabric/constraints.ts`）：`toTolControls`。
- **C5 Execution Plane（TOL）+ Adapter**（`src/fabric/execution.ts`、`adapter-registry.ts`）：enforce 预计算约束、交 TOL；`register`/`resolve`。门控不变量前置校验。
- **C6 Kernel + Routing**（`src/fabric/kernel.ts`）：AOR 薄封装，扩展 `Selector`。
- **C7 Audit + Replay + Feedback**（`src/fabric/audit.ts`、`replay.ts`、`feedback.ts`）：`record` + 查询/导出 + `replayDecision`/`dryRunDiff` + feedback 接口（human-gated）。
- **C8 API**（`src/gateway/server-methods/fabric.ts`）：`fabricHandlers`。

## Data Models

> 新增 `src/fabric/contract.ts`，zod 校验（TypeScript 表达，对齐产品定义文档第 5 节）。

```ts
const SourceType = z.enum(["cursor", "kiro", "codex", "windsurf", "claude-code", "openbot"]); // 可扩展：未知来源经注册表加入

const ToolRequest = z.object({
  id: z.string().min(1),
  source: z.object({
    type: SourceType.or(z.string().min(1)),
    userId: z.string().optional(),
    tenantId: z.string().optional(),
  }),
  tool: z.object({ name: z.string().min(1), version: z.string().optional() }),
  input: z
    .object({
      args: z.array(z.string()).optional(),
      cwd: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
    })
    .default({}),
  context: z
    .object({
      repoRoot: z.string().optional(),
      networkAccess: z.boolean().optional(),
      fileScope: z.array(z.string()).optional(),
    })
    .default({}),
  trace: z.object({
    sessionId: z.string().min(1),
    taskId: z.string().optional(),
    correlationId: z.string().min(1),
  }),
});

const ExecutionConstraints = z.object({
  allowedPaths: z.array(z.string()).optional(),
  blockedPaths: z.array(z.string()).optional(),
  allowNetwork: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  sandboxMode: z.enum(["none", "restricted", "strict"]).optional(),
  costLimit: z.number().nonnegative().optional(),
});

const DecisionTraceEntry = z.object({
  stage: z.enum([
    "loom.attribution",
    "scope.domain",
    "exec.allowlist",
    "exec.approval",
    "sandbox.constraint",
    "cost.threshold",
    "risk.score",
  ]),
  hit: z.boolean(),
  detail: z.string().optional(), // 人类可读；不含凭证
  effect: z.enum(["allow", "deny", "modify", "neutral"]).default("neutral"),
});
const DecisionTrace = z.array(DecisionTraceEntry); // explainability graph（有序）

const PolicyDecision = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("ALLOW"),
    constraints: ExecutionConstraints.optional(),
    matchedRules: z.array(z.string()).default([]),
    decisionTrace: DecisionTrace.default([]),
  }),
  z.object({
    decision: z.literal("DENY"),
    reason: z.string().min(1),
    matchedRules: z.array(z.string()).default([]),
    decisionTrace: DecisionTrace.default([]),
  }),
  z.object({
    decision: z.literal("MODIFY"),
    constraints: ExecutionConstraints,
    matchedRules: z.array(z.string()).default([]),
    decisionTrace: DecisionTrace.default([]),
  }),
]);

// 投影图节点（投影自 AOR plan / 单节点平凡图）。Fabric 不构图/不排序，结构来自 AOR。
// 注：以下为说明性 schema；ToolExecutionResult/PolicyDecision 见本节其他定义。
const RuntimeNodeBase = z.object({
  id: z.string().min(1),
  dependsOn: z.array(z.string()).default([]), // 仅确定性依赖；不含 intent
  status: z.enum(["pending", "ready", "running", "done", "failed"]).default("pending"),
});
const ToolNode = RuntimeNodeBase.extend({
  type: z.literal("tool"),
  request: ToolRequest,
  constraints: ExecutionConstraints.optional(),
  policy: PolicyDecision.optional(), // 由 Policy Gate 填充（执行前必经门控）
});
const AgentNode = RuntimeNodeBase.extend({ type: z.literal("agent"), request: ToolRequest });
const PolicyNode = RuntimeNodeBase.extend({
  // 仅记录/可解释；缺失 ≠ 无门控（门控是 executor 不变量）
  type: z.literal("policy"),
  source: z.enum(["loom", "fabric"]),
  decision: PolicyDecision,
  scope: z.object({ nodeIds: z.array(z.string()).default([]) }),
});
const AdapterNode = RuntimeNodeBase.extend({
  type: z.literal("adapter"),
  adapterId: z.string().min(1),
});
const AuditNode = RuntimeNodeBase.extend({
  type: z.literal("audit"),
  recordRef: z.string().optional(),
});
const ForkNode = RuntimeNodeBase.extend({
  type: z.literal("fork"),
  branches: z.array(z.string()).min(1),
});
const MergeNode = RuntimeNodeBase.extend({
  type: z.literal("merge"),
  strategy: z.enum(["all", "any", "majority"]).default("all"),
});
const RuntimeNode = z.discriminatedUnion("type", [
  ToolNode,
  AgentNode,
  PolicyNode,
  AdapterNode,
  AuditNode,
  ForkNode,
  MergeNode,
]);
const RuntimeEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(["data", "control"]).default("control"),
});

// 执行状态机实例。
const RunPhase = z.enum([
  "validated",
  "scheduled",
  "executing",
  "streaming",
  "finalized",
  "failed",
  "compensating",
]);
const ToolExecutionRun = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  phase: RunPhase.default("validated"),
  policyDecisionId: z.string(),
  attempts: z.number().int().nonnegative().default(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// 统一投影图状态：投影 AOR plan + policy overlay + execution trace；也是 replay 快照。
// Fabric 不构图/不排序/不调度；结构来自 AOR plan。
const ExecutionGraphState = z.object({
  graphId: z.string().min(1),
  nodes: z.array(RuntimeNode).min(1),
  edges: z.array(RuntimeEdge).default([]),
  runs: z.array(ToolExecutionRun).default([]),
  context: z.object({
    tenantId: z.string().optional(),
    sessionId: z.string().min(1),
    correlationId: z.string().min(1),
    ownership: z.record(z.string(), z.unknown()).default({}), // 来自 Loom（mapper 转换）
  }),
});

const ToolExecutionResult = z.object({
  id: z.string().min(1),
  status: z.enum(["success", "failed", "denied"]),
  output: z.object({ stdout: z.string().optional(), stderr: z.string().optional() }).optional(),
  exitCode: z.number().int().optional(),
  timing: z.object({ start: z.number(), end: z.number() }),
  trace: z.object({ policyDecisionId: z.string(), executionId: z.string() }),
});

const ExecutionEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stdout"), data: z.string() }),
  z.object({ type: z.literal("stderr"), data: z.string() }),
  z.object({ type: z.literal("status"), state: z.enum(["running", "done"]) }),
  z.object({ type: z.literal("policy"), decision: PolicyDecision }),
]);

const ToolAdapter = z.object({
  id: z.string().min(1),
  match: z.object({ toolNames: z.array(z.string().min(1)).min(1) }),
  execute: z.object({ command: z.string().min(1), argsTemplate: z.array(z.string()).optional() }),
  capabilities: z
    .object({
      fs: z.boolean().optional(),
      network: z.boolean().optional(),
      streaming: z.boolean().optional(),
    })
    .default({}),
});
```

- **不含任何凭证/密钥**：仅路径、命令、策略、归属、租户元数据（R9.5、R13.3）。
- 内部对象（`ExecApprovalsResolved`、`AorAuditRecord`、Loom `Task`）经 mapper 转换，不进对外契约。

## Correctness Properties

### Property 1: 契约唯一 + 解耦

所有对外 API 只暴露 Fabric 契约类型；子系统内部类型不泄漏为对外字段。
**Validates: Requirements 1.1, 1.5**

### Property 2: 管线固定 + DENY 短路

任一 `ToolRequest` 经 `normalize → graph.plan → policyRuntime.decide → (DENY 短路 | execute[state machine]) → audit`；DENY 不进执行阶段。
**Validates: Requirements 2.2, 2.3, 3.1, 15.1**

### Property 3: 零安全回退

Fabric 不放宽任何既有 exec-approval / sandbox / scope / domain 拒绝集合；默认安全（未知不默认 ALLOW）。
**Validates: Requirements 3.5, 4.4, 13.2**

### Property 4: 约束强制

设置的 `ExecutionConstraints` 被执行层强制；违规终止并标记。
**Validates: Requirements 4.3, 5.3**

### Property 5: 复用而非重写

Policy Runtime/Execution/Audit/Stream/Tenant/图规划/选路复用既有设施（exec-approvals、sandbox、AOR `Planner`/`Selector`、`tool-events`），无并行权限系统/审计存储/流式协议/编排引擎。
**Validates: Requirements 3.2, 5.1, 9.3, 12.2, 15.3, 18.1**

### Property 6: 可归因 + 可回放 + 可解释

每次执行的审计记录含完整 who/why/what/where + decision + decisionTrace + 输入快照，可按 tenant/session/correlation 查询并导出；可对历史 req 重跑 `decide` 得相同结论。
**Validates: Requirements 9.1, 9.2, 9.4, 16.1, 17.1**

### Property 7: 多租户隔离

不同 tenant 的 policy/执行/审计互不可见、互不影响；缺 tenant 退化为单租户。
**Validates: Requirements 10.2, 10.3**

### Property 8: 向后兼容

feature off 时既有路径逐字节不变；改变任一既有判定结论需显式报告。
**Validates: Requirements 13.1, 13.4**

### Property 9: Loom 仅作编译期静态 metadata

Loom 只在编译期被消费（attribution/static rules）；runtime 无 Loom lookup；Loom 类型不直接作为对外 PolicyDecision 字段。
**Validates: Requirements 14.2, 14.5, 21.1**

### Property 10: 执行状态机合法性

`ToolExecutionRun` 非法 phase 迁移被拒；每次迁移产出可观测事件。
**Validates: Requirements 15.1, 15.5**

### Property 11: 策略模拟不放宽 + 无副作用

policy dry-run diff 不触发执行副作用；候选策略放宽既有拒绝集合时显式标记要求人工确认。
**Validates: Requirements 17.2, 17.3, 17.4**

### Property 12: Feedback 绝不自动改写

feedback 仅产出建议 + 依据，任何代码路径都不 auto-apply / auto-mutate 策略或约束。
**Validates: Requirements 19.2**

### Property 13: 门控不变量（单点、编译期、不可绕过）

任何 `Tool`/`Agent` 节点无"已附带的编译期 PolicyDecision"不得执行；runtime 不重新评估 policy，只 enforce。
**Validates: Requirements 21.1, 21.2, 21.3**

### Property 14: 唯一编排器（无第二个 Planner）

execution structure（DAG/排序/选路）只来自 AOR；Fabric 不构图/不排序/不调度；移除/打乱 intent 不改变结构。
**Validates: Requirements 20.1, 20.2, 20.3**

### Property 15: 投影一致性

`ExecutionGraphState` 是 AOR plan 的忠实投影 + policy overlay + trace；不重新推导依赖、不重排节点。
**Validates: Requirements 20.4, 20.5**

### Property 16: recompile 而非 runtime mutation

retry/rollback/新增节点经重新编译（AOR 重规划 + 重新 decide）实现；runtime 无 mutation engine；重编译不放宽既有决策。
**Validates: Requirements 21.5, 21.6**

### Property 17: 子系统不合并 + TOL 独立

Loom 与 Fabric 代码物理独立，Fabric 编译期经稳定读接口消费 Loom；Trace Layer 不执行工具，执行委托 TOL。
**Validates: Requirements 20.6**

## Error Handling

- 契约不合 schema：报「字段 + 对象 id」并非零/错误返回（R1.4）。
- Policy Runtime 不可判定：回退既有 ask/deny，绝不默认 ALLOW（R3.5）。
- 执行失败：`status:"failed"` + stderr/exitCode，不抛裸异常（R5.5）；可触发 compensation（接口）。
- 非法 phase 迁移：拒绝并提示合法迁移集合（R15.1）。
- 约束违规：终止 + 结果标记违规原因（R4.3）。
- adapter 未命中：明确错误（无静默执行任意命令）。

## Testing Strategy

> 框架 Vitest（仓库标准）。

1. **契约 schema 单测**：合法/非法对象、解耦 mapper 往返、decisionTrace/ToolGraph/ToolExecutionRun（Property 1）。
2. **管线单测**：ALLOW/DENY/MODIFY 三路 + DENY 短路不执行（Property 2）。
3. **零回归 parity 测试**：feature off vs on 的既有 exec-approval/sandbox/scope 拒绝集合一致（Property 3、8）——接入安全的核心证据。
4. **约束强制测试**：sandboxMode/allowedPaths/timeout/network 被强制，违规终止（Property 4）。
5. **复用断言**：Policy Runtime 走 `requiresExecApproval`/allowlist、图规划走 AOR `Planner`、选路走 AOR `Selector`、audit 走 `AorAuditRecord`、stream 走 `tool-events`（Property 5）。
6. **可解释 + 可回放**：decisionTrace 完整、记录含输入快照、`replayDecision` 重跑同结论、JSON 导出、无明文凭证（Property 6）。
7. **状态机**：合法/非法 phase 迁移、迁移事件可观测（Property 10）。
8. **策略模拟**：`dryRunDiff` 无副作用、放宽拒绝集合被标记（Property 11）。
9. **feedback 不写**：断言任何路径都不 auto-mutate 策略（Property 12）。
10. **多租户隔离**：跨 tenant 不可见；缺 tenant 退化（Property 7）。
11. **生态验证**：注册 shell/git adapter 跑通 execute，仍受 allowlist/exec-approval 门控（R8.4/R8.5）。

## 待审决策清单

- **D1（建议：feature-gated 默认 off）**：Fabric 管线默认关闭，经 config flag 开启，保证 v1 零回归。
- **D2（建议：先 gateway 方法、后 HTTP /v1）**：先落 `fabric.*` server-methods，`/v1/*` HTTP 形态作薄转发层，复用 `/tools/invoke` 鉴权。
- **D3（建议：Governance 组合既有点而非新 PDP）**：v1 不引入独立 Policy Decision Point 引擎；用 `decide()` 组合 method-scope + exec-approval + allowlist + Loom attribution。OPA/规则 DSL 留后续期。
- **D4（建议：v1 仅打通 1 个外部 adapter）**：以通用 shell/git 验证生态入口，Cursor/Codex/Windsurf 专用适配器留后续期。
- **D5（建议：审计复用既有存储）**：不新建审计 DB；用 AOR `AorAuditRecord` + `control-plane-audit.ts`，导出为 JSON。
- **D6（评审采纳：三层边界）**：Loom = policy SOURCE（Layer 1），Policy Runtime = 评估面（Layer 2），TOL = 执行运行时（Layer 3）。三层在代码与契约上显式分离。
- **D7（评审采纳：扩展 AOR 不另建）**：Tool Execution Graph 扩展 AOR `Planner`/`ExecutionPlan`；Routing Intelligence 扩展 AOR `Selector`/`SelectionStrategy`。禁止并行编排/选路引擎。
- **D8（评审采纳：feedback human-gated）**：执行反馈仅产出建议（suggest→accept），绝不 auto-mutate 策略；v1 仅预留接口与数据通道，自动学习留 v1.x/v2。
- **D9（评审采纳：可解释 + 决策回放进 v1）**：decisionTrace 与 decision-replay/dry-run diff 是 v1 范围；执行侧副作用 replay 与完整 simulation 留后续期。
- **D10（命名）**：产品名保持 **OpenBot Fabric**（暂不冠 "OS"，待运行时成熟）；内部子系统名 = Governance Kernel / Policy Runtime / Execution Runtime。
- **D11（评审 v1.3：唯一编排器 + Trace Layer）**：execution structure 唯一属 AOR；Fabric Graph 降级为投影/记录层（不构图/不排序/不调度/不做 planner）。避免双编排（双 truth source、顺序不一致、调试爆炸）。
- **D12（评审分歧：不合并 Loom）**：Loom 与 Fabric 物理独立、各自演进；不合并、不改名；Loom 仅**编译期** metadata（禁止 runtime lookup）。
- **D13（评审 v1.3：单决策点 + recompile）**：policy 编译期决策一次并附着到节点；runtime 只 enforce；变更经 recompile（AOR 重规划 + 重新 decide），v1 无 runtime mutation engine。
