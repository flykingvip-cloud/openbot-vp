# Design Document

> Feature: Development Supervisor（开发监督者）
> Requirements: `./requirements.md`

## Overview

Development Supervisor 是一个**网关运行时子系统**（`src/gateway/supervisor/**`），把 OpenBot 从「助手」升级为
「监督者」：它**编排**已有能力——用 cli-backend Worker 写代码、用 Fabric 受治理地跑验证、在隔离工作区内有界重试、
最终向用户报告——而**不重写**任何执行底座。

### 产品定位（CTO 评审定版）

OpenBot 不是 AI Chatbot，也不是 Agent Framework，而是 **Autonomous Supervisor Platform——「监督 AI 的 AI」**：
Cursor / Claude Code / Codex / Devin 都是「AI 做开发」；OpenBot 形成的是「**AI 监督 AI 做开发**」。
其差异化价值高于「再接一个新的编程 Agent」——监督逻辑一次建成，接第 N 个 Worker 不改（见 R10 / Property 11）。

### 冻结目标架构（canonical）

```
OpenBot
   ▼
Development Supervisor ── Planner · Validator · Retry Controller（引擎内部模块）
   ▼
Worker Runtime
   ▼
Worker Adapter Registry ──► Kiro · Codex · Claude Code（CLI Worker Adapters；未来 Docker/GitHub/Browser）
   ▼
Fabric Runtime（验证 service.execute + 审计）
   ▼
Git Adapter（worktree 隔离）
```

> 边界：**Loom = compile-time governance**（静态责任/归属，编译期信号）；**Fabric = runtime execution**（运行时执行+审计）。
> worktree 经 **Fabric Git Adapter**（运行时能力层 `src/fabric`），不耦合 `scripts/loom`（开发者工具层）。

核心回路（单决策、可机检、有界）：

```
        ┌──────────────────────── SupervisionLoop（有界）─────────────────────────┐
 plan → dispatch(Worker Runtime: start/logs/status) → validate(Fabric: service.execute) → judge
                ▲                                                            │
                └──── fixing: 失败证据作为下一轮 prompt ◄──────────────────────┘
 judge: passed → accepted | 触达停止条件 → escalated/budget_exhausted/max_iterations
```

设计铁律（继承评审与既有约束）：

- **职责单一边界**：Worker 执行 / Fabric 受治理执行+审计 / **Supervisor 拥有规划+验收判定+有界重试+报告**。
  **Fabric 不判定任务完成**（判定属 Supervisor）；Supervisor 不重写执行/审计/计费。
- **自治回路只跑验证类命令**（test/build/lint/读）；写副作用属 Worker 在隔离工作区内；外部副作用需人工确认。
- **有界**：迭代上限 + 预算上限 + 无进展检测，三道硬刹车，任一触发即停止并升级。
- **不放宽验收**：重试只许更严或不变（对齐 Fabric replay 的 relaxation 标记理念）。
- **运行时状态进运行时 store**，不写 `.loom/registry.yaml`；**不 `src→scripts` 耦合**。
- **feature-gated 默认 off**：off 时既有对话→Worker / Fabric / cli-backend 路径逐字节不变。

## Architecture

### 组件分层

```
                         ┌─────────────────────────────────────────────┐
 用户对话（建立/查询/abort）│         supervisor/api（gateway methods）      │
                         │  supervisor.task.{create,get,list,abort}      │
                         └───────────────────────┬─────────────────────┘
                                                 ▼
                         ┌─────────────────────────────────────────────┐
                         │        supervisor/engine（状态机驱动）          │
                         │  SupervisionLoop + judge + StopCondition       │
                         └───┬───────────────┬───────────────┬──────────┘
            dispatch         │      validate  │       report  │   escalate
                             ▼               ▼               ▼          ▼
                   ┌─────────────┐  ┌───────────────┐  ┌──────────┐  ┌─────────────┐
                   │ WorkerPort  │  │ ValidatorPort │  │ Reporter │  │ Escalator   │
                   │(Worker RT)  │  │(Fabric exec)  │  │(messaging)│  │(support-case)│
                   └─────────────┘  └───────────────┘  └──────────┘  └─────────────┘
                             │               │
                             └──── TaskWorkspace（共享 cwd / worktree）────┘
                                                 │
                         ┌─────────────────────────────────────────────┐
                         │ supervisor/store（运行时持久化 + 状态机迁移）    │
                         └─────────────────────────────────────────────┘
```

### 与既有子系统的接线点（复用，不重写）

| 端口          | 复用的既有实现                                                                                                                               | 接法                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| WorkerPort    | **Fabric Worker Runtime**（新增层，见下）→ CLI Worker Adapter 复用 cli-backend spawn（`runCliAgent`/process supervisor）+ 凭证注入（Task 6） | `worker.start(task)` 返回 `WorkerRun` 句柄；`status/logs/cancel` 长时驱动     |
| ValidatorPort | Fabric `getFabricService().execute`（`src/fabric/service.ts`）+ `generic.git/shell` adapter + `createProcessRunner`                          | `ToolRequest{ tool:{name:"generic.shell"}, input:{args, cwd:TaskWorkspace} }` |
| 工作区        | git worktree（运行时 helper，见 D-ISO）或 `ensureAgentWorkspace` 子目录                                                                      | 一任务一目录                                                                  |
| 预算          | cost-budget-billing + Fabric `costLimit`（`exceedsCostLimit`）+ Worker `usage`                                                               | 累计成本闸                                                                    |
| 升级          | support-case 升级链（daibai-super-steward 模式）                                                                                             | 失败/触顶时建单 + 上下文 bundle                                               |
| 报告          | 消息投递（外部渠道只收最终/摘要）+ agent-growth report 形态                                                                                  | 里程碑摘要 + 最终报告                                                         |
| 授权          | 既有 entitlement（`<backendId>/<model>` 授权集合，**模型面与 Worker 面共用同一授权口径**）                                                   | 建立任务前校验                                                                |
| 归因          | UsageAttribution（`cli-backend-usage-attribution.ts`）+ Fabric 审计                                                                          | 以 `taskId` correlation                                                       |

