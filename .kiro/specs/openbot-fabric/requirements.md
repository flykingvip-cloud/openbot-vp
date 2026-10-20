# Requirements Document

> 产品名：**OpenBot Fabric** —— AI 开发工具执行控制平面（AI Dev Tool Execution Control Plane）
> 一句话：OpenBot Fabric 是一个统一的 AI 开发工具执行控制平面，用于**管理、调度、约束、审计**所有外部与内部开发工具（CLI / IDE / Agent）的执行行为。
> 产品本质：**不是** Agent 框架、**不是** CLI 工具集合、**不是** Workflow 编排器；而是 **AI Development Tool Control Plane**，解决"谁在什么条件下用什么工具做了什么事"。

## Introduction

OpenBot Fabric 把当前 OpenBot 仓库中已经存在、但分散为三组能力的子系统，**重新抽象并统一**为一个**运行时控制平面（Runtime Control Plane）**，而非一个被动的"网关 + 策略拼装层"。

> **架构评审采纳（v1.3 — 收敛：唯一编排器 + 单决策点 + Trace Layer）**：上一版把 Runtime Graph Layer 做成带 builder/scheduler/executor/mutation 的完整运行时，等于在 AOR 之外造了第二个编排器——这是危险的职责漂移。本版收敛为顶层铁律：**AOR owns execution structure（唯一 Planner）· Fabric owns permission + transformation + audit · TOL owns execution · Loom owns static governance metadata**。

```
┌──────────────────────────────────────────────────────────────────┐
│  AOR  (唯一 Planner / Execution Structure)        packages/aor-core │
│   - DAG 生成（ExecutionPlan/PlanNode） - Selector 选路              │
│   （单 tool 调用 = 平凡 1 节点，不经 planner）                       │
└───────────────────────────────┬────────────────────────────────────┘
                                 │ execution plan (DAG skeleton)
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  POLICY RUNTIME (Fabric Core)  ⭐唯一决策点（compile-time）         │
│   Loom metadata(编译期) + exec-approval + scope/domain              │
│   → constraints modification → PolicyDecision(+decisionTrace)       │
│   决策一次性附着到 plan 节点；runtime 不再评估                       │
└───────────────────────────────┬────────────────────────────────────┘
                                 │ plan + 预计算 PolicyDecision/constraints
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  EXECUTION RUNTIME (TOL)  纯执行 + 强制（非再决策）                  │
│   sandbox · process/shell/git/fs · streaming · resource limits      │
│   只 enforce 预计算约束；不重复 gate                                │
└───────────────────────────────┬────────────────────────────────────┘
                                 │ execution result + events
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  TRACE LAYER (Fabric Graph)  执行态投影/记录，非编排               │
│   投影 AOR plan + policy overlay + execution trace                  │
│   → audit · replay · dryRunDiff · observability                     │
│   ❌不构图 ❌不排序 ❌不调度 ❌不做 planner                          │
└──────────────────────────────────────────────────────────────────┘
        ┊ Cross-cutting: Feedback(human-gated, v1 仅接口)
```

关键结论性区分（评审 v1.3 收敛）：

- **唯一编排器 = AOR。** execution structure（DAG 生成、节点排序、选路）只属 AOR。Fabric **不构图、不排序、不调度、不做 planner**；单 tool 调用是平凡 1 节点，根本不经 planner。
- **Fabric Graph = Execution Projection / Trace Layer。** 只做三件事：①投影 AOR plan；②叠加 policy decision overlay；③记录 runtime execution trace（audit/replay/observability）。
- **唯一决策点 = compile-time Policy Runtime。** policy 评估是**编译期一次性操作**，结果（PolicyDecision + constraints）附着到 plan 节点；**runtime 不再评估 policy**，只 enforce 预计算决策。交互式 ask-on-miss 审批在 decide 阶段解析。
- **决策（decide）vs 强制（enforce）分离。** TOL 的 sandbox/exec-approval 在执行期**强制**已决约束（OS 层），这不是"再决策"。任何节点无"已附带的编译期 PolicyDecision"不得执行（门控不变量，单点、编译期）。
- **mutation → recompile，不在 runtime 改策略。** v1 不做 runtime graph mutation engine；retry/rollback = 生成新 plan 版本（外部 recompile），trace 只 log。
- **Loom = compile-time-only 静态治理元数据。** 禁止 runtime attribution lookup / runtime 决策依赖链；Loom hints 在编译期烘进 PolicyDecision。
- **Loom 与 Fabric 不合并、不改名；TOL 独立不被吞并。**

一句话职责边界：**AOR owns execution structure · Fabric owns permission + transformation + audit · TOL owns execution · Loom owns static governance metadata.**

各子系统**真实代码资产**与 Fabric 的接入边界（抽象而非重写）：

