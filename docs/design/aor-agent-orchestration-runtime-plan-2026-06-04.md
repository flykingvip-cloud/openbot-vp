# AOR（Agent Orchestration Runtime）定版方案与落地执行计划（2026-06-04）

## 文档定位

本文不是产品构想，而是面向专家团队评审后、可直接进入排期的**架构适配 + 分阶段执行**定版文档。

它要回答一个创业项目最容易失败的问题：

> 如何借助 OpenBot 已有生态形成独立商业化产品，而不是为了产品去改造（最终 Fork）生态。

本文遵循三条原则：

- 冻结已确认正确的定位与边界。
- 修正概念方案里定义不清的部分（成功率、Task 理解、能力路由）。
- 给出落到 OpenBot 现有公共接口的可执行计划，不碰 core 内部实现。

## 一、最核心结论：AOR 长在 OpenBot 之上，是约束而非选择

专家把「AOR 不该改 Core，而该长在 OpenBot 之上」列为项目生死线。代码层面有比观点更强的证据——`VISION.md` 的「What We Will Not Merge」明确列出两条：

- `Agent-hierarchy frameworks (manager-of-managers / nested planner trees) as a default architecture`
- `Heavy orchestration layers that duplicate existing agent and tool infrastructure`

即：即便我们想把 AOR 合进 core，上游也不会接受。于是「不 Fork、长在之上」从团队自律升级为上游强制边界。

### 1.1 唯一契约（定版，不再讨论）

AOR 与 OpenBot 的耦合面只允许以下三条公共接口：

1. Gateway JSON-RPC：`agent` / `agent.wait` / `usage.cost` / `sessions.usage`
2. `openclaw/plugin-sdk`（工具、渠道、provider 扩展）
3. OpenAI 兼容 HTTP：`POST /v1/chat/completions`

**禁止**：AOR 任何模块 `import` OpenBot 内部实现（尤其 `src/agents/pi-embedded-*`、`src/agents/model-fallback.ts` 等）。

### 1.2 边界机器化强制

复用仓库正在建设的架构守卫（`scripts/check-architecture-manifest.ts`、`scripts/architecture/public-export-surface-verifier.ts`）：把 OpenBot 内部模块加入 AOR 的禁止依赖清单，CI 阻断任何「偷偷 Fork」的退化。

## 二、OpenBot 现状核查（落点依据）

以下为代码核实结果，作为本方案所有「复用」结论的依据。

### 2.1 模型管理（可复用，但缺路由）

- 模型元数据：`ModelDefinitionConfig`（`src/config/types.models.ts`），`cost` 单位为「每百万 token」。
- 选模顺序：显式 `primary → fallbacks → auth profile 轮换`（`src/agents/model-selection.ts`、`src/agents/model-fallback.ts`）。
- 轻量目录：`ModelCatalogEntry`（`src/agents/model-catalog.ts`），**不含 cost / latency**。
- 失败分类驱动 failover：`src/agents/failover-error.ts`。
- **缺口**：无 latency/SLA 字段；无按成本/质量/负载的自动路由器。

### 2.2 Agent 执行（可复用，作为 Backend）

- 主路径：`runEmbeddedPiAgent` → `runEmbeddedAttempt` → Pi `createAgentSession().prompt()`，工具循环在 `@mariozechner/pi-coding-agent` 内（`src/agents/pi-embedded-runner/`）。
- 入口：Gateway `agent`（`src/gateway/server-methods/agent.ts`）、`agent.wait`（`agent-job.ts`）、CLI `agent`。
- 事件流：`emitAgentEvent`，流类型 `lifecycle | tool | assistant | error`（`src/infra/agent-events.ts`）。
- 持久化：session JSONL（`~/.openbot/agents/<id>/sessions/<sessionId>.jsonl`，树形 parentId）。
- **缺口**：无一等公民 Task Graph / Planner；`VISION.md` 明确不默认采用 planner 树。

### 2.3 能力层（已存在雏形，需对齐）

