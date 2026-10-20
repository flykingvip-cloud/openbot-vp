# Implementation Plan

> Feature: Development Supervisor（开发监督者）。需求 `./requirements.md`，设计 `./design.md`。
>
> 定位：Autonomous Supervisor Platform（监督 AI 的 AI）。本计划分 **M0 → M1 → M2 → M3** 落地。
> CTO 评审定版：先落 **M0（Fabric Worker Runtime）**——验证 Kiro/Codex/Claude 能否被统一抽象成 Worker（第一性验证点）。
>
> **验收结论（2026-06-17）**：M0、M1、M2、M3 均已通过。Development Supervisor 已从「接线中的子系统」进入「可验收的网关运行时能力」；核心闭环（Worker 抽象 → 单轮/重试监督 → gateway API → 归因/审计 → WS 进度 → resume）已在生产路径与定向测试中验证。
>
> **验收结论（2026-06-18，M5 + 三端 UX）**：第三方 Codex 对照 `acceptance-guide.zh-CN.md` 复核 — **有条件通过**（代码/架构/自动化测试 PASS；场景 B/C live E2E 待补证）。报告：`acceptance-report-2026-06-18.md`；补证手册：同 guide §12。

## Agents

- `kiro-fabric` · role: contributor · scope: Fabric Worker Runtime (M0) · paths: `src/fabric/worker/**`, `src/agents/cli-backend-worker.ts` · since: 2026-06-17
- `cursor-fable` · role: owner · scope: Development Supervisor M1–M4 · paths: `.kiro/specs/development-supervisor/**`, `src/gateway/supervisor/**`, `src/gateway/server-methods/supervisor.*`, `src/gateway/server-methods.ts`, `src/gateway/server-methods-list.ts`, `src/gateway/method-scopes.ts`, `src/gateway/server.impl.ts`, `src/config/types.gateway.ts`, `src/agents/cli-backend-usage-attribution.ts`, `ui/src/ui/supervisor/**`, `ui/src/ui/ports/platform/advanced/supervisor-panel*`, `ui/src/ui/ports/employee/views/employee-supervisor-center.ts`, `ui/src/ui/app-gateway.ts` · since: 2026-06-17

## Overview

- **M0（前置，src/fabric/worker）**：Fabric Worker Runtime —— 统一 `Worker` 抽象 + `WorkerAdapterRegistry` + `CliWorkerAdapter`（复用 cli-backend spawn）+ cli-backend 增量 `worker` 配置。**不依赖 Supervisor 引擎**，可独立验证。
- **M1（src/gateway/supervisor）**：单轮闭环 —— types + store + WorkspaceProvider + NodeValidationAdapter + 单轮 `tick`（dispatch→validate→judge，无重试）+ feature gate。
- **M2**：有界重试 —— Retry Controller + `nextStop`（迭代/预算/时长/无进展）+ Escalator + cron tick 驱动。
- **M3**：报告 + API —— Reporter（里程碑/最终）+ `supervisor.task.*` 方法 + 归因/审计 + resumeActive。

> 落地流：本 spec + `src/fabric/worker/**`（`src/fabric/` 已属 F 隔离流）；`src/gateway/supervisor/**` 与 `supervisor.ts` 新增需登记到落地流（见 Notes）。

## Tasks

### M0 — Fabric Worker Runtime（第一性验证点）

- [x] 0.1 Worker 契约类型 `src/fabric/worker/types.ts`
  - `Worker`/`WorkerRunHandle`（仅 `runId`/`workerId`，**不含 cliSessionId**，P0-2）/`WorkerStartInput`（`continuityKey` 不透明续聊键）/`WorkerLogEvent`；
    **显式生命周期**（P0-1）：`RunPhase`(pending/running/terminal)+`RunOutcome`(succeeded/failed/cancelled/timed_out)+`isTerminalStatus()`；能力双轴 + `supportsStreaming/supportsCancel`。
  - ✅ 已完成。— kiro-fabric
  - _Requirements: 10.1, 10.4_

- [x] 0.2 `WorkerAdapterRegistry` `src/fabric/worker/registry.ts`
  - `register/resolve(id)/list/ids`（未命中 null，去重）+ **`findByCapability({taskCapabilities?,control?})`**（P1-2，Worker Selection 种子，两轴 AND）。
  - ✅ 已完成。— kiro-fabric
  - _Requirements: 10.1, 10.5_