### 关键设计决策

- **D-ISO（工作区隔离，避免 src→scripts 耦合）**：loom-provisioning 的 worktree 能力在 `scripts/loom`，
  `src/gateway` 不得 import。方案：在 `src/gateway/supervisor/workspace.ts` 实现**最小运行时工作区管理器**——
  优先经 **Fabric `generic.git` adapter** 执行 `git worktree add <dir> <branch>`（受治理 + 审计，零新耦合）；
  无 git/worktree 条件时降级为 `ensureAgentWorkspace` 下的隔离子目录。Loom registry 仅作可选静态责任记录（不依赖）。
- **D-VAL（验证经 Fabric）**：验证命令一律走 Fabric，不在 supervisor 内直接 spawn——复用策略门控 + 审计 + 进程治理；
  Fabric DENY 的命令记为该步失败（不绕过）。判定（passed）在 supervisor。
- **D-WORKER（Worker 经 Fabric Worker Runtime，不直连 cli-runner）**：Supervisor **不**直接 import `runCliAgent`；
  而是消费 **Fabric Worker Runtime** 暴露的统一 `Worker` 接口（`start/status/cancel/logs`，见「Fabric Worker Runtime」节）。
  CLI Worker Adapter 在 Runtime 内部复用既有 cli-backend spawn（process supervisor / `runCliAgent` 内核）+ 凭证注入；
  会话续聊用 `cliSessionId` 维持多轮上下文（修复轮复用同一 worker 会话）。这样接第 N 个 Worker 时 Supervisor 逻辑不变。
- **D-EXECCTX（ExecutionContext 是唯一运行输入模型）**：Worker 定义只表达全局静态能力（能干什么/如何监督），**不承载**
  `credentialPolicy` / `executionPlacement`。每次派发前由 Resolver 层生成不可变 `ExecutionContext`：
  `Worker + identity + placement + attribution`。Supervisor Engine **MUST NOT** 根据 credential/placement 分支；它只调用
  `dispatch(worker, context)`、等待报告、执行 `judge(report)`。这样同一 Worker 可在不同租户/席位下组合
  `enterprise_shared + gateway`、`local_ide_login + node_agent`、未来 `enterprise_shared + node_agent` 等拓扑。
- **D-MODEL-COEXIST（模型面与 Worker 面并存，不回退已交付能力）**：cli-backend 现有的「模型面」
  （终端用户直聊 `<backendId>/<model>` → `isCliProvider` → `runCliAgent`，经 entitlement 授权，**已上线**）**保留不变**；
  本 spec **新增「Worker 面」**（Supervisor 经 Worker Runtime 驱动同一后端）。两面**共用同一份 cli-backend 配置**
  （command/args/output/sessionId/凭证）与**同一授权口径**，仅运行时句柄不同（一次性模型 run vs 长时 Worker run）。
  专家「Kiro 是执行器不是模型」的洞察在监督场景成立，故新增 Worker 面；但**不牺牲**已交付的直聊场景。
- **D-RESOLVER（凭证/落点是 pure Resolver Port，不是 runtime）**：`CredentialResolver` 与 `PlacementResolver` 是无状态、
  可缓存、可单测的纯端口；它们不拥有生命周期、不调度任务、不持久化 Worker 状态。唯一持有运行生命周期的是
  Worker Runtime。Resolver 失败返回结构化 degradation（默认 `escalate`），不得抛裸异常给 Engine。
- **D-LIVE（实时进度按能力降级，不过度承诺）**：现状 `runCliAgent` 非交互、跑完一次性解析最终输出（不流式）。
  Worker Runtime 的 `logs(runId)` 在 Worker **支持流式**（如 `codex/kiro exec --json` 逐行 jsonl）时增量解析并发
  `ExecutionEvent`（复用 Fabric streaming 映射 `src/fabric/streaming.ts` + `tool-events`）；对 `claude -p`（单 json）等
  **不支持流式**的 Worker，退化为**回合级**进度（dispatch 开始/结束 + 验证结果）。v1 不统一承诺逐步实时。
- **D-STORE（运行时持久化）**：`~/.openbot/supervisor/tasks/<taskId>.json`（原子写，参考 agent-growth `growth-status.json` 范式），
  含完整状态机快照，进程重启可恢复（resume 未完成任务）。**不写 `.loom/registry.yaml`**。
- **D-ASYNC（离场执行）**：引擎以**后台任务驱动**推进（不绑定单次请求生命周期）；复用 cron isolated-agent 的离场运行范式。
- **D-GATE（feature gate）**：`OPENBOT_SUPERVISOR_ENABLED` 或 `gateway.supervisor.enabled`；off → api 报 UNAVAILABLE，引擎不启动。
- **D-SAFE（安全）**：`AcceptanceCriteria` 命令进**验证 allowlist**（test/build/lint/typecheck 类）；
  自治回路不执行外部副作用命令（push/deploy/rm 等），如任务需要则置 `escalated` 走人工确认。

## Fabric Worker Runtime（新增层，专家评审采纳）

> 目标：让 **Worker 成为 Fabric 一等抽象**（与既有 tool Adapter Registry 平行），Supervisor 只认统一接口；
> 接第 5 / 第 100 个开发 Agent 时，监督逻辑零改动。CLI 只是其中一类 Adapter。

### 分层（修订后的目标架构）