- Capability Center / `skills/`（`VISION.md`；UI `capability-governance/.../dispatcher.ts`）。
- 插件工具：`registerTool`（`src/plugins/registry-registrars/tools.ts`）。
- MCP：经 `mcporter` 桥接。
- Lobster：确定性 pipeline + 审批 + resume（`docs/tools/lobster.md`）。

### 2.4 成本与商业化底座（可对接）

- LLM 成本：配置 `cost` + transcript usage（`src/utils/usage-format.ts`、`src/infra/session-cost-usage.ts`）。
- 企业计量账本：`src/gateway/billing/`（`usage-records-store.ts`、`engine.ts#computeUsageCost`）。
- 成本预算 UI：`ui/src/ui/views/cost-budget/`、`ModelUsageAnalyticsSection`。
- 企业席位/多租户雏形：`src/gateway/enterprise-seat-assets*.ts`。

### 2.5 OpenAI 兼容入口（冷启动用）

- `src/gateway/openai-http.ts`，开关 `gateway.http.endpoints.chatCompletions.enabled`。

## 三、定版总体架构（含专家三项增量）

```
┌──────────────────────── Control Plane（商业化 / 优化平台）────────────────────────┐
│ Budget · Policy · Observability · Optimization Reports · Billing · Multi-tenant   │
└───────────────────────────────────────────────────────────────────────────────────┘
                                       ▲ 指标 / 账单 / 策略
Task ─► Task Parser ─► Planner(DAG) ─► Capability Registry ─► Model/Capability Selector
  │        │理解,非切分      │并行/依赖/重试       │任务路由到"能力"          │打分选模型
  │        └► TaskType Registry         └► Skill{in/out schema, costProfile}        ▼
  │           (任务本体/护城河)                                            Execution Backend
  │                                                                       (interface, 默认 OpenBot)
  │                                                              OpenBot Gateway RPC: agent / agent.wait
  │                                                                                   ▼
  └──────────── Feedback Learning(Bandit) ◄── Evaluator Layer ◄── 执行结果 + transcript + usage
                     (更新 Selector 权重)        (任务"完成度",非 API 成功)
```

相对最初概念方案，新增/强化为一等模块：`ExecutionBackend`（价值闸门）、`Capability Registry`、`Evaluator Layer`、`TaskType Registry`。

## 四、核心模块定版设计

### 4.1 ExecutionBackend（决定 AOR 是插件还是平台）

AOR 唯一感知「执行底座」的抽象；OpenBot 只是第一个实现，未来可接 LangGraph / Bedrock Agent 等。

```typescript
// packages/aor-core/src/backend.ts
export interface ExecutionBackend {
  readonly id: string; // "openbot" | "langgraph" | ...
  capabilities(): Promise<BackendCapability[]>;
  run(step: PlannedStep, ctx: RunContext): Promise<RunHandle>;
  stream(handle: RunHandle): AsyncIterable<BackendEvent>;
  wait(handle: RunHandle): Promise<StepOutput & { usage: NormalizedUsage }>;
  abort(handle: RunHandle): Promise<void>;
}
```

OpenBot 适配器（只用 Gateway RPC，零侵入）落点映射：

| Backend 方法 | OpenBot 落点                                                                            |
| ------------ | --------------------------------------------------------------------------------------- |
| `run`        | RPC `agent`，选模经 `providerOverride/modelOverride`（`src/gateway/sessions-patch.ts`） |
| `stream`     | 订阅 `agent-events`（`src/infra/agent-events.ts`）                                      |
| `wait`       | RPC `agent.wait` + `usage.cost`                                                         |
| 并行子任务   | `sessions_spawn`（`src/agents/tools/sessions-spawn-tool.ts`）或多条 `agent` run         |
| 失败重试     | 复用 OpenBot 原生 `runWithModelFallback`，AOR 不重写                                    |

### 4.2 Capability Registry / Skill（任务路由到能力，不是模型）

用户永远看到 `Code Analysis`，底层实现可从「单模型」演进到「Claude + AST + MCP」再到「内部 Agent」，上层契约不变。