- [x] 0.3 `CliWorkerAdapter` `src/fabric/worker/cli-worker.ts`
  - `createCliWorker({ id, taskCapabilities, control, runCli })`：统一 `Worker` 映射注入式 `runCli`（默认绑 `runCliAgent`，wiring 时做）；`status` 收敛 terminal/outcome；`logs` 非流式降级终态单事件（D-LIVE）；**`cancel` M0 best-effort**（P1-1，真实终止留 M2）；**`continuityKey→cliSessionId` 内部映射**（P0-2）。
  - ✅ 已完成,复用 cli-runner 内核（经注入式 `runCli`），不另写 spawn；15 测试。— kiro-fabric
  - _Requirements: 10.2, 11.2, 3.1, 3.4_

- [x] 0.4 cli-backend 增量 `worker` 配置（additive）
  - `CliBackendConfig` 加可选 `worker?: { taskCapabilities?; control?; statusParser?; timeoutMs?; retryableExitCodes? }`（schema：`cli-backend-admin.ts` + `zod-schema.core.ts` 双侧）。
  - `createWorkerFromBackend(cfg, backendId, runCli)`：从 cli-backend 配置构造 `CliWorker` 并按 `worker` 元数据填能力轴；缺省 `worker` → 返回 null（仅模型面，向后兼容）。注入式 `runCli` 保持可测、不动模型面。
  - ✅ 已完成:`CliBackendWorkerMetadata` 类型 + 双侧 zod schema + `src/agents/cli-backend-worker.ts`;5 测试（含/不含 worker 块、未知后端、能力轴默认空、builtin 仅配置后才有 Worker 面）。cli-backend 既有 9 测试无回归。— kiro-fabric
  - _Requirements: 10.3, 9.1_

- [x] 0.5 M0 验证（第一性）
  - 用 fake runCli 对「claude 风格非流式 / codex 风格 streaming」两类 `control` 各验证：统一接口下 start→status→logs 行为正确、能力降级正确。
  - ✅ 已完成:`worker-runtime.test.ts`(15) —— 异构 worker 经同一接口驱动至 terminal/succeeded（Property 11）、`findByCapability`、`continuityKey` 续聊、终态判定、best-effort cancel。第一性结论:**Worker 抽象成立**。— kiro-fabric

> M0 剩余:仅 0.3 默认 `runCli` 真实绑定 `runCliAgent`（含 sessionFile/agentId plumbing）——随 M1 接线一起做。其余 M0（0.1/0.2/0.3 抽象/0.4/0.5）已完成,Worker 抽象第一性验证通过。

- _Requirements: 10.4, 10.5, Property 11_

### M1 — 单轮监督闭环

- [x] 1.1 `supervisor/types.ts`：`SupervisedTask`/`AcceptanceCriteria`/`ValidationReport`/`SupervisionIteration`/`SupervisorBudget`/状态机枚举（含 `timed_out`）。
  - ✅ 已完成（kiro-fabric 中断前落地）+ `resolveEffectiveBudget`/`isTerminalTaskState`。— cursor-fable
  - _Requirements: 1.1, 4.1, 5.1_
- [x] 1.2 `supervisor/store.ts`：`~/.openbot/supervisor/tasks/<taskId>.json` 原子写 + 串行队列 + `create/get/list/update/listActive/resumeActive`。
  - ✅ 已完成（kiro-fabric 中断前落地）+ 7 测试。— cursor-fable
  - _Requirements: 1.5, 8.2_
- [x] 1.3 `supervisor/workspace.ts`：`Workspace { id, root, kind }`（P1-3：`id` 供 Reporter/resume/cleanup）+ `WorkspaceProvider`（`WorktreeProvider` 经 Fabric git adapter / `DirectoryProvider`）+ `CompositeWorkspaceProvider`（worktree→fallback directory，禁共享树，D-WS）。
  - ✅ 已完成：`DirectoryProvider`/`WorktreeProvider`/`CompositeWorkspaceProvider` + `WorkspacePort`；`destroy/recycle` 默认保留产物并写 `retained` 标记（R2.3）。— cursor-fable
  - ✅ `workspace.test.ts`：`WorktreeProvider` 经 Fabric `git worktree add` 真实路径 + `Composite` 优先 worktree 集成测试。— cursor-fable
  - _Requirements: 2.1, 2.2, 2.4_
