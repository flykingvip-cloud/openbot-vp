# Stream C：AI Optimization Inventory（官方第 7 节 10 字段）

- 日期：2026-11-27，时区 Asia/Shanghai (CST, UTC+8)
- 性质：官方 10 字段审计，不是 Wave-V21-0 正式验收，也不是 v2.1 基线签认。
- 字段来源：`MASTER_ARCHITECTURE_V2_1_REUSE_BASELINE.md`（SHA-256 `c5196ff1…`）第七节中文官方字段。外加项：核实 AOR「Stage 4」所指四件套（持久化 Bandit、Python SDK、Graph Backend、Control Plane）的**实码与测试状态**（不以历史验收报告代替）；区分 `VerifiableEvaluator` / 确定性探针 vs 企业级 LLM-as-Judge / 离线数据集平台缺口；给出 `conversation-evaluation` → `AIExecutionTrace` 注入点。默认关闭，不改生产路由。
- 审查树：Mac worktree 产品代码与 `f0fccbd37bb9a45545562ee668295f9153b6f6aa` 一致。注意：仓内另有 `docs/acceptance/stage4-*.test.ts`（租户 store / 凭证备份证据），那是 **OpenBot 存储 Stage 4**，与本专项 AOR 四件套不是同一门禁；不得把 2026-11 历史 Stage4 FAIL/CONDITIONAL 计数拼到 AOR 结论里。

官方 10 项字段（原文）：1. 文件路径与代码入口 2. 核心对象与数据表/存储文件 3. API / RPC / Event 契约 4. 当前权威写主 5. 已实现且稳定功能 6. 仅有接口/原型/默认关闭/Fail-Closed 功能 7. 已完成的测试证据 8. 未覆盖的测试场景 9. 与另一仓库的重复点 10. 保留/扩展/迁移/废弃裁定

## 命名说明（避免混用「Stage 4」）

`packages/aor-core/README.md` 只定义 **Pipeline (Stage 1)**。设计文档 `docs/design/aor-agent-orchestration-runtime-plan-2026-06-04.md` 的「八、分阶段执行计划」写到 **阶段 1–3**（阶段 2 含 Task Graph；阶段 3 含 Bandit 与第二个 ExecutionBackend，例如 LangGraph），**未发现「阶段 4」专节**。v2.1 第七节 Stream C 外加项将「AOR Stage 4」展开为四件套，本报告按这四件套实码核实，不把六月计划中不存在的「阶段 4」签成已完成里程碑。

## 四件套与核心模块（官方 10 字段）