- **AOR（唯一 Planner）** —— `packages/aor-core`（`Orchestrator`/`Planner`/`ExecutionPlan`/`PlanNode`/`Selector`/`ExecutionBackend`/`ToolInvoker`/`TenantContext`/`AorAuditRecord`/cost）、`packages/aor-backend-openbot`、`src/gateway/policy-engine`。职责：DAG 生成、选路、LLM/tool routing、cost。Fabric **消费** plan，绝不重建。
- **Policy Runtime（Fabric Core，新增，唯一决策点）** —— 在既有强制点之上编译期评估：消费 Loom（编译期 metadata）+ exec-approval（`exec-approvals.ts`）+ allowlist（`exec-approvals-allowlist.ts`）+ method-scope/role/domain（`method-scopes.ts`），产出带 decisionTrace、cost/risk 评分、动态约束的 `PolicyDecision`，一次性附着到 plan 节点。
- **Execution Runtime（TOL，独立）** —— `src/agents/pi-tools.ts`、`src/agents/openclaw-tools.ts`、`src/infra/exec-approvals.ts`、`src/agents/tool-fs-policy.ts`、`src/cli/sandbox-cli.ts`、`POST /tools/invoke`。职责：纯执行 + 强制预计算约束（sandbox/process/git/fs/stream/resource limits）。
- **Trace Layer（Fabric Graph，投影/记录）** —— 投影 AOR plan + policy overlay + execution trace；`audit`/`replay`/`dryRunDiff`/observability。不构图、不排序、不调度。
- **Loom（静态治理元数据 source，独立）** —— `.loom/registry.yaml`、`scripts/loom/*`。仅编译期消费；不合并、不改名。

### 本期定位（Scope Framing）

Fabric v1 的目标是**确立三层运行时的层边界与关键抽象（执行图 + 状态机 + 可解释性 + 决策可回放），并交付最小可信闭环**，而不是一次实现整份愿景文档。范围按评审 P0/P1/P2 优先级分级落地。

**v1 范围（IN，含评审 P0）：**

1. 统一的 **Fabric 运行时契约**：`ToolRequest` / `ToolGraph` / `PolicyDecision`（含 `decisionTrace`）/ `ExecutionConstraints` / `ToolExecutionRun`（状态机）/ `ToolExecutionResult` / `ExecutionEvent` / `ToolAdapter`（仓库级、可序列化、schema 校验）。
2. **明确四层职责边界**：AOR（唯一 Planner）/ Policy Runtime（唯一编译期决策点）/ Execution Runtime（TOL，纯执行+强制）/ Trace Layer（Fabric Graph，投影/记录）。Loom = 编译期静态治理元数据，与 Fabric 物理独立不合并。
3. **Fabric Policy Runtime（P0，唯一决策点）**：**编译期**消费 Loom metadata + exec-approval + allowlist + scope/domain，产出带 **decisionTrace（可解释性图）** 与**动态约束**的 `PolicyDecision`，一次性附着到 plan 节点；含 cost/risk 评分占位（v1 确定性评分）。runtime 不再评估 policy。
4. **Trace Layer + Execution State Machine（P0）**：`ExecutionGraphState`（投影 AOR plan + policy overlay + execution trace）+ `ToolExecutionRun` 状态机（`validated/scheduled/executing/streaming/finalized/failed`）+ **门控不变量**（无附带 PolicyDecision 的节点不得执行）。**不构图、不排序、不调度、不做 runtime mutation engine**；retry/rollback = 外部 recompile（trace 仅 log）。AOR plan adapter 投影单节点/顺序链/一个 fork/merge。
5. **Execution 接入（TOL）**：`ExecutionConstraints` 强制层复用 `exec-approvals` + sandbox + fs policy，**零回归**。
6. **决策可回放 + 策略模拟（P1，v1 落最小集）**：审计记录**按构造可回放决策**（足以对历史 `ToolRequest` 重跑 `decide` 得到相同结论）；提供 **policy dry-run diff**（模拟策略变更 = 对历史请求重评估并对比），但**不**做执行侧副作用重放。
7. **公共 API（最小集）**：`/v1/tool/execute`、`/v1/policy/check`（dry-run，返回 decisionTrace）、`/v1/tool/stream/:executionId`、`/v1/adapter/register`，落在既有 gateway server-methods + `/tools/invoke` 之上。
8. **Adapter Registry**：声明式注册，至少打通 1 个非 OpenBot 适配器（shell/git）作生态验证。

**v1.x / v2（评审 P1/P2，明确留后续，但 v1 须预留接口）：**

- Execution outcome → **feedback signals**（失败模式检测、约束收紧**建议**）。**强约束：human-gated suggest→accept，绝不 auto-apply / auto-mutate policy**（继承 Loom 信任铁律）。
- 完整 **simulation / 执行侧 replay**（受控重放有副作用工具）、policy version 对比矩阵。
- **Routing Intelligence** 升级：tool/model 混合选路、fallback tools、cost-aware routing——**扩展 AOR `Selector`**，非新组件。
- 多工具 orchestration DAG 的分支/并行高级语义（v1 仅就位接口）。

**v1 非目标（OUT，更后续期）：**