```typescript
export interface Skill {
  id: string; // "coding.review" / "research.competitor"
  taskTypes: TaskTypeId[];
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  costProfile: CostProfile; // 估算成本/延迟区间，供 Selector 预筛
  bind: (backend: ExecutionBackend) => SkillRunner;
}
```

实现来源对齐 OpenBot 已有执行单元：单模型 prompt / 一组插件工具 / 一条 Lobster pipeline / 一个子 Agent。

### 4.3 Evaluator Layer（补「成功率」定义缺口，最重要修正）

成功率必须是「任务完成度」，不是「API 调用成功」，否则 Bandit 学不出东西。形成 `Task → Execute → Evaluate → Learn` 闭环。

```typescript
export interface Evaluator {
  taskType: TaskTypeId;
  evaluate(input: {
    task: Task;
    output: StepOutput;
    transcript: TranscriptRef; // 复用 OpenBot session JSONL
    usage: NormalizedUsage;
  }): Promise<EvalResult>; // { score: 0..1, signals, cost, latency }
}
```

分级落地：

1. 可验证型（MVP 首选）：coding 用客观信号——测试通过、覆盖率、`pnpm build`/lint、diff 可应用。
2. LLM-as-judge：research/summarization 按 rubric 打分。
3. 人类反馈：Control Plane 收集 👍/👎、采纳率作为长期 ground truth。

`EvalResult.score` 即 Selector 中 `success_rate` 的真实来源。

### 4.4 Task Parser + TaskType Registry（护城河：理解 > 切分）

MVP 仍是一次 LLM 解析，但从第一天起把输出约束到受控任务本体：

```
TaskType Registry（版本化任务本体）
  coding.review / coding.refactor / coding.security / coding.test-gen
  research.market / research.competitor
  ops.monitoring / ops.debug
每个 TaskType 绑定：默认 Skill 集 · Evaluator · 产物 schema · 成本基线
```

Parser 输出从自由 JSON 收敛为「TaskTypeId + 参数」，可校验、可统计、可回放；随 Evaluator 数据积累形成难复制的任务本体知识资产。

### 4.5 Model/Capability Selector + ModelProfile（在现有积木上加层）

```typescript
type ModelProfile = {
  ref: { provider: string; id: string };
  cost: CostBreakdown; // 源：models.providers.*.cost
  p50LatencyMs?: number;
  p95LatencyMs?: number; // 源：Evaluator/历史（OpenBot 缺）
  taskTypeScores: Record<TaskTypeId, number>; // 源：Evaluator 反馈，动态更新
};
// score = w_cost*cost + w_lat*latency + w_quality*taskTypeScore(taskType)
```

选出的模型经 `providerOverride/modelOverride` 交给 OpenBot 执行；失败沿用 OpenBot 原生 fallback 链。AOR 只决定「首选谁」。

## 五、核心数据结构（开发统一口径）

```jsonc
// Task
{ "type": "coding.review", "goal": "...", "constraints": { "budget": 0.5, "latency": "medium" } }

// ExecutionPlan（DAG）
{ "nodes": [{ "id": "n1", "taskType": "coding.review", "skill": "coding.review" }],
  "edges": [{ "from": "n1", "to": "n2" }] }

// EvalResult
{ "taskType": "coding.test-gen", "score": 0.9,
  "signals": { "testsPassed": true, "coverage": 0.9 }, "cost": 0.03, "latency": 4200 }
```

## 六、商业化重定位

对外叙事从「Task Execution Runtime」升级为「**AI Workload Optimization Platform / AI 成本与效率优化层**」。企业为结果付费，不为 Parser/Scheduler 付费。

| 维度 | 旧             | 新（对外）                            |
| ---- | -------------- | ------------------------------------- |
| 叙事 | 任务执行运行时 | AI 成本与效率优化层                   |
| 定价 | 按月订阅       | 节省成本分成 / 按完成任务计费         |
| 证据 | —              | Evaluator 产出：完成率↑、成本↓、延迟↓ |