- [x] 1.4 `supervisor/validator.ts`：`ValidationAdapter{detect,plan}` 注册表（**首个 detect 命中者 plan，禁 if-chain**，P1-4）+ `NodeValidationAdapter`（探测 `package.json` → test/lint/build 生成 `AcceptanceCriteria`=ValidationPlan）+ `ValidatorPort`（经 Fabric `service.execute` 逐 step，脱敏）。
  - ✅ 已完成：`ValidationAdapterRegistry` + `createFabricValidatorPort`。— cursor-fable
  - _Requirements: 1.2, 4.1, 4.4, 4.5_
- [x] 1.5 `supervisor/engine.ts`：纯 `judge(report,criteria)` + `WorkerPort`（消费 M0 `Worker`）+ 单轮 `tick`（plan→dispatch→validate→judge，无重试）+ feature gate `OPENBOT_SUPERVISOR_ENABLED`。
  - ✅ 已完成：`superviseTick` + `TASK_TRANSITIONS` + `feature.ts`。— cursor-fable
  - _Requirements: 4.3, 6.1, 9.1_
- [x] 1.6 M1 集成（全 fake 端口）：单轮通过→accepted；验证失败→停在 fixing 边界（不重试，留 M2）；feature off→不启动。
  - ✅ 已完成：`engine.test.ts`（judge/状态机/单轮 tick/store 集成/feature off）。— cursor-fable
  - _Requirements: 4.3, 6.1, 9.1_

### M2 — 有界重试 + 升级

- [x] 2.1 Retry Controller + `nextStop`：迭代/预算/时长/无进展四闸；`retryableExitCodes` 判定；fixing prompt = 脱敏失败证据。**不放宽验收**（Property 2）。
  - ✅ 已完成：`retry.ts`（`nextStop`/`buildFixingPrompt`/`acceptanceNotRelaxed`）+ `retry.test.ts`。— cursor-fable
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
- [x] 2.2 预算解析 D-BUDGET：系统默认 `{5,5,30}` + 租户覆盖 + 任务只能收紧（`min(task,tenant)`）；接 cost-budget / Fabric `costLimit` 估算 + Worker usage 累计。
  - ✅ 已完成：`budget.ts`（`resolveTenantSupervisorBudget`/`buildTaskBudget`/`accumulateSpentCost`）+ `gateway.supervisor.budget` 配置位。— cursor-fable
  - _Requirements: 5.3, 9.2_
- [x] 2.3 `EscalatorPort`（support-case 建单 + 上下文 bundle）：触达停止条件 / worker 鉴权失败 → escalated，不谎报完成。
  - ✅ 已完成：`escalator.ts`（`createSupportCaseEscalatorPort`）。— cursor-fable
  - _Requirements: 6.2, 3.5_
- [x] 2.4 cron tick 驱动（D-DRIVE M0/M1）：复用 isolated-agent/cron 周期 `supervisor.tick(taskId)` 推进 active 任务；abort 中断。
  - ✅ 已完成：`driver.ts`（`tickSupervisedTask`/`tickAllActiveSupervisedTasks`/`abortSupervisedTask`/`startSupervisorDriver`）+ `run-registry.ts` 进程内 cancel 句柄 + `activeRun` 检查点落盘 + `wiring.ts` `cancelActive`/`shouldAbort` 接线；补齐 `worker.retryableExitCodes` 生产透传。— cursor-fable
  - _Requirements: 6.3, 6.4_
- [x] 2.5 M2 集成：失败→fixing→重试→通过；触达 maxIterations/budget/duration→对应终态+升级；无进展提前升级；abort。
  - ✅ 已完成：`engine.test.ts` M2 场景 + `retry.test.ts` + `run-registry.test.ts` + driver abort/checkpoint/resume-validating 测试；`WorkerAuthError -> escalated` 已在真实 wiring 映射 auth 失败。— cursor-fable
  - _Requirements: 5.x, 6.x_

### M3 — 报告 + API + 归因

- [x] 3.1 `ReporterPort`（消息投递）：taskStarted / milestone（✓/✗ 摘要）/ finalReport；外部渠道仅最终/摘要。
  - ✅ 基础完成：`reporter.ts`（本地 JSONL/JSON + `progress`）+ engine/driver 接入 + WS 事件 fan-out。**外部消息渠道投递**（Telegram/WhatsApp 等）留 M4/后续增强。— cursor-fable
  - _Requirements: 7.1, 7.2, 7.3, 7.5_