```
Development Supervisor
  ↓ dispatch(worker, ExecutionContext)
Fabric Worker Runtime（唯一长时 Worker 生命周期）
  ├─ CredentialResolver（pure port → identity）
  ├─ PlacementResolver（pure port → executor + fallback）
  └─ Worker Adapter Registry（CLI / 未来 Docker / GitHub / Browser …）
       ↓
    WorkerExecutor
       ├─ GatewayWorkerExecutor → CLI Worker Adapter → cli-runner spawn（Claude / Codex / Kiro）
       └─ NodeAgentWorkerExecutor → Node Agent → 本机 Worker Adapter → Devin CLI / Cursor Agent / 本机 Claude

验证面仍走 Fabric Execution Runtime（tool 执行+审计）；静态责任信号仍来自 Loom/Fabric Policy。
```

正交关注点：

- `Worker`：能力定义（能干什么、如何被监督），全局静态。
- `CredentialPolicy`：身份来源（`enterprise_shared` / `local_ide_login` / P3 `seat_personal`），按租户/席位解析为 `identity`。
- `ExecutionPlacement`：执行落点（`gateway` / `node_agent`），按租户/席位/节点可用性解析为 executor。
- `Attribution`：成本与审计归因，是 identity + tenant scope 的投影，不另建 runtime。

### 双 surface：同一 CLI Backend 配置，两个运行面（CTO 评审定版）

```
                      CLI Backend Config（command/args/output/sessionId 适配；凭证由 ExecutionContext 注入）
                                        │
                  ┌─────────────────────┴─────────────────────┐
                  ▼                                            ▼
            Model Surface（已上线，保留）                 Worker Surface（本 spec 新增）
            <backendId>/<model>                          worker://<backendId>
                  │ entitlement 授权                          │ 同一授权口径
                  ▼                                            ▼
            runCliAgent（一次性 run）                    Worker Adapter（长时 run + logs/status/cancel）
                  └──────────────────┬─────────────────────────┘
                                     ▼
                               CLI Process（同一进程内核）
```

> 两面**共用同一份配置与授权**，仅运行时句柄不同。直接对话走 Model Surface（不回退）；Supervisor 走 Worker Surface。

### 统一 Worker 接口

```ts
export interface WorkerRunHandle {
  runId: string;
  workerId: string; // 非 CLI/session 概念（P0-2：cliSessionId 不在句柄上）
}
// 显式生命周期（P0-1）：phase 粗粒度 + outcome 细粒度；isTerminalStatus 是唯一终态判据
export type RunPhase = "pending" | "running" | "terminal";
export type RunOutcome = "succeeded" | "failed" | "cancelled" | "timed_out";
export interface RunStatus {
  phase: RunPhase;
  outcome?: RunOutcome; // 仅 phase==="terminal" 时存在
  exitCode?: number;
  summary?: string; // 脱敏结果摘要
  usage?: { input?: number; output?: number };
}
export function isTerminalStatus(s: RunStatus): boolean; // Retry Controller 依赖它，避免终态判断散落
export interface WorkerLogEvent {
  // 复用 Fabric ExecutionEvent 形态：stdout/stderr/status/progress
  type: "stdout" | "stderr" | "status" | "progress";
  data?: string;
  phase?: string;
}
export interface Worker {
  readonly id: string;
  readonly taskCapabilities: WorkerTaskCapability[]; // coding/edit/terminal/git/test …
  readonly control: WorkerControlCapability[]; // streaming/checkpoint/cancellable/interactive
  start(input: WorkerStartInput): Promise<WorkerRunHandle>;
  status(runId: string): Promise<RunStatus>;
  cancel(runId: string): Promise<void>; // M0 best-effort（P1-1）；真实终止协议留 M2
  logs(runId: string): AsyncIterable<WorkerLogEvent>; // 流式（能力降级见 D-LIVE）
}
export interface WorkerStartInput {
  task: { goal: string; prompt: string };
  workspaceDir: string;
  model?: string; // CLI 类把它映射为 modelArg
  continuityKey?: string; // 不透明续聊键（如 taskId）；CLI 适配器内部映射 cliSessionId（P0-2）
  timeoutMs: number;
  credentialEnv?: Record<string, string>; // 既有 SecretRef 解析结果
}
```

### ExecutionContext 与 Resolver Port（运行时解析层）

`ExecutionContext` 是一次 Worker 派发的**唯一运行单位**：per-run、immutable、脱敏持久化（只存 id/status，不存密钥值）。
Engine 创建/恢复任务时只保存足以重建 context 的 tenant/seat/worker/model scope；每轮 dispatch 前重新解析，避免复用过期
Node Agent 登录态或已轮换凭证。

```ts
export type CredentialPolicy = "enterprise_shared" | "local_ide_login" | "seat_personal"; // seat_personal: P3
export type ExecutionPlacement = "gateway" | "node_agent";
export type PlacementFallback = "escalate" | "queue_until_online" | "deny";

export type CredentialStatus = "missing" | "configured" | "validated" | "expired" | "invalid";
export interface ResolvedIdentity {
  policy: CredentialPolicy;
  status: CredentialStatus;
  /** SecretRef 解析结果，仅 gateway + enterprise_shared/seat_personal 使用；永不持久化/报告。 */
  credentialEnv?: Record<string, string>;
  credentialId?: string;
}

export interface ResolvedPlacement {
  placement: ExecutionPlacement;
  executor: "gateway" | "node_agent";
  nodeAgentId?: string;
  fallback: PlacementFallback; // default: "escalate"
}

export interface ExecutionAttribution {
  tenantId: string;
  userId?: string;
  seatId?: string;
  credentialId?: string;
  workerId: string;
  model?: string;
}

export interface ExecutionContext {
  identity: ResolvedIdentity;
  placement: ResolvedPlacement;
  attribution: ExecutionAttribution;
}

export interface CredentialResolver {
  resolve(input: {
    tenantId: string;
    seatId?: string;
    workerId: string;
    model?: string;
    policy: CredentialPolicy;
  }): Promise<ResolvedIdentity>;
}

export interface PlacementResolver {
  resolve(input: {
    tenantId: string;
    seatId?: string;
    workerId: string;
    requested: ExecutionPlacement;
    fallback?: PlacementFallback;
  }): Promise<ResolvedPlacement | { fallback: PlacementFallback; reason: string }>;
}
```