- ❌ 完整 SaaS 控制面 / 计费出账 / 席位定价（复用 `cost-budget-billing` 做 cost tracking，不做 Fabric 自有计费产品）。
- ❌ Tool adapter marketplace。
- ❌ 全量外部 IDE 深度适配（Cursor / Windsurf / Codex 私有协议逐个适配留后续）。
- ❌ SOC2 / 合规报表 UI（v1 仅保证审计/decisionTrace **可导出** JSON）。
- ❌ 独立 policy 规则 DSL / OPA 引擎（v1 Policy Runtime 用组合式评估 + decisionTrace，不引入 DSL）。
- ❌ 替换或改写 Loom / TOL / AOR 内部实现（Fabric 是上层抽象 + 编排）。
- ❌ **合并 Loom 与 Fabric 代码库 / 把 Loom 改造为 Graph Compiler**：二者概念上同属治理，但物理独立、各自演进；Fabric 编译期经稳定读接口消费 Loom。
- ❌ **在 Fabric 内重建编排器/Planner**：execution structure 唯一属 AOR；Fabric 不构图/不排序/不调度。
- ❌ **runtime 重复评估 policy**：policy 仅编译期决策一次；runtime 只 enforce 预计算决策。
- ❌ **Loom runtime lookup / runtime 决策依赖链**：Loom 仅编译期 metadata。
- ❌ **runtime graph mutation engine**：v1 retry/rollback = 外部 recompile，trace 仅 log；任意 live rewriting 留后续期。

### 现状与证据（Current State）

- **Loom 已落地 MVP**：`.loom/registry.yaml` 已 commit；`scripts/loom/`（attribution / audit / lifecycle / register / lint 等）运行态读 Registry；状态机 `claimed/active/paused/blocked/ready/landed/abandoned` + session `active/idle/done/dead/error` 已实现（见 `.kiro/specs/loom-workspace-orchestrator/`）。
- **TOL 能力分散但完整**：`exec-approvals.ts` 定义 `ExecHost = sandbox|gateway|node` / `ExecSecurity = deny|allowlist|full` / `ExecAsk = off|on-miss|always`，`requiresExecApproval(...)` 为门控决策点；`tool-fs-policy.ts` 提供 `workspaceOnly` 文件边界；`sandbox-cli.ts` 提供 Docker 隔离（`workspaceAccess: rw|ro`）。**这是现成的 `ExecutionConstraints` 模型**。
- **Kernel 即 AOR**：`packages/aor-core/src/backend.ts` 的 `ExecutionBackend`（`run`/`stream`/`wait`/`abort` + `BackendEvent`）是统一执行/流式抽象；`tool-invoker.ts` 的 `ToolInvoker.invoke(ToolInvokeRequest): ToolInvokeResult` 是工具调用 port；`audit.ts` 的 `TenantContext` / `AorAuditRecord` 是多租户审计基础。
- **API/流式/租户已有底座**：gateway server-methods 注册模式（`GatewayRequestHandlers` → `server-methods.ts` → `server-methods-list.ts` → `method-scopes.ts`）；`ToolEventRecipientRegistry` + `tool-events` capability 提供流式；session-domain `platform|enterprise|employee` 提供隔离边界。

### 设计原则（强约束 / 非功能性需求）

1. **控制平面契约唯一**：`ToolRequest`/`PolicyDecision`/`ToolExecutionResult` 等是 Fabric 唯一对外契约；子系统通过适配器接入，子系统内部模型不得直接泄漏为对外 API。
2. **复用而非重写**：Fabric **必须**复用既有 Loom / exec-approvals / sandbox / AOR / gateway 资产；任何"重新实现已有能力"的设计需显式论证。
3. **零安全回归**：Fabric 接入 **SHALL NOT** 放宽任何既有 exec-approval / sandbox / method-scope / session-domain 的拒绝集合（与 SECURITY.md 信任模型一致）。
4. **默认拒绝 + 可解释**：`PolicyDecision` 默认安全（未知 → 走既有 ask/deny 路径），且每个 DENY/MODIFY 都附 `reason` 与 `matchedRules`，可归因、可回放。
5. **Path = 硬信号 / Intent = 软信号**：继承 Loom 铁律——归属/landing/拦截判定只依据确定性信号（path、命令分析、scope、domain），语义意图不参与拦截决策。
6. **本地优先、增量上线**：v1 不要求服务端；契约与编排能力以仓库内文件 + gateway 方法暴露；既有调用方在未启用 Fabric 时**逐字节不变**（feature-gated）。
7. **多租户隔离**：tenant → 隔离的 policy 空间 + 执行空间 + 审计查询空间（复用 AOR `tenantSessionKey` + session-domain）。

## Glossary