- [x] 3.2 `supervisor.task.{create,get,list,abort}` gateway 方法（create/abort=WRITE，get/list=READ）+ 追加式注册（server-methods/list/scopes）+ feature-gated。— cursor-fable
  - _Requirements: 1.1, 6.3, 9.1, 9.2_
- [x] 3.3 归因/审计：`recordCliBackendUsage`（correlation=taskId）+ Fabric 审计；脱敏。
  - ✅ 生产写入 + 查询 API：`recordCliBackendUsage`（`executionId: ${taskId}:${runId}`）+ `supervisor.task.audit`（Fabric audit + usage JSONL + report events）。— cursor-fable
  - _Requirements: 8.1, 8.2, 8.3_
- [x] 3.4 实时进度（D-LIVE 流式增强，依 M0 能力）：`control` 含 streaming 的 Worker，`logs` 增量解析 jsonl → `ExecutionEvent`（`src/fabric/streaming.ts` + tool-events）；内部 UI 收，外部仅摘要。
  - ✅ gateway 流：engine `onProgress` → reporter → `supervisor.task.event` WS 广播；`supervisor.task.subscribe` 注册 connId 订阅。— cursor-fable
  - _Requirements: 11.1, 11.3, 11.4_
- [x] 3.5 `resumeActive`：网关启动恢复未终止任务（feature on 时）。
  - ✅ `wiring.startSupervisorRuntime` 启动时 `resumeActive` + 首轮 tick。— cursor-fable
  - _Requirements: 1.5_

### M4（可选，后续）

- [x] 4.1 平台/员工端任务看板 UI（任务列表/进度/报告）。
  - ✅ `ui/src/ui/supervisor/supervisor-task-board.ts` 共享看板（list/get/subscribe/audit/abort/create + 实时进度）；平台 Advanced「开发监督」；员工设置「开发监督任务」。— cursor-fable
- [x] 4.2 任务模板（验收标准预设）+ 多 Worker 选择。
  - ✅ `supervisor.template.list` + `supervisor.worker.list`；`create` 支持 `templateId`/显式 `acceptance`；看板创建表单模板/Worker/模型下拉。— cursor-fable
- [x] 4.3 独立 Supervisor Runner（Task Queue → Lease → Worker），当并发规模需要时（D-DRIVE M2+）。
  - ✅ `runner.ts` 租约队列 + `startSupervisorRunner`；`feature`/`wiring` 可切换 Cron/Runner；`supervisor.runner.status` READ scope + handler 测试；看板展示驱动模式/并发/租约。— cursor-fable

## 验收门

- M0：fake runCli 下统一 `Worker` 接口可驱动两类 control 后端；cli-backend `worker` 配置解析；零回归（缺省 worker 块仅模型面）。**✅ 通过**
- M1：单轮 dispatch→validate→judge 端到端（feature-gated）。**✅ 通过**
- M2：有界重试 + 四停止条件 + 升级（含 `retryableExitCodes` 生产透传、`WorkerAuthError → escalated` 真实 wiring）。**✅ 通过**
- M3：报告 + API + 归因/审计 + resume；流式进度（能力支持时）。**✅ 通过**
- M4：看板 UI + 模板/Worker + Runner 队列（feature-gated）。**✅ 通过**

### 落地签收（2026-06-17，owner 补交）

- **提交**：M1–M4 已按 landing stream 分 5 commit 落地（`fd6b193` F 核心 → `09d56b8` ME 注册 → `93ffcfa` B 启动接线 → `9173c94` OPSD 集成 → `d33b96a` A 看板 UI），均含 `Task: development-supervisor` / `Agent: cursor-fable` trailer。
- **归因**：registry + `## Agents` paths 已扩至 `supervisor.*` / `supervisor-panel*` / 集成热文件，覆盖 handler 与 browser 测试。

### 验收证据摘要（2026-06-17）

定向测试（新增 + 既有 supervisor/worker 套件）全部通过，关键生产路径已核对：