- `enterprise_shared + gateway`：解析企业 SecretRef → `credentialEnv` → `GatewayWorkerExecutor` 注入 CLI env。
- `local_ide_login + node_agent`：不解析平台 Key；`NodeAgentWorkerExecutor` 依赖员工本机已登录 CLI。
- `enterprise_shared + node_agent`（未来 VDI）：身份仍来自企业 SecretRef，但执行由 Node Agent 完成。
- `seat_personal + gateway`（P3）：席位 SecretRef 覆盖企业共享；当前阶段不实现，避免 billing/identity ambiguity。
- `local_ide_login + gateway` 默认不推荐；除非 gateway host 本身代表某个席位并可证明登录态，否则 Resolver 返回 `escalate`。

### Worker Adapter Registry

- 与 `src/fabric/adapter-registry.ts`（tool 适配器）**平行**新增 `WorkerAdapterRegistry`：`register/resolve(workerId)/list` + `findByCapability({taskCapabilities?,control?})`（P1-2：Worker Selection 的种子），schema 校验 + 去重；未命中 `resolve` 返回 null（无静默）。
- `createCliWorkerAdapter(backendId, cliBackendConfig)`：把统一 `Worker` 接口映射到既有 cli-backend spawn——
  `start` = 流式 spawn（process supervisor）+ `credentialEnv` 注入；`logs` = 按 `statusParser`（jsonl 逐行 / json 终态）增量解析；
  `status` = 进程态 + 退出码;`cancel` = 终止该 scope。**复用 cli-runner 内核，不另写 spawn。**
- 未来 `createDockerWorkerAdapter` / `createGithubWorkerAdapter` 等只需实现同一接口,Supervisor 与 Registry 不变。

### Worker 配置（cli-backend 增量字段，additive）

在既有 `CliBackendConfig` 上**追加可选** Worker 元数据（不破坏模型面）：

```jsonc
{
  // …既有 command/args/output/sessionIdFields/modelCatalog/凭证 不变…
  "worker": {
    // 任务能力（能干什么）— 与 modelCatalog 的 streaming/tools/vision 不同维度
    "taskCapabilities": ["coding", "edit", "terminal", "git", "test"],
    // 运行控制能力（怎么被监督）— 决定监督降级策略（CTO 评审采纳）
    "control": ["streaming", "cancellable"], // ∈ streaming|checkpoint|cancellable|interactive
    "statusParser": "jsonl", // 复用 output 语义，显式化
    "timeoutMs": 3600000,
    "retryableExitCodes": [1, 2], // 供 Retry Controller 判定可重试
  },
}
```

```ts
// 两条正交的能力轴：
export type WorkerTaskCapability = "coding" | "edit" | "terminal" | "git" | "test";
export type WorkerControlCapability = "streaming" | "checkpoint" | "cancellable" | "interactive";
```

- **监督降级（D-LIVE，按 `control`）**：含 `streaming` → **实时监督**（`logs` 增量发 `ExecutionEvent`）；
  不含 `streaming` → **轮询监督**（周期 `status` 拉取，回合级阶段）。含 `cancellable` → abort 可即时 `cancel`，否则等本轮自然结束/超时。
  例：Codex `{streaming, cancellable}`、Kiro `{streaming}`、Claude `-p` `{}`（轮询 + 不可即时取消）。
- 缺省 `worker` 块 → 该后端仅有模型面，不进 Worker Runtime（向后兼容）。

### 与 Policy / 审计的关系

- Worker 的**运行**（写代码）属执行,经 Policy 的 method-scope/凭证治理;但 Worker 在隔离工作区内的文件写入**不是** Fabric tool 调用,
  故 Worker Runtime 自身负责进程治理(timeout/cancel/scope)+ 用量归因,**验证**才回到 Fabric tool 执行面(`service.execute`)。
- 这保持「Worker 执行 / Fabric tool 受治理执行 + 审计 / Supervisor 判定」的职责边界不变。

## Components and Interfaces

### supervisor/types.ts（契约）

```ts
export type SupervisedTaskState =
  | "planned"
  | "dispatched"
  | "executing"
  | "validating"
  | "fixing"
  | "accepted"
  | "escalated"
  | "budget_exhausted"
  | "max_iterations"
  | "timed_out"
  | "aborted"
  | "failed";

export interface AcceptanceCriteria {
  /** 可机检验证步骤（顺序执行）。 */
  steps: Array<{
    id: string;
    /** 经 Fabric 执行的命令（argv）。 */
    argv: string[];
    /** required=true 的步骤失败即整体失败；false 为信息性。 */
    required: boolean;
    /** 通过条件：默认 exitCode===0；可扩展覆盖率/产物存在。 */
    expect?: { exitCode?: number };
  }>;
  source: "user" | "template" | "repo-detected";
}

export interface ValidationStepResult {
  id: string;
  argv: string[];
  exitCode: number | null;
  ok: boolean;
  stdoutHash?: string;
  stderrSummary?: string; // 脱敏摘要
  durationMs: number;
  /** 该步被 Fabric 策略拒绝（非执行失败）。 */
  denied?: boolean;
}

export interface ValidationReport {
  steps: ValidationStepResult[];
  passed: boolean;
  at: string;
}

export interface SupervisionIteration {
  index: number;
  workerSummary?: string; // Worker 结果摘要（脱敏）
  usage?: { input?: number; output?: number };
  validation?: ValidationReport;
  startedAt: string;
  endedAt?: string;
}

export interface SupervisedTask {
  taskId: string;
  goal: string;
  tenantId?: string;
  userId?: string;
  agentId?: string;
  worker: { backendId: string; model?: string };
  workspace: { dir: string; kind: "worktree" | "subdir"; branch?: string };
  acceptance: AcceptanceCriteria;
  state: SupervisedTaskState;
  iterations: SupervisionIteration[];
  budget: SupervisorBudget & { spentCostUsd: number; startedAtMs?: number }; // D-BUDGET
  cliSessionId?: string; // worker 会话续聊
  createdAt: string;
  updatedAt: string;
  escalationRef?: string; // support-case id
}
```