Control Plane 对接 OpenBot 现有底座：`src/gateway/billing/` 账本 + cost-budget UI + 企业席位，输出「优化报告」支撑分成定价。

## 七、仓库结构与依赖边界

```
packages/aor-core/             # Parser·Planner·CapabilityRegistry·Selector·Evaluator·Feedback + ExecutionBackend 接口
packages/aor-backend-openbot/  # 唯一允许接触 OpenBot 的薄适配（只用 Gateway RPC + plugin-sdk）
packages/aor-sdk-node/         # 开发者入口，OpenAI 兼容模式优先
sdk-python/                    # 第二阶段：Python SDK（OpenBot 现无官方 Python Agent SDK，是增长点）
```

守卫规则：`aor-core` 禁止依赖任何 OpenBot 内部模块；仅 `aor-backend-openbot` 可依赖公共 Gateway 协议。孵化期用 monorepo，发布即作为独立产品。

## 八、分阶段执行计划

### 阶段 1（0–6 周）：证明「调度优于单模型」

- 3 模型（OpenAI / Anthropic / 1 个便宜模型），2 个 TaskType（`coding.review`、`summarization`）。
- `ExecutionBackend`(OpenBot) + `aor-sdk-node` + CLI demo。
- **可验证型 Evaluator**（测试通过/覆盖率/build）——用客观数字证明「成本↓30% & 完成率↑20%」。
- Selector 初版：`cheapest` / `best_quality`。
- 经 `gateway/openai-http.ts` 暴露 OpenAI 兼容入口冷启动。

### 阶段 2（6–12 周）：可商用

- Task Graph（DAG/并行/依赖）；Capability Registry 接入 Lobster + 插件工具。
- 成本统计 dashboard（接 `gateway/billing` + cost-budget UI）。
- fallback 走 OpenBot 原生链。

### 阶段 3（3–6 月）：平台化

- Bandit 动态优化（喂 Evaluator 分数）；TaskType Registry 沉淀。
- 多租户 / 审计；第二个 ExecutionBackend（如 LangGraph）验证抽象。
- 优化分成计费。

## 九、风险与对策

| 风险                               | 对策                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| 被模型厂商内置替代                 | 做跨模型任务调度 + 跨 Backend 中立，而非单模型优化                             |
| 效果不如人工                       | 从垂直 coding 场景切入，用 Evaluator 客观信号背书                              |
| 成本不可控                         | 强制 budget 约束 + Control Plane 预算上限                                      |
| 退化为 Fork                        | 边界守卫脚本 CI 强制；只走三条公共接口                                         |
| 重复造编排轮子（触碰 VISION 红线） | 失败重试/会话/工具全部复用 OpenBot；AOR 只做 Parser/Planner/Selector/Evaluator |

## 十、定版闭环

```
Task → Parser(+TaskType Registry) → Planner(DAG) → Capability Registry
     → Model/Capability Selector → Execution Backend(OpenBot)
     → Evaluator → Feedback Learning（回写 Selector 权重）
```

| AOR 层                          | 性质                 | OpenBot 落点                                       |
| ------------------------------- | -------------------- | -------------------------------------------------- |
| Task Parser + TaskType Registry | 新建（护城河）       | —                                                  |
| Planner (Task Graph)            | 新建                 | `sessions_spawn` / Lobster 并行                    |
| Capability Registry / Skill     | 新建，对齐           | Capability Center / `registerTool` / MCP / Lobster |
| Model/Capability Selector       | 新建                 | 读 `models.providers.cost`，落 `providerOverride`  |
| Execution Backend               | AOR 核心抽象         | `agent` / `agent.wait` RPC（默认实现）             |
| Evaluator Layer                 | 新建（补成功率定义） | session JSONL + `usage.cost`                       |
| Feedback Learning               | 新建                 | `agent-events` + 历史聚合                          |
| Control Plane / 优化平台        | 商业层               | `gateway/billing` + cost-budget UI + 企业席位      |