- **Fabric**：OpenBot Fabric 控制平面产品层本身。
- **Tool Execution Gateway**：Fabric 的统一入口/归一化层，把异构来源的工具调用归一为 `ToolRequest`。
- **ToolRequest**：统一工具调用请求（source / tool / input / context / trace）。
- **PolicyDecision**：治理引擎（Loom）对 `ToolRequest` 的裁决：`ALLOW` / `DENY` / `MODIFY`（带 `constraints`）。
- **ExecutionConstraints**：执行约束（allowedPaths / blockedPaths / allowNetwork / timeoutMs / sandboxMode / costLimit），由 PolicyDecision 下发、由 TOL 强制。
- **ToolExecutionResult**：执行结果（status / output / exitCode / timing / trace）。
- **ExecutionEvent**：流式执行事件（stdout / stderr / status / policy）。
- **ToolAdapter**：把某类工具名映射到具体执行命令的声明式适配器（match / execute / capabilities）。
- **Governance（Loom）**：治理子系统，产出 PolicyDecision + attribution + audit + lifecycle。
- **Execution Layer（TOL）**：执行子系统，负责 adapter 调度、进程 spawn、流式、sandbox、约束强制。
- **Agent Runtime（Kernel / AOR）**：认知子系统，负责 LLM/tool routing、memory、skills、multi-agent 编排，**不直接参与 tool policy**。
- **Fabric Policy Runtime（Layer 2）**：新增评估面，消费 Loom（source）+ exec-approval + allowlist + scope/domain，产出带 decisionTrace 与动态约束的 PolicyDecision。
- **Governance Kernel（Layer 1 = Loom）**：确定性 policy **source**（ownership/attribution/static rules/landing mapping/lifecycle），非评估引擎。
- **ToolGraph / ExecutionGraphState**：执行态投影图——投影 AOR plan + policy overlay + execution trace。**不由 Fabric 构图/排序**；单 tool 调用为平凡 1 节点。是 replay 快照。
- **Trace Layer（Fabric Graph）**：Fabric 的执行态投影/记录层（audit/replay/observability），**非编排器**。
- **RuntimeNode**：投影图节点，类型 ∈ `Tool | Agent | Policy | Adapter | Audit | Fork | Merge`；结构来自 AOR plan，非 Fabric 自建。
- **Policy Gate（门控不变量）**：任何 `Tool`/`Agent` 节点无"已附带的编译期 PolicyDecision"不得执行；这是 enforce 层不变量，不是 runtime 再决策。
- **decide vs enforce**：decide = 编译期一次性策略决策（Policy Runtime）；enforce = 运行期 TOL 强制预计算约束（sandbox/exec-approval，非再决策）。
- **recompile**：mutation/retry/rollback 经重新生成 plan + 重新 decide 实现，而非 runtime 改图改策略。
- **ToolExecutionRun**：一次执行的状态机实例，phases = `validated/scheduled/executing/streaming/finalized/failed/compensating`，含 branches/compensations。
- **decisionTrace（Policy Explainability Graph）**：PolicyDecision 的可解释结构，逐条记录命中的 Loom rule chain / allowlist match / exec-approval trigger / sandbox / cost 阈值。
- **decision-replay**：对历史 ToolRequest 重跑 `decide` 得到相同结论的能力（不重放执行副作用）。
- **policy dry-run diff（simulation）**：模拟策略变更——对历史请求集重评估并对比新旧决策。
- **feedback signal**：由执行结果派生的失败模式/约束收紧**建议**；human-gated，绝不 auto-apply。
- **replayable trace**：可回放执行轨迹——足以重建一次执行的 who/why/what/where 的不可变记录。
- **tenant**：逻辑租户，拥有隔离的 policy / execution / audit 空间。

## Requirements

### Requirement 1: 统一控制平面数据模型

**User Story:** 作为平台集成方，我希望所有工具调用都用同一套可序列化、可校验的数据模型表达，以便异构来源能被统一治理、执行、审计。

#### Acceptance Criteria

1. 系统 SHALL 定义并以 schema（zod）校验以下核心类型：`ToolRequest`、`PolicyDecision`、`ExecutionConstraints`、`ToolExecutionResult`、`ExecutionEvent`、`ToolAdapter`，字段语义与产品定义文档第 5 节一致。
2. `ToolRequest` SHALL 至少包含 `id`、`source{type,userId?,tenantId?}`、`tool{name,version?}`、`input{args?,cwd?,env?}`、`context{repoRoot?,networkAccess?,fileScope?}`、`trace{sessionId,taskId?,correlationId}`。
3. `source.type` SHALL 是可扩展枚举，至少覆盖 `cursor | kiro | codex | windsurf | claude-code | openbot`，并允许注册新来源。
4. WHEN 任一控制平面对象不合 schema THEN 系统 SHALL 报出可定位错误（字段 + 对象 id），SHALL NOT 静默放行。
5. 控制平面契约 SHALL 与子系统内部模型解耦：子系统类型（如 `ExecApprovalsResolved`、`AorAuditRecord`、Loom `Task`）通过显式映射函数转换，SHALL NOT 直接作为 Fabric 对外字段暴露。

### Requirement 2: Tool Execution Gateway（统一入口 + 归一化）

**User Story:** 作为接入方（IDE/CLI/Agent），我希望有一个统一入口接收工具调用并归一化，以便无论来源如何都进入同一治理-执行管线。

#### Acceptance Criteria

1. 系统 SHALL 提供统一入口，接收来源特定的工具调用并归一化为 `ToolRequest`（含 `source.type` 标注）。
2. WHEN 接收到调用 THEN 系统 SHALL 按固定管线处理：`归一化 → Governance(PolicyDecision) → (若 ALLOW/MODIFY) Execution → ToolExecutionResult`。
3. WHEN PolicyDecision = `DENY` THEN 系统 SHALL NOT 进入执行阶段，并返回 `status: "denied"` 的 `ToolExecutionResult`（含 `trace.policyDecisionId` 与 reason）。
4. WHEN PolicyDecision = `MODIFY` THEN 系统 SHALL 把返回的 `constraints` 强制传递给执行阶段，执行 SHALL 在该约束下进行。
5. 归一化层 SHALL 为可扩展：新增 `source.type` 适配仅需新增映射，SHALL NOT 改动核心管线。