### 端口接口（依赖注入，便于单测）

```ts
export interface WorkerPort {
  /** 经 Fabric Worker Runtime 驱动一轮 Worker（start→logs/status→收敛）。 */
  dispatch(input: {
    task: SupervisedTask;
    workerId: string;
    context: ExecutionContext;
    prompt: string;
    onProgress?: (event: WorkerLogEvent) => void; // D-LIVE：Worker 支持流式时回调
  }): Promise<{
    summary: string;
    cliSessionId?: string;
    exitCode?: number;
    usage?: { input?: number; output?: number };
  }>;
}

export interface WorkerAuthProbe {
  probe(input: {
    workerId: string;
    placement: ResolvedPlacement;
    identity: ResolvedIdentity;
  }): Promise<{
    installed: boolean;
    authenticated: boolean;
    status: CredentialStatus;
    expiresAt?: string;
    source: "probe" | "declared";
    reason?: string;
  }>;
}

export interface ValidatorPort {
  validate(input: {
    task: SupervisedTask;
    criteria: AcceptanceCriteria;
  }): Promise<ValidationReport>;
}

export interface ReporterPort {
  taskStarted(task: SupervisedTask): Promise<void>;
  milestone(task: SupervisedTask, summary: string): Promise<void>;
  finalReport(task: SupervisedTask): Promise<void>;
}

export interface EscalatorPort {
  escalate(task: SupervisedTask, reason: string): Promise<{ ref: string }>;
}

export interface WorkspacePort {
  ensure(task: { taskId: string; agentId?: string }): Promise<SupervisedTask["workspace"]>;
  recycle?(workspace: SupervisedTask["workspace"]): Promise<void>;
}
```

默认实现：

- `createWorkerRuntimePort(workerRuntime)` → 经 **Fabric Worker Runtime** 的统一 `Worker` 接口 `start`，
  消费 `logs`（转 `onProgress`/`ExecutionEvent`，D-LIVE 能力降级）+ `status` 收敛；CLI Worker Adapter 内部复用
  cli-backend spawn（`provider=backendId, model, workspaceDir, cliSessionId, credentialEnv`）或委托 Node Agent。
  **不直接 import `runCliAgent`，不根据 placement 在 Engine 内分支。**
- `createCredentialResolver(...)` → 纯解析租户/席位身份来源；返回 `CredentialStatus` + 可注入 env（若适用）。
- `createPlacementResolver(...)` → 纯解析目标 executor；Node Agent 离线/陈旧/未授权时默认返回 `{fallback:"escalate", reason}`。
- `createWorkerAuthProbe(...)` → adapter 注册的探针集合（如 Devin/Cursor/Claude 各自 probe），只返回安装/登录/过期状态，
  不泄露 token/SecretRef；平台只读健康面消费该状态。
- `createFabricValidatorPort(getFabricService)` → 逐 step 调 `service.execute`，组装 `ValidationReport`，**判定 passed 在此端口外（engine）**。
- `createMessagingReporterPort(deliver)` → 复用消息投递；只发摘要/最终。
- `createSupportCaseEscalatorPort()` → 复用 support-case 建单 + 上下文 bundle。
- `createWorktreeWorkspacePort(getFabricService)` → 经 Fabric `generic.git` 跑 `git worktree add`；降级子目录。

### supervisor/engine.ts（状态机）

**Supervisor Engine 内部模块（CTO 评审命名，均为引擎内部模块，非 robot-skills）：**

| 模块             | 职责                                                                                                     | 对应端口/落点                     |
| ---------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Planner          | 规划：捕获/推导 `AcceptanceCriteria`，拆解修复轮 prompt                                                  | `acceptance` 构建 + fixing prompt |
| Worker Manager   | 以 `ExecutionContext` 驱动一轮（start/logs/status/cancel）+ 进度降级；不得读取/分支 credential/placement | `WorkerPort`（→ Worker Runtime）  |
| Validator        | 经 Fabric 跑验证步骤并产 `ValidationReport`（判定在 engine `judge`）                                     | `ValidatorPort`                   |
| Retry Controller | 有界重试 + `nextStop`（迭代/预算/无进展）+ `retryableExitCodes`                                          | engine `fixing`/`nextStop`        |
| Reporter         | 里程碑摘要 + 最终交付报告；失败转 Escalator                                                              | `ReporterPort` / `EscalatorPort`  |

```ts
// 纯/可注入：所有副作用经端口；judge/stopCondition 为纯函数，便于 PBT。
export function judge(report: ValidationReport, criteria: AcceptanceCriteria): boolean;
export function nextStop(task: SupervisedTask): SupervisedTaskState | null; // 触达则返回终态
export async function runSupervisionLoop(task: SupervisedTask, ports: {...}, store): Promise<SupervisedTask>;
```