| 能力                          | 落点                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `retryableExitCodes` 透传     | `wiring.getRetryableExitCodes` → `driver.buildTickOptions` → `superviseTick`                                               |
| `WorkerAuthError → escalated` | `wiring` auth 识别 + `engine` 升级路径                                                                                     |
| usage attribution             | `wiring` dispatch 后 `recordCliBackendUsage`（`executionId: taskId:runId`）                                                |
| 审计查询                      | `supervisor.task.audit`（Fabric + usage JSONL + report events）                                                            |
| 实时进度                      | engine `onProgress` → reporter → `supervisor.task.event` + `subscribe`                                                     |
| handler 测试                  | `supervisor.test.ts`（create/list/abort/subscribe/audit/runner.status）                                                    |
| Runner 队列                   | `runner.ts` lease + `supervisor.runner.status`；`OPENBOT_SUPERVISOR_RUNNER_ENABLED` 或 `gateway.supervisor.runner.enabled` |

### M5 — Node Agent + IDE CLI + 三端 UX（2026-06-18）

- [x] M5.1 Gateway：`NodeAgentWorkerExecutor` + `node-seat-binding-store` + `worker-policy-store` + `node-agent-registry` + `node-progress` + `supervisor.node.*` / `supervisor.worker.policy.*` API
- [x] M5.2 Mac Node：`MacSupervisorWorkerRunner` + probe/dispatch/cancel + stream-json progress + Settings Bind UI
- [x] M5.3 Web UI：平台 Advanced / 企业治理+岗位 / 员工 Workbench；RBAC（`canCreateSupervisorTask` / `canEditEnterpriseSupervisorPolicy`）
- [x] M5.4 自动化测试：gateway 120 + UI 17 vitest 全绿（见 `acceptance-report-2026-06-18.md`）
- [ ] M5.5 **Live E2E 补证**（升格 P0）：场景 B cursor-cli + Node progress；场景 C gateway enterprise_shared — 操作见 `acceptance-guide.zh-CN.md` §12
- [ ] **Chat bridge E2E**（子 spec `development-supervisor-chat-bridge`）：与 M5.5 共享环境前置（git repo + supervisor ON + Worker 就绪）；**仅验员工工作台大白 prelude**，非外部消息渠道

**M5 签收状态**：**有条件通过**（Codex 2026-06-18）→ 待 M5.5 完成后改为完全通过。

### 非阻塞后续（M4 / 增强）

- **3.1 外部渠道**：Reporter 当前为本地 JSONL/JSON + WS 控制面事件；若需走现有消息系统（Telegram 等），属 M4 或后续增强。
- **create 语义**：`supervisor.task.create` 仍为 fire-and-forget 首轮 tick；若需更强一致性，可后续返回启动确认或事件序列号。
- **M4.1**：平台/员工端任务看板 UI（消费 `subscribe` + `audit`）。**✅ 已通过**（含 M5 三端扩展）。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1", "0.2"] },
    { "id": 1, "tasks": ["0.3", "0.4"] },
    { "id": 2, "tasks": ["0.5"] },
    { "id": 3, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 4, "tasks": ["1.5", "1.6"] },
    { "id": 5, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5"] },
    { "id": 6, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5"] }
  ]
}
```

## Notes

- **复用优先**：Worker=cli-backend、Validator=Fabric、隔离=Fabric git adapter、预算=cost-budget、升级=support-case、报告=消息投递。净新增=Worker Runtime 抽象 + Supervisor 引擎/store/api。
- **职责边界**：Fabric 不判定完成（判定在 engine `judge`）；自治回路只跑验证类命令；外部副作用人工确认。
- **不 `src→scripts` 耦合**：worktree 经 Fabric `generic.git`，不 import `scripts/loom/*`；运行时状态进运行时 store，不写 `.loom/registry.yaml`。
- **落地流登记**：`src/fabric/worker/**` 属 F（`src/fabric/` 前缀已匹配）；新增 `src/gateway/supervisor/**` 与 `src/gateway/server-methods/supervisor.ts` 需在 `.loom/registry.yaml` + `scripts/worktree-audit.ts` 登记（建议归 F 隔离流，随 M1 起始）。
- **feature gate**：`OPENBOT_SUPERVISOR_ENABLED`（默认 off）；off 时既有路径逐字节不变。
- 测试：`OPENBOT_TEST_PROFILE=low npx vitest run src/fabric/worker/... src/gateway/supervisor/...`；纯函数（judge/nextStop/状态机/能力降级）用 fast-check。