### Requirement 3: Governance 接入（Loom）→ PolicyDecision

**User Story:** 作为安全/平台负责人，我希望每次工具调用都先经过治理引擎裁决，以便控制权限、防止越权，并保证可归因。

#### Acceptance Criteria

1. 系统 SHALL 提供治理引擎，输入 `ToolRequest`、输出 `PolicyDecision`（`ALLOW` | `DENY{reason}` | `MODIFY{constraints}`）。
2. 治理裁决 SHALL 复用既有强制点而非新建并行权限系统：method-scope / role / session-domain 授权（`method-scopes.ts` / `guardSessionDomain`）、exec-approval 门控（`requiresExecApproval`，`exec-approvals.ts`）、命令分析/allowlist（`exec-approvals-allowlist.ts`）。
3. `PolicyDecision` SHALL 携带 `matchedRules`（命中的规则/scope/allowlist 条目）与（当非 ALLOW 时）人类可读 `reason`。
4. 治理 SHALL 复用 Loom 的 attribution 语义：把执行归因到 owner/agent/task（who），并在审计记录中保留。
5. 默认安全：WHEN 治理无法确定裁决 THEN 系统 SHALL 回退到既有 ask/deny 行为，SHALL NOT 默认 ALLOW。
6. 治理判定 SHALL 仅依据硬信号（path、命令分析、scope、domain、tenant），SHALL NOT 依据 intent 等软信号做拦截。

### Requirement 4: ExecutionConstraints 模型与下发

**User Story:** 作为治理引擎，我希望用统一的约束模型限制执行的路径、网络、超时、沙箱级别与成本，以便对 AI 工具的行为边界做精确控制。

#### Acceptance Criteria

1. 系统 SHALL 定义 `ExecutionConstraints`：`allowedPaths?`、`blockedPaths?`、`allowNetwork?`、`timeoutMs?`、`sandboxMode?: "none"|"restricted"|"strict"`、`costLimit?`。
2. 系统 SHALL 提供 `ExecutionConstraints` 到既有 TOL 控制项的映射：`sandboxMode` → `ExecHost`/Docker sandbox `workspaceAccess`、`allowedPaths`/`blockedPaths` → `ToolFsPolicy.workspaceOnly` + fs 边界、`allowNetwork` → 网络策略、`timeoutMs` → 进程超时、`costLimit` → Kernel/AOR 预算。
3. WHEN constraints 指定了某约束 THEN 执行层 SHALL 强制该约束；WHEN 执行违反约束 THEN 系统 SHALL 终止执行并在结果中标记违规原因。
4. 约束映射 SHALL NOT 放宽既有默认安全姿态（如 `applyPatch.workspaceOnly` 默认 true 不得被 Fabric 隐式翻为 false）。

### Requirement 5: Execution Layer 接入（TOL）

**User Story:** 作为接入方，我希望工具能在受控运行时中实际执行（含进程 spawn、流式输出、沙箱隔离），以便在约束内安全获得结果。

#### Acceptance Criteria

1. 系统 SHALL 通过 Adapter System 把 `ToolRequest.tool.name` 解析为可执行命令，复用既有工具表面（`pi-tools.ts` 的 `exec`/`process`/`apply_patch`、`openclaw-tools.ts`、`/tools/invoke` 的 `ToolInvoker`）。
2. 系统 SHALL 支持进程 spawn 并流式转发 stdout/stderr，复用既有流式机制（`ToolEventRecipientRegistry` / AOR `BackendEvent`）。
3. 系统 SHALL 在 `sandboxMode != "none"` 时通过既有 sandbox（`sandbox-cli.ts`）执行，保证文件系统隔离。
4. 执行层 SHALL 产出 `ToolExecutionResult`（`status`、`output{stdout?,stderr?}`、`exitCode?`、`timing{start,end}`、`trace{policyDecisionId,executionId}`）。
5. WHEN 执行失败 THEN 系统 SHALL 返回 `status: "failed"` 并保留 stderr/exitCode，SHALL NOT 抛裸异常给调用方。

### Requirement 6: Agent Runtime 接入（Kernel / AOR）

**User Story:** 作为平台，我希望 Agent 认知能力（LLM routing、orchestration、cost）由 Kernel 提供，且明确不参与工具 policy，以便职责清晰、计费可追踪。

#### Acceptance Criteria

1. 系统 SHALL 通过 AOR（`Orchestrator` / `ExecutionBackend` / `ToolInvoker`）承载 LLM routing、orchestration、memory、skills，Fabric SHALL NOT 在控制平面层重复实现这些能力。
2. Agent Kernel SHALL NOT 参与 tool policy 裁决（policy 属 Governance 子系统）；Kernel 仅在被授权后执行。
3. 系统 SHALL 把 AOR 的 `TenantContext`（userId/tenantId）与 Fabric `ToolRequest.source` 对齐，使运行可归因、可计费。
4. 系统 SHALL 把 AOR 路由策略（`SelectionStrategy`，经 `policy-engine`）作为 `ExecutionConstraints.costLimit` / routing 的实现路径，而非另建路由器。

### Requirement 7: 公共 API（Fabric Public API，最小集）

**User Story:** 作为外部集成方，我希望通过稳定的 API 执行工具、预检策略、订阅流式、注册适配器，以便把 Fabric 接入我自己的工具链。