引擎一轮：`ensure workspace → resolve ExecutionContext → dispatch(worker, ctx, prompt) → persist → validate → judge`
→ `passed? accepted : (nextStop? terminal+escalate : fixing→下一轮)`；每步迁移经 store 原子持久化 + Reporter 里程碑。
`ExecutionContext` 每轮现用现解，解析结果随 iteration 摘要脱敏记录；Engine 只处理成功 context 或 fallback 终态，不直接访问
SecretRef、Node Agent token、CLI 登录态细节。

### supervisor/store.ts

- `~/.openbot/supervisor/tasks/<taskId>.json`，原子写（temp+rename）+ 进程内按 taskId 串行写队列。
- `create/get/list/update/listActive`；启动时 `resumeActive()` 恢复未终止任务（D-ASYNC）。

### supervisor/api（gateway methods）

| 方法                     | scope | 说明                                                    |
| ------------------------ | ----- | ------------------------------------------------------- |
| `supervisor.task.create` | WRITE | 建任务（校验 worker 授权 + 捕获验收标准）→ 异步启动回路 |
| `supervisor.task.get`    | READ  | 任务快照（状态/迭代/报告）                              |
| `supervisor.task.list`   | READ  | 按 tenant/user 列表                                     |
| `supervisor.task.abort`  | WRITE | 置 aborted，停止后续派发/验证                           |

注册沿用既有 `server-methods.ts` spread + `server-methods-list.ts` + `method-scopes.ts`（追加式，避让共享热文件）。

## State Machine

```
planned ──create──▶ dispatched ──worker──▶ executing ──done──▶ validating
   │                                                              │
   │                                              judge passed────┼────▶ accepted（终）
   │                                              judge failed    │
   │                                                              ▼
   │                                        nextStop? ──yes──▶ escalated / budget_exhausted / max_iterations（终）
   │                                            │no
   │                                            ▼
   └───────────────────────────────────  fixing ──▶ executing（下一轮，prompt=失败证据）
 任意非终态 ──abort──▶ aborted（终）；worker 鉴权失败 ──▶ escalated（终）
```

- 合法迁移表集中定义；非法迁移抛错（沿用既有状态机守卫风格，如 Fabric `run-state.ts`）。
- `nextStop(task)`：`iterations.length >= maxIterations` → `max_iterations`；`spentCostUsd >= maxCostUsd` → `budget_exhausted`；
  无进展（连续两轮 `failed step id 集合`相同）→ 触发 escalate。

## Data Models

- 持久化：`SupervisedTask`（上）；脱敏后存储（无明文密钥；stdout 仅哈希/摘要）。
- 归因：每轮 Worker 用量 + 每次 Validator 执行经 Fabric 审计，均带 `correlationId = taskId`；
  复用 `recordCliBackendUsage` 写 `{tenantId,userId,backendId,credentialId?,model,executionId=taskId+iter}`。

## Reuse Map（净新增 vs 复用）

| 能力                                                      | 状态                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Worker 执行 / 会话 / 凭证                                 | 复用 cli-backend + `ExecutionContext`（identity/placement/attribution）  |
| 执行落点解析                                              | 新增 `PlacementResolver` pure port；gateway / Node Agent executor 双实现 |
| Worker 登录态/安装态探测                                  | 新增 `WorkerAuthProbe`，平台只读健康状态，不暴露 token/key               |
| 受治理验证执行 / 审计 / 进程治理                          | 复用 Fabric（service.execute + processRunner + adapters）                |
| 预算 / 成本估算                                           | 复用 cost-budget + Fabric costLimit                                      |
| 升级到人                                                  | 复用 support-case 链                                                     |
| 报告投递                                                  | 复用消息投递 + agent-growth report 形态                                  |
| 模型授权                                                  | 复用 entitlement                                                         |
| **状态机 + 验收判定 + 有界重试 + 工作区编排 + api/store** | **本 spec 净新增**                                                       |

## Error Handling

- Worker 缺凭证/鉴权失败 → 终止 + 升级（不计修复配额，R3.5）；按 `CredentialPolicy` 分流引导：
  `enterprise_shared` 指向企业管理员配置/校验 SecretRef，`local_ide_login` 指向员工本机 IDE 登录态修复。
- Placement 解析失败默认 `fallback:"escalate"`（安全优先）；`queue_until_online` 仅在租户/任务显式允许时使用。
- Node Agent failure model：
  - `offline`：Node Agent 无心跳或不可达 → escalate（默认）或显式 queue。
  - `stale_session`：Node Agent 会话/版本过旧 → escalate，并提示重连/升级客户端。
  - `auth_expired`：`WorkerAuthProbe.authenticated=false` 或 `expiresAt` 过期 → escalate，并提示本机重新登录。
  - `not_installed`：目标 CLI 不存在 → escalate，并提示安装/路径配置。
  - `policy_denied`：租户/席位不允许该 placement 或 worker → deny/escalate，绝不 fallback 到 gateway 偷跑。
- Validator 命令被 Fabric DENY 或二进制缺失 → 该步 `denied/fail`，fail-safe 不记通过（R4.5）。
- 引擎/端口异常 → 任务置 `failed` + 升级；store 始终保留最后一致快照（崩溃可恢复）。
- abort 与回路并发 → 以 store 原子状态为准；终态不可被回路覆盖。

## Testing Strategy

- **纯函数（PBT，fast-check）**：`judge`（required 全过才 passed）、`nextStop`（迭代/预算/无进展边界）、
  状态机合法/非法迁移、不放宽验收（候选验收只许更严）、`CredentialResolver`/`PlacementResolver` 组合矩阵。