| 模块 | 1. 文件路径与代码入口 | 2. 核心对象与数据表/存储文件 | 3. API / RPC / Event 契约 | 4. 当前权威写主 | 5. 已实现且稳定功能 | 6. 仅有接口/原型/默认关闭/Fail-Closed 功能 | 7. 已完成的测试证据 | 8. 未覆盖的测试场景 | 9. 与另一仓库的重复点 | 10. 保留/扩展/迁移/废弃裁定 |
|---|---|---|---|---|---|---|---|---|---|---|
| AOR 核心管线 | `packages/aor-core/src/{parser,planner,selector,orchestrator,evaluator,bandit,feedback,backend,index}.ts` | 内存 Task / TaskGraph / FeedbackStore；零运行时依赖，不导入 OpenBot 内部 | 库接口；经 `ExecutionBackend` 对接执行引擎 | 评测分数与 bandit 臂的写主在所配置的 FeedbackStore | Stage 1 管线（Task→Parser→Registry→Selector→Backend→Evaluator→Feedback）代码存在 | 不是默认生产 Gateway 路由 | 树内有 `parser/planner/orchestrator/selector/evaluator/bandit*.test.ts` 等；**本轮未重跑 aor-core 套件，故不写通过数** | 跨系统 Trace 头透传、企业级 Judge、离线数据集平台 | 禁止在 Knowledge SDK 再造一套执行优化引擎 | **保留** 为优化核心；继续复用而非重建 |
| 持久化 Bandit | `packages/aor-core/src/bandit-persistence.ts`（`PersistentBanditFeedbackStore`、原子写 JSON）；`bandit.ts` 快照 | 本地 JSON 文件（`persistPath`），version=1 | 库 API，非独立 RPC | 该文件为进程间累积学习的权威快照（调用方选定路径） | 跨实例 load/export/import、mkdir 父目录、record 后写回已实现 | 未看到默认挂到生产 Gateway 热路径的强制开关 | **代码级存在** `bandit-persistence.test.ts`：跨实例 persist、export/import round-trip、写父目录。本轮未执行该文件 | 多租户隔离文件路径、损坏快照的生产失败关闭演练 | 不要在 SDK 再存一份 bandit 写主 | **保留**；生产挂载需单独授权与租户隔离设计 |
| Python SDK | `packages/aor-sdk-python/`（`aor_sdk/client.py`，`tests/test_client.py`） | 无本地业务库；只做 HTTP 客户端 | 仅公开 `/v1/chat/completions`（与 aor-backend-openbot OpenAI 兼容面）；`dry_run=True` 可不上网 | 执行权威仍在 OpenBot HTTP 端点 | MVP：按 `task_type` 填 prompt 并解析 chat completion | README 明确：无 Bandit、无 Gateway RPC、无 billing ingest；不是完整 Orchestrator | 树内 3 个单元测试（parse / HTTP error / dry_run）。**本轮未执行 pytest**，不写通过数 | Bandit 学习、计费、完整任务路由 | 不得变成第二套执行引擎或内置模型凭证 | **保留为 MVP**；扩展前保持默认不接管生产 |
| Graph Backend | `packages/aor-core/src/planner.ts` 定义 `TaskGraph`、`StaticGraphPlanner`、`topologicalOrder` / `executionLevels`；orchestrator 消费图 | 内存图，不是独立图数据库 | 库内规划接口；`ExecutionBackend` 注释提到未来可接 LangGraph 等 | 无独立图存储写主 | **进程内 TaskGraph 规划器已实现** | **未发现** 独立的 LangGraph/外部 Graph ExecutionBackend 包或默认生产后端 | `planner.test.ts`、`orchestrator.test.ts` 含图/环检测用例；本轮未重跑 | 第二执行后端（LangGraph 等）契约与隔离测试 | 不要把「有 TaskGraph 类型」说成已有图执行后端 | **保留** 进程内规划器；外部 Graph Backend 仍为未落地扩展 |
| Control Plane | `packages/aor-core/src/cost.ts`、`optimization-report.ts`（注释称 Control Plane dashboard / 分成占位） | 设计文档指向复用 `src/gateway/billing/` 与 cost-budget UI，而不是新库 | 无独立 Control Plane RPC 包 | 计费权威仍在 OpenBot billing | 成本/优化报告数据层有代码与 `cost.test.ts` / `optimization-report.test.ts` | Control Plane 商业化平台本身在代码中仍为 **占位描述**，不是已上线独立产品 | 树内有对应单测文件；本轮未重跑 | 控制面多租户 UI、分成结算闭环 | 禁止 SDK 另建优化控制面写主 | **保留占位 + 复用 billing**；不宣称 Control Plane 已交付 |
| VerifiableEvaluator | `packages/aor-core/src/evaluator.ts:52`；内置探针 `nonEmptyOutputProbe`、`minLengthProbe`、`compressionRatioProbe`、`structuredFindingsProbe`；`createBuiltinEvaluators` `:142` | 无外部评测集库 | 库接口 `Evaluator` / `EvalProbe` | 分数写回 FeedbackStore | **确定性、基于内容的探针已实现**（文件头写明 Stage 1 只交付这类探针） | 文件头写明 **Stage 2 才加 LLM-as-judge** 与真实 build/test 探针（后者在 `@openbot/aor-sdk-node`，因需 shell）。企业级 LLM-as-Judge 平台与离线数据集平台 **未见独立产品实现** | `evaluator.test.ts` 覆盖 structuredFindings / compressionRatio / builtin evaluators；本轮未重跑。`aor-sdk-node` 另有 `coding-evaluator*.ts` 与 `live-coding.ts`（注释称归档 Stage 4 acceptance 证据，属 Node SDK 现场评测，不是企业 Judge 平台） | 企业级 LLM-as-Judge、离线标准数据集、跨系统评测治理 | SDK 评测应复用 AOR 探针/注入，不另起写主 | **保留确定性探针**；Judge/数据集平台列为缺口，默认关闭、不臆造已完成 |

## `conversation-evaluation` → AIExecutionTrace 注入点

路径：`src/conversation-evaluation/`（`pipeline.ts`、`reducer.ts`、`store.ts`、`types.ts`、`metrics.ts`）。持久化在 `$CONFIG_DIR/conversation-evaluations/<tenantHash16>/.../<runId>.jsonl`。

已存在的邻近字段（可作注入起点，但 **不是** 完整七字段契约）：

- `tenantId` / `trustedTenantId`（pipeline / reducer / store）
- `runId`（主键之一）
- `agentId`（reducer 可从 `sessionKey` 推导）

本轮检索 **未发现** 一等字段 `trace_id` / `traceId`、`plan_id` / `planId`、`policy_generation` / `policyGeneration`、`user_id` / `userId`。因此官方契约四要求的七字段（`tenant_id, user_id, agent_id, trace_id, run_id, plan_id, policy_generation`）在 conversation-evaluation 中 **尚未齐备**。

建议注入点（默认关闭，本波次由 VB-3 `AIExecutionTraceHeaderPropagator` 提供库，**不**改 pipeline 生产路径）：

1. `pipeline.ts` 观察入站 / `seedRun`：在写入 jsonl 前校验七字段，缺头则失败关闭或拒绝进入评测记录。
2. `reducer.ts` 状态对象：把七字段纳入 run state，而不是只用 tenantId+runId。
3. 出站到 AOR audit / billing-bridge / Knowledge SDK 时复用同一组头。

本波次不修改这些文件的生产行为。