#### Acceptance Criteria

1. 系统 SHALL 提供 `POST /v1/tool/execute`：入参 `{ request: ToolRequest }`，按 R2 管线执行，出参 `{ result: ToolExecutionResult }`。
2. 系统 SHALL 提供 `POST /v1/policy/check`（dry-run）：入参 `ToolRequest`，仅跑 Governance 返回 `{ decision, constraints, matchedRules }`，SHALL NOT 执行工具。
3. 系统 SHALL 提供 `/v1/tool/stream/:executionId`（流式）：推送 `ExecutionEvent`（`stdout`/`stderr`/`status`/`policy`），复用既有 `tool-events` 流式通道。
4. 系统 SHALL 提供 `POST /v1/adapter/register`：注册 `ToolAdapter`（match/execute/capabilities）。
5. 所有 API SHALL 落在既有 gateway 鉴权之上（role / scope / session-domain），SHALL NOT 新建绕过既有鉴权的入口；新方法 SHALL 在 `server-methods-list.ts` + `method-scopes.ts` 注册对应 scope。
6. 所有 API SHALL 在请求/响应中保留 `trace`（correlationId / policyDecisionId / executionId）以便端到端追踪。

### Requirement 8: Adapter Registry 与外部 CLI 生态

**User Story:** 作为生态接入方，我希望声明式地把任意 CLI/工具注册为适配器，以便 Fabric 能统一调度它而无需改核心。

#### Acceptance Criteria

1. 系统 SHALL 支持声明式 `ToolAdapter`：`id`、`match{toolNames[]}`、`execute{command,argsTemplate?[]}`、`capabilities{fs?,network?,streaming?}`。
2. WHEN 一个 `ToolRequest.tool.name` 命中某 adapter 的 `match.toolNames` THEN 执行层 SHALL 用该 adapter 的 `execute` 模板组装命令并执行。
3. Adapter 的 `capabilities` SHALL 参与 Governance 约束推导（如声明 `network:false` 的 adapter 触发 `allowNetwork:false`）。
4. 系统 SHALL 至少打通 1 个非 OpenBot 内置适配器（如通用 `shell`/`git` 或一个外部 CLI），证明生态入口可用且仓库无关。
5. Adapter 注册 SHALL 经 schema 校验与既有 allowlist/exec-approval 门控；SHALL NOT 因注册了 adapter 而绕过命令安全分析。

### Requirement 9: 全链路审计与可回放轨迹

**User Story:** 作为合规/安全负责人，我希望每次工具执行都可追踪、可归因、可回放，以便事后审计与问责。

#### Acceptance Criteria

1. 系统 SHALL 为每次执行记录不可变审计记录，至少含：`ToolRequest`（who/what/where/why 输入）、`PolicyDecision`（含 matchedRules）、execution trace、stdout 摘要/哈希、timing、cost。
2. 审计记录 SHALL 可归因（who = source/userId/tenantId + Loom owner/agent/task；why = intent/taskId；what = tool+args；where = cwd/repoRoot/fileScope）。
3. 系统 SHALL 复用 AOR `AorAuditRecord` 与 gateway 审计设施（`control-plane-audit.ts`）作为底座，SHALL NOT 另建并行审计存储。
4. 系统 SHALL 提供按 `tenantId` / `sessionId` / `correlationId` 查询审计记录的能力，并支持结构化 JSON 导出（合规导出基础）。
5. 审计记录 SHALL NOT 包含明文凭证/密钥；env/args 中的敏感值 SHALL 按 key 名引用或脱敏。

### Requirement 10: 多租户隔离

**User Story:** 作为平台运营方，我希望不同租户的策略、执行与审计互相隔离，以便安全地多租户运营。

#### Acceptance Criteria

1. 系统 SHALL 以 `tenantId` 隔离 policy 空间、执行空间与审计查询空间，复用 AOR `tenantSessionKey()` 与 session-domain（`platform|enterprise|employee`）。
2. WHEN 一个 tenant 的请求 THEN 系统 SHALL NOT 让其 PolicyDecision/审计/执行可见或可影响其他 tenant。
3. 缺失 `tenantId` 的请求（本地单用户场景）SHALL 退化为既有单租户行为，不破坏现状。

### Requirement 11: 成本追踪与配额（接入既有计费）

**User Story:** 作为平台运营方，我希望每次执行的成本可追踪并可设上限，以便控制 AI 工具开销。

#### Acceptance Criteria

1. 系统 SHALL 在审计记录中记录每次执行的成本（复用 AOR cost / `billing-ingest` / gateway `usage-ingest`）。
2. WHEN `ExecutionConstraints.costLimit` 被设置且执行预计/实际超限 THEN 系统 SHALL 拒绝或终止该执行并在结果中标记。
3. 成本追踪 SHALL 复用既有 `cost-budget-billing` / `enterprise-usage` 接口，SHALL NOT 在 Fabric 层另建计费引擎。

### Requirement 12: 流式执行

**User Story:** 作为接入方，我希望实时获得执行的 stdout/stderr/状态/策略事件，以便观察长运行工具。

#### Acceptance Criteria