- **端口契约（注入 fake）**：WorkerPort/ValidatorPort/Reporter/Escalator/Workspace/Resolver/AuthProbe 各自单测。
- **引擎集成（全 fake 端口）**：单轮通过→accepted；失败→fixing→重试→通过；触达 maxIterations→escalated；
  预算超限→budget_exhausted；abort 中断；worker 鉴权失败→escalated；Node Agent offline/stale/auth_expired→默认 escalated。
- **Fabric ValidatorPort 集成**：用 wiring.test 的 fake invoker / fake spawn 验证「命令在 cwd 跑 + DENY 记失败 + 报告组装」。
- **零回归**：feature off → api UNAVAILABLE，引擎不注册，既有路径无影响（参考 Fabric feature gate 测试）。
- 测试命令：`OPENBOT_TEST_PROFILE=low npx vitest run src/gateway/supervisor/...`。

## Security & Governance

- 自治回路命令限验证类 allowlist；外部副作用→人工确认（R6.5）。
- 全部验证执行经 Fabric 策略 + 审计；凭证经 `CredentialResolver` → 既有 SecretRef 注入，不旁路（R3.4）。
- 平台只读面只展示 `CredentialStatus`/WorkerAuthProbe 状态（configured/validated/expired/invalid/missing 等），不返回 API Key、token、
  SecretRef 目标值或 Node Agent 会话材料。
- 写 api 受 WRITE scope + 审计；任务归因可计费/可追溯（R8）。
- 运行时 store 脱敏；不写 `.loom/registry.yaml`；不 `src→scripts` 耦合（R9.4）。

## Correctness Properties

> 可机检不变量（PBT/单测守护），编号供 tasks.md 与测试引用。

### Property 1: 验收判定单调

`judge(report, criteria)===true` 当且仅当所有 `required` step `ok===true`；增加失败的 required step 绝不使 `passed` 由 false 变 true。

**Validates: Requirements 4.3, 6.1**

### Property 2: 不放宽验收

重试轮使用的 `AcceptanceCriteria` 必须等于或严于建立时（required 集合不缩小、expect 不放松）；任何放宽需人工确认（R5.5）。

**Validates: Requirements 5.5**

### Property 3: 有界终止

对任意输入序列，回路必在有限步内进入终态——`iterations.length` 严格递增且 `>= maxIterations` 或 `spentCostUsd >= maxCostUsd` 或无进展 任一成立即停止（R5.2/5.3/5.4）。

**Validates: Requirements 5.2, 5.3, 5.4**

### Property 4: 验证经 Fabric，判定在外

每个验证 step 都对应一次 Fabric `service.execute`；Fabric 仅返回执行结果，`passed` 永不由 Fabric 计算（职责边界，R4.3）。

**Validates: Requirements 4.1, 4.3**

### Property 5: fail-safe 验证

被 Fabric DENY 或无法执行的 step 记为 `ok=false`，绝不记为通过（R4.5）。

**Validates: Requirements 4.2, 4.5**

### Property 6: 状态机合法性

仅允许迁移表内的迁移；终态不可被回路覆盖；abort 在任意非终态可达 `aborted`（R6.3/6.4）。

**Validates: Requirements 6.3, 6.4**

### Property 7: 零回归

feature off 时不注册 api、不启动引擎、不触达任何既有执行路径（R9.1）。

**Validates: Requirements 9.1**

### Property 8: 脱敏

持久化与报告中不出现明文密钥；stdout 仅哈希/截断（R4.4/R7.5）。

**Validates: Requirements 4.4, 7.5**

### Property 9: 凭证不旁路

Worker 凭证经既有 SecretRef 注入解析；Supervisor 不读取/不缓存明文（R3.4）。

**Validates: Requirements 3.4**

### Property 10: 自治回路无外部副作用

自治回路执行的命令限验证类 allowlist；外部副作用命令一律走升级人工确认（R6.5）。

**Validates: Requirements 6.5**

### Property 11: Worker 抽象稳定

Supervisor 引擎仅依赖统一 `Worker` 接口与 `WorkerAdapterRegistry`；新增/替换某类 Worker（CLI/Docker/…）不改动引擎代码（编译期可验：引擎不 import 具体 adapter）。

**Validates: Requirements 10.4, 10.5**

### Property 12: ExecutionContext 隔离

`Worker` 定义不包含 `credentialPolicy` / `executionPlacement`；每次派发只接受 per-run immutable `ExecutionContext`。
Supervisor Engine 不读取 SecretRef、token、Node Agent 会话材料，也不根据 placement 分支（编译期可验：engine 不 import executor 实现）。

**Validates: Requirements 3.4, 7.5, 10.4**

### Property 13: Resolver 纯端口

`CredentialResolver` 与 `PlacementResolver` 不持有任务生命周期，不调度 Worker，不写 supervisor store；相同输入（扣除外部探针状态快照）
产生相同结构化输出。Resolver 失败必须返回 degradation/fallback，不抛裸异常给 Engine。

**Validates: Requirements 6.1, 9.4, 10.5**

### Property 14: Node Agent fail-safe

Node Agent 离线、会话陈旧、CLI 未安装、登录过期或策略拒绝时，默认进入 `escalated`/`deny`，绝不静默 fallback 到 gateway 或注入错误身份。

**Validates: Requirements 6.1, 6.4, 7.5**

## Requirements Traceability