1. 系统 SHALL 通过 `/v1/tool/stream/:executionId` 推送 `ExecutionEvent`，事件类型至少含 `{type:"stdout"|"stderr"}`、`{type:"status";state:"running"|"done"}`、`{type:"policy";decision}`。
2. 流式 SHALL 复用既有 `tool-events` capability 与 `ToolEventRecipientRegistry` / AOR `BackendEvent`，SHALL NOT 新建并行流式协议。
3. WHEN 仅交付最终结果的外部消息面（如 WhatsApp/Telegram）作为接收方 THEN 系统 SHALL NOT 向其推送流式/部分事件（遵循既有"仅最终回复"约束）。

### Requirement 13: 向后兼容与非回归

**User Story:** 作为现有用户，我希望引入 Fabric 不破坏既有工具执行、不削弱既有安全纪律。

#### Acceptance Criteria

1. WHEN 未启用 Fabric（feature off）THEN 既有工具执行路径（`pi-tools` / `openclaw-tools` / `/tools/invoke` / exec-approvals / sandbox）SHALL 逐字节不变。
2. 引入 Fabric SHALL NOT 放宽任何既有 exec-approval / sandbox / method-scope / session-domain / pre-commit 的拒绝集合。
3. 系统 SHALL NOT 读取或输出任何明文凭证/密钥；控制平面对象 SHALL 仅含路径、命令、策略、归属、租户元数据。
4. WHEN Fabric 接入改变任一既有判定结论 THEN 系统 SHALL 在测试/校验中显式报告该差异，要求人工确认而非静默接受。

### Requirement 14: Fabric Policy Runtime（Layer 2，区别于 Loom source）

**User Story:** 作为平台/安全负责人，我希望策略评估是一个独立的、带上下文与可解释性的运行时层，而不是把 Loom 规则直接当决策，以便 Fabric 具备真正的治理能力而非冻结在 repo 规则层。

#### Acceptance Criteria

1. 系统 SHALL 将策略评估实现为独立的 **Policy Runtime** 层（Layer 2），其输入包含 `ToolRequest`、上下文（tenant/session/历史摘要）、成本信号；输出 `PolicyDecision`。
2. Policy Runtime SHALL 把 Loom 仅作为**确定性 source**（attribution/ownership/static rules/landing mapping）消费，SHALL NOT 把 Loom 规则的命中直接等同于最终决策。
3. Policy Runtime SHALL 产出 **动态约束注入**：依据来源/租户/成本/sandbox 上下文计算 `ExecutionConstraints`（MODIFY），而非仅静态 allow/deny。
4. Policy Runtime SHALL 含 **cost/risk 评分**结构（v1 可为确定性规则评分）；评分 SHALL 进入 decisionTrace；learning-based 评分留后续期。
5. Layer 1（Loom source）与 Layer 2（Policy Runtime）边界 SHALL 在代码与契约上显式分离，Loom 类型 SHALL NOT 直接作为对外 PolicyDecision 字段。

### Requirement 15: Tool Execution Graph + Execution State Machine（Layer 3）

**User Story:** 作为接入方，我希望执行是一个带阶段、可重试、可补偿的运行时图，而不是一次性的被动执行调用，以便支撑长运行、多步、可恢复的工具编排。

#### Acceptance Criteria

1. 系统 SHALL 定义 `ToolExecutionRun` 状态机，phases 至少含 `validated / scheduled / executing / streaming / finalized / failed / compensating`，并校验非法迁移。
2. 系统 SHALL 定义 `ToolGraph`（节点 = 工具调用，边 = 依赖/分支/补偿）；v1 SHALL 至少支持单节点与顺序链，并为分支/并行/补偿**预留接口**。
3. `ToolGraph` 规划 SHALL **扩展 AOR 既有 `Planner` / `ExecutionPlan` / `PlanNode`**（tool-invocation 层），SHALL NOT 另建并行编排引擎。
4. 系统 SHALL 支持节点级 retry 与 compensation 的**接口**（v1 落最小实现：失败→可声明的补偿步骤或回滚标记）。
5. 状态机每次迁移 SHALL 产出可观测事件并进入审计/流式，使执行过程可追踪。

### Requirement 16: Policy Explainability（decisionTrace）

**User Story:** 作为企业用户/合规/调试者，我希望知道每个决策为什么是 ALLOW/DENY/MODIFY、由哪条规则链导致，以便支持企业采纳、调试与合规。

#### Acceptance Criteria

1. 每个 `PolicyDecision` SHALL 携带 `decisionTrace`：有序记录各评估环节的命中结果（如 `loom.attribution`、`exec.allowlist match`、`exec-approval trigger`、`sandbox constraint hit`、`cost threshold check`）。
2. WHEN 决策为 DENY 或 MODIFY THEN `decisionTrace` SHALL 标明触发该结论的具体环节与原因，使"为什么"可机器与人类阅读。
3. `decisionTrace` SHALL 随审计记录持久化，并可经 `/v1/policy/check` 在 dry-run 中返回。
4. `decisionTrace` SHALL NOT 包含明文凭证/密钥。

### Requirement 17: 决策可回放与策略模拟（Replay / Simulation）

**User Story:** 作为平台/安全负责人，我希望能对历史请求重放决策、模拟策略变更影响，以便安全地演进策略。

#### Acceptance Criteria

1. 审计记录 SHALL **按构造可回放决策**：保留足以对历史 `ToolRequest` 重跑 Policy Runtime 并得到相同 `PolicyDecision` 的输入快照。
2. 系统 SHALL 提供 **policy dry-run diff**：对一组历史请求用"当前策略"与"候选策略"分别评估并输出决策差异。
3. 决策回放/模拟 SHALL NOT 触发任何执行侧副作用（不重新运行有副作用的工具）；执行侧 replay 留后续期。
4. WHEN 模拟显示候选策略放宽了既有拒绝集合 THEN 系统 SHALL 显式标记该放宽项，要求人工确认。

### Requirement 18: Routing Intelligence（扩展 AOR，非新组件）

**User Story:** 作为平台，我希望工具/模型选路具备成本感知与 fallback 能力，以便系统在约束内做更优执行选择。

#### Acceptance Criteria

1. 选路 SHALL **扩展 AOR 既有 `Selector` / `SelectionStrategy`**（经 `policy-engine`），SHALL NOT 新建并行路由器。
2. v1 SHALL 支持把 `ExecutionConstraints.costLimit` 与 routing 策略对接（cost-aware 的最小形态）；tool/model 混合选路与 fallback tools 留 v1.x。
3. 选路决策 SHALL 进入 decisionTrace / 审计，可归因。

### Requirement 19: Feedback Signals（human-gated，绝不自动改写策略）

**User Story:** 作为维护者，我希望系统能从执行结果中**发现**失败模式并**建议**策略收紧，但任何策略变更都由人确认，以便系统可优化又不变黑盒。

#### Acceptance Criteria

1. 系统 MAY 从执行结果派生 **feedback signal**（失败模式检测、约束收紧建议、cross-tool 关联）。
2. 系统 SHALL NOT auto-apply / auto-mutate 任何策略或约束；feedback 仅产出**建议**，经人工 accept 才生效（继承 Loom `suggest→accept` 铁律）。
3. WHEN 产出 feedback 建议 THEN 系统 SHALL 附依据（关联的执行记录/decisionTrace）使建议可审查。
4. 本能力为 v1.x/v2；v1 SHALL 仅**预留接口与数据**（执行结果可被后续 feedback 模块消费），不实现自动学习。

### Requirement 20: 唯一编排器（AOR）+ Trace Layer（Fabric 不重建 Planner）

**User Story:** 作为架构负责人，我希望执行结构（DAG、排序、选路）只有一个权威来源 AOR，Fabric 只做策略叠加与执行记录，以避免双编排系统导致的执行顺序不一致与不可调试。

#### Acceptance Criteria

1. execution structure（DAG 生成、节点排序、选路）SHALL 唯一由 AOR（`Planner`/`ExecutionPlan`/`Selector`）产出；Fabric SHALL NOT 构图、排序、调度或实现 planner。
2. 单 tool 调用 SHALL 作为平凡 1 节点处理，SHALL NOT 经过 planner。
3. Fabric 的 `ExecutionGraphState` SHALL 是 AOR plan 的**投影**（policy overlay + execution trace），SHALL NOT 重新推导依赖或重排节点。
4. 投影图结构 SHALL 仅来自 AOR plan 的确定性结构，SHALL NOT 由 intent 决定（继承 Architecture Rule #1）。
5. Trace Layer SHALL 只做：①投影 AOR plan；②叠加 policy decision overlay；③记录 runtime execution trace（audit/replay/observability）。
6. 实际执行 SHALL 委托 TOL；Trace Layer SHALL NOT 执行工具。

### Requirement 21: 单一编译期决策点 + 门控不变量 + recompile 语义

**User Story:** 作为安全负责人，我希望策略只在编译期决策一次、运行期只强制执行、变更必须重编译，以保证执行确定性、消除 policy drift 与重复门控。

#### Acceptance Criteria

1. **唯一决策点**：policy 评估 SHALL 是**编译期**操作，对每个可执行节点产出一次 `PolicyDecision`（+ constraints + decisionTrace），并附着到该节点。
2. **runtime 不再评估**：执行期 SHALL NOT 重新评估 policy；TOL 仅 **enforce** 预计算的约束（sandbox/fs/network/timeout），此为强制非再决策。
3. **门控不变量**：WHEN 任一 `Tool`/`Agent` 节点进入执行 THEN 系统 SHALL 校验其已附带编译期 `PolicyDecision`；缺失 → 拒绝执行（不得隐式放行、不得 runtime 补判）。
4. **交互式审批前移**：WHEN 决策需要人工审批（ask-on-miss）THEN 该审批 SHALL 在 decide 阶段解析，执行只针对已解析决策启动。
5. **recompile 语义**：任何会改变执行结构或决策的变更（retry/rollback/新增节点）SHALL 触发**重新编译**（AOR 重规划 + 重新 decide），SHALL NOT 在 runtime 原地改图改策略；v1 不实现 runtime mutation engine。
6. 任何重编译 SHALL NOT 放宽既有拒绝集合/弱化约束，除非经新的 human-gated 决策；`decisionTrace` SHALL 绑定 `PolicyDecision`（非 `ExecutionGraphState`）。
7. 每次节点状态/执行事件 SHALL 进入 Trace Layer 供 audit/replay。