| Requirement          | 设计落点                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| R1 任务建立/验收捕获 | `supervisor.task.create` + `AcceptanceCriteria`（user/template/repo-detected） + store                                                  |
| R2 隔离工作区        | `WorkspacePort`（D-ISO：Fabric git worktree / 子目录）                                                                                  |
| R3 Worker 派发       | `WorkerPort` → **Fabric Worker Runtime** + `ExecutionContext` + CLI/Node Agent executor + 会话续聊 + 凭证复用                           |
| R4 验证（Fabric）    | `ValidatorPort`（service.execute）+ `ValidationReport` + judge 在 engine                                                                |
| R5 有界重试          | engine `fixing` + `nextStop` + 不放宽（P2）                                                                                             |
| R6 停止/验收/升级    | 状态机终态 + `EscalatorPort`（support-case）                                                                                            |
| R7 跟踪/报告         | `ReporterPort`（消息投递，摘要/最终）                                                                                                   |
| R8 审计/归因         | `ExecutionContext.attribution` + `recordCliBackendUsage` + Fabric 审计（correlation=taskId）                                            |
| R9 特性门/零回归     | `OPENBOT_SUPERVISOR_ENABLED` + 追加式注册（P7）                                                                                         |
| R10 统一 Worker 抽象 | Fabric Worker Runtime（`Worker` 接口 + `WorkerAdapterRegistry` + `ExecutionContext` + executor ports）+ cli-backend `worker` 配置（M0） |
| R11 实时监督         | Worker Runtime `logs` 增量解析 → `ExecutionEvent`（D-LIVE 能力降级）                                                                    |

## Rollout（建议阶段，落到 tasks.md 时细化）

- **M0（前置）**：Fabric Worker Runtime —— 统一 `Worker` 接口 + `WorkerAdapterRegistry` + `createCliWorkerAdapter`（复用 cli-backend spawn + 流式 logs）+ cli-backend 增量 `worker` 配置字段。
- **M0.5**：`ExecutionContext` schema + `CredentialResolver` / `PlacementResolver` pure ports + `WorkerAuthProbe` + GatewayWorkerExecutor（默认 `enterprise_shared + gateway`）。
- **M1**：types + store + 单轮引擎（resolve context→dispatch→validate→judge，无重试）+ WorkerPort（消费 M0/M0.5）/ValidatorPort 默认实现 + feature gate。
- **M2**：有界重试 + fixing prompt + nextStop（迭代/预算/无进展）+ Escalator。
- **M3**：Reporter（里程碑/最终报告）+ api（create/get/list/abort）+ 归因/审计 + resumeActive。
- **M4（可选）**：平台/员工端任务看板 UI；任务模板（验收标准预设）。
- **M5（Node Agent）**：NodeAgentWorkerExecutor + Node Agent 心跳/版本/权限握手 + local IDE auth probe；默认 fallback=escalate。

## Frozen Decisions（CTO 评审定版，原 Open Questions 已收敛）

### D-WS（工作区：Provider 抽象 + worktree 优先降级子目录，禁共享树）

Worker 只看见 `Workspace { root: string }`，不感知 worktree/目录差异。

```ts
export interface Workspace {
  id: string;
  root: string;
  kind: "worktree" | "directory";
  branch?: string;
}
export interface WorkspaceProvider {
  create(task): Promise<Workspace>;
  destroy(task): Promise<void>;
}
```

- `WorktreeProvider`（经 Fabric `generic.git` 跑 `git worktree add`）/ `DirectoryProvider`（隔离子目录，`ensureAgentWorkspace`）。
- 默认 `CompositeWorkspaceProvider`：**try worktree → 失败 fallback directory**；**禁止共享工作树**（多任务绝不同目录）。

### D-BUDGET（预算策略：默认值 + 租户可配 + 任务只能收紧）

```ts
export interface SupervisorBudget {
  maxIterations: number;
  maxCostUsd: number;
  maxDurationMinutes: number;
}
```

- 系统默认：`{ maxIterations: 5, maxCostUsd: 5, maxDurationMinutes: 30 }`。
- **租户可覆盖**（平台/企业配置）；**任务可进一步收紧，不可放宽租户上限**（解析时 `min(taskLimit, tenantLimit)`）。
- 新增终止态 `timed_out`（`maxDurationMinutes` 触达）；`nextStop` 纳入时长闸。

### D-VAL-NODE（验收探测：MVP 仅 Node，留 ValidationAdapter 扩展位）

```ts
export interface ValidationAdapter {
  detect(repoRoot): boolean;
  plan(repoRoot): AcceptanceCriteria;
}
```

- M0/M1 仅 `NodeValidationAdapter`：探测 `package.json`，采用其 `test`/`lint`/`build` 脚本（存在才纳入，退出码 0 为通过）。
- 不在 MVP 引入 Python/Go/Rust/Java；未来加 `PythonValidationAdapter` 等只实现同接口。**做的是 Supervisor Runtime,不是 Universal CI System。**
- **P1-4**：`validator.ts` 经**注册的 `ValidationAdapter` 列表**派发（首个 `detect()` 命中者 `plan()`），**禁止** `if node / if python` 散落分支；`AcceptanceCriteria` 即 ValidationPlan（`steps[]`）。

### D-DRIVE（离场驱动：M0/M1 复用 cron tick，M2+ 独立 Runner）

- **M0/M1**：复用 cron / isolated-agent —— `supervisor.tick(taskId)` 一次推进：检查 Worker → 检查预算/时长 → 检查验证 → 决定重试 → 更新状态。
  **不**在 M0 引入 heartbeat/lease/recovery/failover（避免掉进分布式调度泥潭）。
- **M2+**：当出现 1000+ 并发任务，再引入独立 **Supervisor Runner**（Task Queue → Lease → Supervisor Worker）。

> 第一性验证点（CTO 强调）：最大未知数不在 Loom/Fabric/Policy/Provisioning，而在 **Kiro/Codex/Claude 能否真的被统一抽象成 Worker**。
> 因此 M0（Fabric Worker Runtime）是整个 Autonomous Supervisor Platform 的验证基石，优先落地。
