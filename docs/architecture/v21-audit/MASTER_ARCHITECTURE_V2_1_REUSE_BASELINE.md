# Enterprise AI Infrastructure Master Architecture v2.1 — OpenBot 既有能力清单与 Knowledge SDK 边界规范

> **文档状态**：`MASTER_ARCHITECTURE_V2_1_REUSE_BASELINE`（基于双仓库代码级直检 · 待 Owner 签认后作为双团队研发排期唯一基线）  
> **替代与演进关系**：正式将 `Enterprise AI Infrastructure Master Architecture v1.0` 修订为 **v2.1 — Existing Capability Reuse Baseline**；保留 v1.0 签认评审（`总览-00A`）全部 6 项安全与治理修补（`M-01` 至 `M-06`）及 vNext 总纲（`总览-00`）全部核心不变量，同步修正执行层、企业数据集成、AI Optimization 与 Agent 记忆的边界划分，彻底阻断双团队重复建设。  
> **实证代码基线**：  
> - `flykingvip-cloud/openbot-vp`（`main`）：`58287aa449fb499f49080c467df76b774b458222`（既有平台全量能力实码直检基线）  
> - `flykingvip-cloud/openbot-vp`（`codex/openbot/knowledge-sdk-v2-min-slice-adapter`）：`f0fccbd37bb9a45545562ee668295f9153b6f6aa`（Space Pre-v7 Gate 7 `MET` 与 B2-2/B2-3 124 项实审隔离分支）  
> - `flykingvip-cloud/knowledge-sdk`（`main`）：`b953c9922cc1096e0e88455dab6746c01a9d27f9`（纯标准库核心库基线，`version = "1.2.0"`，`dependencies = []`，SQLite Schema v4）  
> - `flykingvip-cloud/knowledge-sdk`（`feat/align-wave2-m2-min-slice`）：`9940818b962ccb186c0dfb0158de6bd9bd49057b`（Wave2 36/36 全绿冻结基线，SQLite/PG Schema v6，`/v2/spaces` 最小切片）  
> **冻结红线**：本文档属于架构基线与代码级审计规范，**不构成** Schema v7 DDL 实施、生产迁移或切流授权；`schema_v7_ddl_authorized: false`、`final_alignment_frozen: false`、`prod_shadow_migration_cutover_authorized: false` 严格保持不变。  
> **审计边界说明**：本次核查基于双仓库 GitHub 真实源码、目录结构、核心调用链、存储介质与仓内验收记录的静态代码直检，未在本地执行双仓全量编译、完整单测复跑或生产环境部署验证；所有结论均明确区分“实码已实现且具备稳定接口”、“代码已存在但默认关闭/Fail-Closed”、“仅内部实现缺公开 API”与“明确缺失”。

---

## 一、v2.1 总体架构修订裁定与三大核心原则

### 1.1 总体判断：从“重建执行基础设施”转向“既有能力复用基线”

基于对 `openbot-vp@58287aa4` 与 `knowledge-sdk@b953c992` / `9940818b` 的代码级核查，此前 v1.0 架构中将 OpenBot 简化为“应用层 + Agent 工作台”、并计划在下游单独建设一套“L3 AI Execution & Model Services + 全套 EDKI 数据连接器 + 全新 AI Optimization 引擎”的设计，**与现网真实代码资产严重重叠，必须立即修正**。

实码证据明确表明：
- **OpenBot 已不是单纯的前端或 Agent 管理平台**，而是已实际落地多模型 Provider 与凭证轮换/Fallback、`src/agent-runtime/` 完整执行运行时、Tool/MCP/Workflow 运行时、`src/gateway/enterprise-data/` 企业数据连接与治理体系、`packages/aor-core`（Agent Orchestration Runtime）与 `packages/evolution-core`、`packages/cogniweave-sdk` 认知记忆运行时的 **Enterprise Agent Platform**。
- **Knowledge SDK**（`pyproject.toml` 锁定 `dependencies = []` 纯标准库零强制依赖内核）自身定位清晰：**Framework-independent Enterprise Knowledge Infrastructure**，显式将 Account Management、LLM Runtime、隐式付费 Embedding、OCR Engine、Background Queue、Connector Crawler、完整 Reranker 实现与 Admin UI 列为非内置能力，采用注入式 `Embedder` / `VectorIndex` / `Reranker` 扩展契约。

因此，正式将企业级总体架构修订为 **Enterprise AI Infrastructure Master Architecture v2.1 — Existing Capability Reuse Baseline**，确立四大产品的战略分工：

| 产品 / 能力域 | 正式定位 | 代码依托基线 | 核心研发策略 |
|---|---|---|---|
| **OpenBot** | Enterprise Agent Platform | `openbot-vp@58287aa4` / `f0fccbd3` | 保留并继续演进已有执行运行时、模型服务、工具/MCP/Workflow、企业数据连接与治理网关、Workspace 体验；向外稳定暴露公开复用契约 |
| **Knowledge SDK** | Enterprise Knowledge Infrastructure | `knowledge-sdk@9940818b`（冻结） / `b953c992` | 聚焦 OpenBot 尚未形成的独立企业知识基础设施：Space/KB/Asset 统一领域模型、IKC 异步知识生产、KSG 标准治理、Resource Registry & KRDR、Knowledge Graph、Evidence/Provenance、Knowledge Evolution 与企业数据语义融合 |
| **AI Optimization** | Enterprise AI Optimization | `packages/aor-core` + `packages/evolution-core` + `src/conversation-evaluation` | 以 AOR 为核心技术内核，复用 OpenBot 原生执行后端，重点补齐跨系统 `AIExecutionTrace`、离线评测数据集、A/B 与 Shadow/Canary 实验治理，**不另建第二套执行引擎** |
| **CogniWeave** | Agent Cognitive Memory | `packages/cogniweave-sdk` | 保留既有 Agent 长期记忆、Task Framing、Reasoning、Distillation、Memory Atom 与派生索引修复能力；作为受控记忆资源类型注册进 Knowledge SDK 统一发现目录，**不与企业知识库双重建设** |

### 1.2 必须写入总架构宪章的三大硬性原则

1. **原则一：Reuse Before Build（先复用、后新建）**
   - 只要 OpenBot 仓库中已存在可满足需求的真实代码实现，Knowledge SDK 与 AI Optimization 必须优先通过公开 API / Adapter / RPC 契约复用。
   - 任何看似缺失的能力，必须先通过专项代码审计（Stream A–E）证实“无实码”或“无稳定可复用接口”，经架构评审批准后方允许新建。
2. **原则二：One Capability, One Authority（一能力、一写主）**
   - 每一项业务能力在全局架构中只允许存在 **一个权威实现与权威写主**。
   - 允许存在多个消费界面、语言 SDK、适配器或缓存视图，但严禁形成两套独立的权威数据存储（如双套 Credential Vault、双套 Semantic Object Store、双套 Knowledge Asset 主存储或双套 Bandit 选模引擎）。
3. **原则三：Optimize the Existing Execution Platform（优化既有执行平台，不造平行运行时）**
   - AI Optimization 必须作为逻辑独立的优化与治理域，通过公开 Gateway 接口（如 `agent`、`agent.wait`、`/tools/invoke`）驱动并优化 OpenBot 既有执行体系与 Knowledge SDK 检索策略。
   - 短期以 OpenBot 仓内 `packages/aor-core`、`packages/evolution-core` 与 `src/conversation-evaluation` 为基础演进，后续仅在出现独立产品化或独立部署诉求时再评估物理拆分，绝不在当前阶段复制 Agent Runtime、Model Registry 或 Tool Executor。

---

## 二、专项审计 A–E 代码级实证台账

本节基于对 `openbot-vp@58287aa4` 与 `knowledge-sdk@b953c992` / `9940818b` 的直接源码检索，逐项给出 **A–E 五大专项** 的代码级证据台账，严格区分实码成熟度与真实缺口。

### 2.1 Stream A：Execution Capability Inventory（执行与模型服务能力实证）

| 子能力 | 实码路径与关键入口 | 能力核查结论与实现细节 | 公开可复用状态 | 真实缺口与架构边界裁定 |
|---|---|---|---|---|
| **LLM Provider、模型目录与 Fallback** | `src/agents/models-config.providers.ts`、`src/agents/models-config.providers.static.ts`、`src/agents/models-config.providers.discovery.ts`、`src/agent-runtime/model/auth-profile-rotation.ts`、`src/gateway/server-methods/models.ts`、`models-admission.ts`、`models-management.ts` | 已完整实现多模型 Provider 注册与发现（OpenAI/Anthropic/Google/OpenRouter/本地及兼容 API）、凭证与 OAuth 账户管理、`createAuthProfileRotation` 账户轮换与限流冷却、Model Fallback、准入验证任务（`models.admission.*`）与路由快照（`models.management.*`） | **已实现且承担生产权威职责** | **严禁重建第二套 LLM Provider / Credential Vault / Fallback**；Knowledge SDK 与 AI Optimization 通过 Adapter 复用 |
| **Embedding 向量模型服务** | `src/memory/embeddings.ts`、`src/memory/embeddings-{openai,gemini,mistral,ollama,voyage}.ts`、`src/memory/batch-{openai,gemini,voyage}.ts`、`src/memory/embedding-retry.ts` | 已在 `src/memory/` 内部实现多厂商 Embedding 与批处理重试客户端，但逐文件检索 `src/gateway/server-methods/` 与 `src/gateway/http*` 证实 **零公开 Gateway Embedding RPC/HTTP 接口** | **仅内部实现，缺统一公开 API** | **不可误判为已可直接跨进程复用**；需在 Stream E 补齐 OpenBot 统一公开 Embedding Adapter/RPC，或由 SDK 继续通过注入式 `Embedder` 协议接入 |
| **Reranker 精排服务** | `src/memory/mmr.ts`（`mmrRerank`）、`src/retrieval/retrieval-service.ts:6`、`packages/cogniweave-sdk/src/index.ts`（`rerankHybridHits`） | 全仓仅 13 处非测试 `rerank` 命中；`src/memory/mmr.ts` 为纯启发式多样性 MMR 精排，`src/retrieval/retrieval-service.ts:6` 明确注释 *"will add rerank()/synthesize() refinement; for now ordering is score-descending."*，**无独立神经网络/交叉编码器 Reranker 服务** | **公开 Reranker 服务缺失** | Knowledge SDK 保留自身 `DeterministicLexicalReranker` / `ScoreCalibrator` 与可插拔 `Reranker` 扩展接口，后续通过外部模型 Adapter 接入 |
| **Agent Runtime** | `src/agent-runtime/`（`command/execution-admission.ts`、`capabilities/`、`model/auth-profile-rotation.ts`、`execution/runner/embedded-run.ts` 入口 `runEmbeddedPiAgent()`） | 具备准入控制、运行队列、Embedded/CLI Runner、会话与上下文编译、失败与上下文溢出恢复、超时中止、用量计费、生命周期状态管理 | **已实现且承担生产权威职责** | Knowledge SDK **不建 Agent Runtime / Session Queue**；但 **Knowledge Production 必须保留独立的资产级异步任务状态与持久化调度（`ingestion_jobs` / `SKIP LOCKED`）**，不得混用 Agent Session Queue |
| **Tool / Plugin / MCP / Workflow** | `src/agents/tools/`、`src/gateway/server-methods/tools-catalog.ts`、Plugin Tool Registry、MCP 工具通道、Browser/FS/Shell、Lobster Pipeline 与 Workflow 审批恢复 | 已实现 Agent 级/Provider 级工具策略、Allowlist/Denylist、工具目录与执行审计、审批与恢复流 | **已实现且承担生产权威职责** | Knowledge SDK 不建通用 Tool/MCP/Workflow Runtime，仅定义并暴露领域知识操作接口（`Search Knowledge`、`Retrieve Evidence`、`Discover Resources` 等）供 OpenBot 工具层适配 |

### 2.2 Stream B：Enterprise Data Boundary（企业数据集成实证与 Fail-Closed 真相）

| 子能力 | 实码路径与关键入口 | 存储介质与实现实证 | 真实运行态与边界判断 | EDKI 划界与复用决策 |
|---|---|---|---|---|
| **底层持久化与多租户隔离** | `src/gateway/enterprise-data/indexed-store.ts`、`store.ts`、`enterprise-data-tenant-scope.test.ts`、`enterprise-data-admin-scope.test.ts` | `indexed-store.ts` 已实现权威 SQLite 行存储（`${file}.sqlite`，基于 `node:sqlite`，启动时单次流式导入历史 JSON 并校验 `legacy_fingerprint`，`MAX_RECORD_BYTES = 16MB`） | **已实现权威存储底座** | Knowledge SDK 禁止在自身库中复制一套 DataSource/Connector 状态表 |
| **连接器与凭证保险箱** | `connector-postgres-package.ts`、`connector-mysql-package.ts`、`connector-http-rest-package.ts`、`connector-notion-package.ts`、`connector-yonyou-tplus-package.ts`、`connector-credential-vault.ts`、`connector-oauth.ts`、`mock-handlers.ts` | 已存在 Postgres（`db-postgres`）、MySQL、HTTP REST、Notion、用友 T+（含消息/行/同步模块）连接器包，以及独立凭证保险箱与 OAuth 会话持久化；同时仓库内存在 `mock-handlers.ts` 与 `connector-demo-packages.ts` | **实码框架与部分真实连接器并存（需在 Stream B 逐一甄别真实驱动 vs Demo/Mock）** | **停止在 Knowledge SDK 中自建 DB/ERP/CRM/SaaS 连接器、Credential Vault 与 OAuth 流程**；全部通过 OpenBot Data Adapter 复用 |
| **Semantic Object Catalog** | `src/gateway/enterprise-data/semantic-object-types.ts`、`semantic-object-store.ts`、`src/gateway/server-methods/enterprise-data-semantic.ts` | Metadata-First 目录，描述 `customer / order / product / inventory / employee / contract / invoice / custom` 规范对象与字段映射至 `sourceId + ConnectorActionRef`，**不存储业务数据行**；独立存储于 `openbot-enterprise-semantic-objects.json`（不触碰 `EnterpriseDataStore`） | **已实现且为当前操作语义权威写主** | **严禁双写！** Knowledge SDK 短期只读引用 OpenBot Semantic Object，聚焦跨文档/制度/标准/实体的上层企业语义关联；未经领域拆分审批不得迁移写主 |
| **Data Gateway、权限审批、脱敏与物化投影** | `data-gateway.ts`（`invokeEnterpriseDataAction`）、`data-access-policy-store.ts`、`governance-approval-store.ts`、`masking-engine.ts`、`event-driven-projection-materializer.ts`、`scheduled-projection-materializer.ts`、`knowledge-feed-item-store.ts`、`knowledge-lineage-store.ts`、`knowledge-publication.ts`、`src/gateway/server-methods/enterprise-data.ts` | 已有完整 `enterprise-data.*` RPC 面（`sources.*`、`capabilities.*`、`access-policies.*`、`actions.*`、`mcp-discovery*`、`grants.*`、`projection-specs.*`、`projection-bindings.*`），含脱敏引擎、审批流、事件驱动/定时投影物化与 Feed/Lineage 账本 | **连接、审批、脱敏与投影基础设施已成体系** | EDKI 直接复用 OpenBot 的连接执行、脱敏、审批与物化采集通道，聚焦知识资产化治理、跨资源 `Resource != Capability` 发现与撤权四通道闭环 |
| **Agent Data Planner 与 Tool 执行路径（关键 Fail-Closed 实证）** | `src/gateway/enterprise-data/agent-data-planner.ts`、`src/agents/tools/data-capability-tool.ts:99-108`、`src/agents/tools/data-capability-tool.test.ts:130-134` | `agent-data-planner.ts` 将数据访问规划与实际 Connector Action 执行解耦；**`data-capability-tool.ts:99-108` 在 `action === "invoke"` 时显式返回 `ok: false, reason: "knowledge-object-only"`**，提示 Agent Runtime 仅消费 Knowledge Objects 而非直接触发 ConnectorAction，员工侧执行保留在 `enterprise-data.invoke`（单测第 134 行明确断言 `invokeDataCapabilityForAgent` 未被调用） | **刻意保持 Fail-Closed，未打通 Agent 端到端实时数据调用** | **绝不可误判为端到端已完备**；后续通过 KRDR + OpenBot Data Gateway 补齐受控 Mode A/B/C 执行契约（`M-03`），严禁绕开 OpenBot 治理层直连源库 |

### 2.3 Stream C：AI Optimization Inventory（AOR、评估与演化能力实证）

| 子能力 | 实码路径与关键入口 | 能力核查结论与仓内记录状态 | 真实缺口与边界判断 | 复用与演进决策 |
|---|---|---|---|---|
| **AOR 核心编排与选模内核** | `packages/aor-core/src/`（`parser.ts`、`task-types.ts`、`capabilities.ts`、`planner.ts`、`selector.ts`、`backend.ts`、`evaluator.ts`、`feedback.ts`、`bandit.ts`、`bandit-persistence.ts`、`orchestrator.ts`、`billing-bridge.ts`、`audit.ts`、`optimization-report.ts`） | 具备任务解析/分类、能力注册、DAG Planner、成本/质量/延迟选模、Thompson Sampling Bandit 与持久化、反馈学习、计费桥接与优化报告；仓内阶段报告 `docs/design/aor-stage-{1,2,3,4}-completion-report-2026-06-05.md` 记录 **Stage 1–3 已验收、Stage 4 标记待验收**（注：属仓内文档记录，非本次重跑验证） | 默认 `VerifiableEvaluator` 偏确定性内容探针，客观 Coding Evaluator 需显式开启；**尚未形成企业级 LLM-as-Judge 多维质量评估与离线数据集评测平台** | **保留 AOR 为 AI Optimization 核心技术内核**，禁止另建第二套 Model Selector / Bandit / Orchestrator |
| **AOR 执行后端与多语言 SDK** | `packages/aor-backend-openbot/src/`（`gateway-rpc.ts`、`tools-invoke.ts`、`backend.ts`、`billing-ingest.ts`）、`packages/aor-backend-graph/`、`packages/aor-sdk-node/`、`packages/aor-sdk-python/` | `aor-backend-openbot` 已通过公开接口调用 OpenBot（`agent`、`agent.wait`、原生 Model Fallback、`/tools/invoke`），严格验证了“优化层不复制执行层”的架构模式 | 缺少面向 Knowledge SDK 检索计划（`KnowledgeRetrievalPlan`）与 Enterprise Data 查询路由的统一策略插槽与回流信号 | 扩展 AOR Backend 与 Telemetry 契约，接入 Knowledge SDK 检索/重排/Evidence 质量指标 |
| **对话被动评估（M0）** | `src/conversation-evaluation/`（`index.ts`、`feature.ts`、`pipeline.ts`、`metrics.ts`、`thresholds.ts`、`store.ts`、`idempotency.ts`） | M0 被动观测管道，受环境变量 `OPENBOT_CONVERSATION_EVALUATION=1` 控制（**默认关闭**）；仅订阅进程内 agent-event 总线并追加 JSONL 指标至 `$CONFIG_DIR/conversation-evaluations/...`，**不调用 `diagnose()`，不生成处方或自动变更** | 仅覆盖单次对话链路延迟/丢弃率等被动指标，尚未与 Knowledge Retrieval / Data Query 合并为全链路 `AIExecutionTrace` | 作为跨系统 Trace 采集的基础组件演进，严禁另建独立对话指标采集器 |
| **演化控制面契约** | `packages/evolution-core/src/`（`state-machine.ts`、`contracts.ts`、`decisions.ts`、`evaluation-policy.ts`、`authority-recheck.ts`、`diagnosis-ingest-wal.ts`、`completion-ledger.ts`、`decision-surface/`）、`src/gateway/server-methods/evolution-*.ts` | 纯控制面契约包（无 Gateway 强耦合依赖），已定义优化提案状态机、权限复核、评估策略、WAL 接收、完成账本及员工/企业双决策面 | 尚缺少跨系统的统一实验管理（A/B Test）、Shadow Evaluation、Canary 灰度晋升与一键回滚平台 | 在 `evolution-core` 既有提案/审批/回滚契约之上补齐跨系统实验治理，不另起炉灶 |

### 2.4 Stream D：Memory & Knowledge Boundary（CogniWeave 与 Knowledge SDK 实证边界）

| 维度 / 能力域 | CogniWeave（`packages/cogniweave-sdk`） | Knowledge SDK（`main@b953c992` / `9940818b`） | OpenBot 本地知识层（`src/gateway/knowledge/` & `server-methods/knowledge*.ts`） | 边界与防重叠裁定 |
|---|---|---|---|---|
| **产品定位** | Agent Cognitive Memory Runtime（让 Agent 记住） | Enterprise Knowledge Infrastructure（让 Agent 理解企业） | OpenBot 应用消费层与历史遗留本地知识实现 | 三者职责正交，严禁混写与重复造轮 |
| **实码核心能力** | `atom-v2.ts`、`runtime/in-memory-engine.ts`、REST 服务（`POST /v1/tasks/frame`、`/v1/reason`、`/v1/ingest`、`/v1/distill`、`/v1/write-back`、`/v1/evidence/resolve`、`/v1/repair/indexes`、`/v1/rebuild/from-truth`）、`postgres-metadata` / `pgvector-vector` / `neo4j-graph` 适配器、云同步 Outbox（`sync/`） | 纯标准库核心（`dependencies = []`）；`main@b953c992` 为 Schema v4，`9940818b` 演进至 Schema v6 31 表（含不可变文档版本、Tenant/KB/Doc ACL、FTS5/PgVector 混合检索、Evidence Anchor & Receipt、L2 Governance Workflow/Issues/Impact、Outbox/Audit、AgentProfile/TaskContext/MidTaskRevocation、`idempotency_records`、`ingestion_jobs`、`/v2/spaces` 最小切片） | `knowledge-base-store.ts`、`knowledge-retrieval-runtime.ts`、`knowledge-directory.ts`、`agent-knowledge-generation-runtime.ts`、`knowledge-governance.ts`（7 项本地 RPC）、`vault-sync.ts`（40 处理器）；`f0fccbd3` 已完成 M2-B 隔离适配（Gate 7 `MET`） | Knowledge SDK **绝不重建 Memory Atom / Conversation Distillation**；CogniWeave 作为受控 `memory_resource` 接入 SDK 统一发现；OpenBot `src/gateway/knowledge/` 按 Space Pre-v7 既定路线逐步收口并委派至 Knowledge SDK 唯一权威 |
| **非内置与外部依赖红线** | 独立记忆运行时，依赖外部 LLM Provider 与元数据/向量/图适配器 | 明确不内置 Account Management、LLM Runtime、隐式付费 Embedding、OCR Engine、Background Queue、Connector Crawler、完整 Reranker、Admin UI | 复用 OpenBot 统一账号/租户、模型服务、工具与 UI | Knowledge SDK 坚守纯标准库内核定位，驱动/OCR/解析/HTTP/PG 维持 optional extras |

### 2.5 Stream E：Cross-System Contract（跨系统契约现状实证）

| 契约通道 | 现网实码面 | 现状评估 | v2.1 必须补齐的唯一契约 |
|---|---|---|---|
| **OpenBot Gateway RPC / HTTP** | `src/gateway/server-methods/`（`agent.ts`、`models*.ts`、`tools-catalog.ts`、`enterprise-data*.ts`、`knowledge*.ts`、`evolution-*.ts`、`billing.ts`、`vault-sync.ts`） | 内部面丰富但偏产品内生语义；LLM 执行已有 AOR 复用先例（`agent`、`agent.wait`、`/tools/invoke`），但缺少面向 SDK 的统一 Embedding/Reranker 与受控 Data Query 公开契约 | 冻结 4 组跨系统适配契约：`Model & Embedding Adapter`、`Controlled Data Query Adapter`、`Memory Resource Discovery Adapter`、`Unified AIExecutionTrace Event` |
| **Knowledge SDK Python / HTTP / MCP** | `knowledge-sdk@9940818b`：`client/local.py`、`client/http_client.py`、`mcp/gateway.py`、`/v2/spaces` 最小切片（36/36 全绿） | Python/HTTP/MCP 三端一致校验与 SQLite/PG `FORCE RLS` 双引擎门禁已验证；`/v2/spaces` 处于严格冻结状态 | Space Schema v7 继续沿 `/v2/spaces` 演进；vNext 扩展域（IKC/KSG/EDKI 语义融合/KRDR）统一挂接 `/v3/*`，强制携带 `Idempotency-Key`、游标分页与脱敏错误码（`M-06`） |
| **CogniWeave REST / Embedded** | `packages/cogniweave-sdk/src/rest/node-server.ts`（`/v1/*` 14 组路由）与 `embedded` 模式 | 接口清晰独立，具备完整 Trace 与 Evidence Resolve 语义 | 补齐租户/主体身份映射与撤权失效联动（确保撤权第 4 通道同步失效历史会话记忆，对齐 `M-05`） |
| **跨系统 Events 与 Trace** | SDK `outbox_events` / `audit_events`；OpenBot `enterprise-data-event-bus.ts`；`conversation-evaluation` JSONL；AOR `audit.ts` | **四套事件与追踪格式各自独立，尚未统一 Correlation ID** | 定义全局统一 `trace_id / run_id / task_id / plan_id / tenant_id` 关联信封，贯通 OpenBot × Knowledge SDK × AOR × CogniWeave |

---

## 三、四产品修正架构与权威写主边界矩阵

### 3.1 修正后的四层协同拓扑

```text
+-----------------------------------------------------------------------------+
|  Layer 1: OpenBot — Enterprise Agent Platform（现有平台 · 优先复用）        |
|  Workspace UI · Agent Runtime · Model Providers & Fallback · Tool/MCP       |
|  Workflow/Lobster · Enterprise Data Connectors & Data Gateway · Billing     |
|  Data Capability & Approval · Masking · Semantic Object (Operational)       |
+---------------------+-------------------------------+-----------------------+
                      | 稳定 API / Adapter / Event    | 公开 Gateway 接口
                      v                               v
+---------------------------------------+   +---------------------------------+
| Layer 2A: Knowledge SDK               |   | Layer 2B: AI Optimization       |
| Enterprise Knowledge Infrastructure   |   | 基于 AOR + Evolution 扩展       |
| (重点新增与演进)                      |   | (不重建执行运行时)              |
| · Knowledge Core (Space/KB/Asset)     |   | · Task/Capability Optimization  |
| · IKC 异步知识生产 (独立持久化队列)   |   | · Model Selection & Bandit      |
| · KSG 知识标准与语义治理              |   | · Cross-System AI Evaluation    |
| · Knowledge Resource Registry & KRDR  |<->| · Unified AIExecutionTrace      |
| · Knowledge Graph & Ontology          |   | · Experiment / Shadow / Canary  |
| · Evidence / Provenance / Evolution   |   | · Optimization Governance       |
| · EDKI 企业数据语义融合(只读桥接源库) |   +---------------------------------+
+---------------------+-----------------+                     |
                      | 统一资源发现注册 (memory_resource)    |
                      v                                       v
+---------------------------------------+   +---------------------------------+
| Layer 2C: CogniWeave                  |   | Layer 3: External Systems & AI  |
| Agent Cognitive Memory (保留既有)     |   | 企业数据库 · ERP/CRM · 文件系统 |
| · Memory Atom / Distillation / Scope  |   | LLM · Embedding · Reranker      |
| · Task Framing / Index Repair         |   | 专业数据平台 / 数仓 / 指标平台  |
+---------------------------------------+   +---------------------------------+
```

### 3.2 22 项核心能力唯一权威写主矩阵（One Capability, One Authority）

| 编号 | 业务能力 | 唯一权威负责方（写主） | 另一方复用与消费方式 | 严格禁止事项 |
|---|---|---|---|---|
| **B-01** | Agent Runtime 与运行队列 | **OpenBot** | Knowledge SDK 仅提供知识服务与检索结果 | 禁止 SDK / AI Optimization 自建 Agent Runtime |
| **B-02** | LLM Model Provider Registry | **OpenBot** | SDK 与 AOR 通过公开模型 Adapter 调用 | 禁止 SDK 自建多模型目录与路由注册表 |
| **B-03** | Model Credential / OAuth / Fallback | **OpenBot** | AOR 传递选模策略，OpenBot 执行轮换与 Fallback | 禁止 SDK 保存第二套模型 API Key / OAuth 凭证 |
| **B-04** | Embedding 与 Reranker 模型推理 | **过渡双轨（OpenBot 暴露公开 Adapter / SDK 注入外部 Provider）** | SDK 通过注入式 `Embedder` / `Reranker` 协议调用 | 在 OpenBot 提供公开 Embedding/Reranker API 前禁止假定其已存在；禁止 SDK 内置硬编码付费调用 |
| **B-05** | Tool / Plugin / MCP Runtime | **OpenBot** | SDK 暴露领域知识操作接口供工具层注册 | 禁止 SDK 自建通用 Tool Executor 或 MCP 宿主运行时 |
| **B-06** | 通用 Workflow / Lobster 引擎 | **OpenBot** | SDK 暴露知识生产/审核任务契约供编排触发 | 禁止 SDK 建设通用业务 Workflow 引擎 |
| **B-07** | Agent 跨会话认知记忆 | **CogniWeave** | SDK 将其注册为 `memory_resource` 纳入发现与撤权联动 | 禁止 SDK 重建 Memory Atom / Conversation Distillation |
| **B-08** | Enterprise Data Connectors（DB/ERP/CRM/SaaS） | **OpenBot（当前权威）** | SDK 通过受控 Data Adapter 发现和申请访问 | 禁止 SDK 自建 Postgres/MySQL/SAP/Salesforce/用友连接器 |
| **B-09** | Connector Credential Vault & OAuth | **OpenBot** | SDK 绝不接触或落盘源系统连接凭证 | 禁止 SDK 建设第二套数据源凭证保险箱 |
| **B-10** | Data Capability 注册与审批流 | **OpenBot（当前权威）** | KRDR 发现 `Resource` 与绑定 `Capability` 并按权限申请 | 禁止绕过 OpenBot 审批与 `data-access-policy` 直连源库 |
| **B-11** | Data Query Execution 与字段脱敏 | **OpenBot（当前权威）** | SDK 通过受控 Mode A/B/C 接口委派执行并返回脱敏证据 | 禁止 MVP 开放自由 Text-to-SQL；严禁双套脱敏规则 |
| **B-12** | Enterprise Data Semantic Object（操作语义） | **OpenBot（当前先复用 `openbot-enterprise-semantic-objects.json`）** | SDK 通过只读契约读取并引用，向上扩展跨知识/制度语义层 | **绝对禁止双写！** 未经领域拆分与迁移审批不得移交写主 |
| **B-13** | Space / Knowledge Base 统一领域模型 | **Knowledge SDK** | OpenBot 提供创建、导航、权限配置与 UI 体验 | 禁止 OpenBot 长期保留平行权威 KB/Space 主存储 |
| **B-14** | Knowledge Asset 身份与不可变版本 | **Knowledge SDK** | OpenBot 提供上传、预览、对比、归档与回滚入口 | 禁止外部直接篡改版本内容或绕过版本账本 |
| **B-15** | Knowledge Production 异步流水线（IKC） | **Knowledge SDK（资产级状态与调度写主）** | OpenBot 提供执行算力/模型调用支持与进度展示 | 禁止把 Agent Session Queue 混用为资产级知识生产队列 |
| **B-16** | 多维知识分类与标签体系 | **Knowledge SDK** | OpenBot 提供智能知识目录（Knowledge View）治理 UI | 禁止前端本地散落存储权威分类状态 |
| **B-17** | Knowledge Standards & Governance（KSG） | **Knowledge SDK** | OpenBot 提供标准审核、冲突裁决与发布审批 UI | 禁止 OpenBot 本地 `knowledge-governance.ts` 成为长期第二写主 |
| **B-18** | Knowledge Resource Registry & KRDR | **Knowledge SDK** | OpenBot 提供 Agent 资源配置与授权策略界面 | 严禁把 Resource 与 Capability 混为单一对象；严禁对终端泄露无权资源存在性（`M-04`） |
| **B-19** | Knowledge Graph & Enterprise Ontology | **Knowledge SDK** | OpenBot 提供图谱浏览与实体洞察体验 | 禁止将业务事实图谱与 CogniWeave 会话记忆图谱混写 |
| **B-20** | Knowledge Evidence & Provenance | **Knowledge SDK** | OpenBot 展示可验引用、溯源链与失效提示 | 禁止任何层篡改 Evidence Excerpt 或跳过收据核验 |
| **B-21** | AI Model Selection、Bandit 与跨系统优化 | **AI Optimization（基于 AOR + Evolution Core）** | OpenBot 执行选模/路由决策，SDK 上报检索评测信号 | 禁止新建平行 Model Selection / Bandit 引擎 |
| **B-22** | Knowledge Retrieval 策略执行与优化 | **Knowledge SDK 执行；AI Optimization 评估与提案** | 检索参数、重排阈值与路由策略由 SDK 受控执行，AOR/Evolution 负责离线评测与灰度建议 | 禁止优化层绕过 SDK 权限门禁直接改写检索结果 |

### 3.3 Semantic Object 写主防双写四步演进护栏

针对 `src/gateway/enterprise-data/semantic-object-store.ts`（当前持久化于 `openbot-enterprise-semantic-objects.json`）与 Knowledge SDK 未来 Enterprise Semantic Layer 的潜在重叠，强制执行四步演进纪律：
1. **锁定当前写主**：短期内 OpenBot 保持 `SemanticObject`（数据连接器操作语义、字段到 `ConnectorActionRef` 映射）的唯一写主。
2. **只读契约桥接**：Knowledge SDK 通过只读同步/查询契约引用 `semantic_object_key`，将其作为 `Resource` 注册进 `Knowledge Resource Registry`。
3. **语义边界分层**：清晰区分“连接器操作语义（表/接口字段映射、脱敏级别，留 OpenBot）”与“企业知识权威语义（业务概念本体、制度条款映射、指标口径解释、标准适用范围、权威等级，建在 Knowledge SDK）”。
4. **受控迁移审批**：仅在完成领域拆分评审、双写零冲突验证与 Owner 书面签批后，方可考虑将特定企业语义子域正式迁移至 SDK，任何阶段严禁双写。

---

## 四、研发排期三色清单：停止重复建设、复用集成与重点新增

下表直接作为两个团队下一阶段研发排期与立项审查的硬性准入清单：

| 分类 | 研发决策 | 精确范围清单（逐项对应代码资产） | 违规红线 |
|---|---|---|---|
| **红灯 · 停止重复建设（STOP）** | **严禁在 Knowledge SDK 或新 AI Optimization 项目中重新实现** | 1. Agent Runtime 与 Session Queue<br>2. Model Provider Registry<br>3. Model Credential / OAuth 管理<br>4. Model Fallback 与账户轮换冷却<br>5. Tool Runtime / Plugin Registry / MCP 宿主运行时<br>6. 通用 Workflow Engine / Lobster Pipeline<br>7. Enterprise Data Connectors（PG/MySQL/SAP/Salesforce/Notion/用友等）<br>8. Connector Credential Vault & OAuth<br>9. 通用 Data Capability 执行与审批/脱敏系统<br>10. Agent Conversation Memory / Memory Atom / Distillation<br>11. 通用 Model Selection Engine<br>12. 已有 AOR Evaluator / Thompson Sampling Bandit 基础 | 任何 PR 若出现上述重复建设代码，架构评审一票否决 |
| **黄灯 · 复用与集成（REUSE）** | **基于既有实码抽离稳定契约并扩展，不另起项目** | 1. OpenBot Model Services（补齐公开 Embedding/Reranker 契约或保持外部注入）<br>2. OpenBot Agent Runtime（`src/agent-runtime/`）<br>3. AOR（`packages/aor-core`、`aor-backend-openbot`、`aor-sdk-*`）<br>4. OpenBot Tool / MCP / Workflow 体系<br>5. OpenBot Enterprise Data Gateway（`data-gateway.ts`、`indexed-store.ts`、`masking-engine.ts`）<br>6. OpenBot Semantic Object（只读引用）与 Data Capability（补齐受控执行桥接）<br>7. CogniWeave（`packages/cogniweave-sdk`，注册为记忆资源）<br>8. Conversation Evaluation（`src/conversation-evaluation/`，演进为全链路 Trace 组件）<br>9. Evolution Core（`packages/evolution-core/`，扩展跨系统实验审批与回滚）<br>10. Knowledge SDK 既有 `Embedder` / `VectorIndex` / `Reranker` 注入协议与 Schema v6 31 表底座 | 禁止直接跨进程读取对方私有 JSON/SQLite 文件；一律走冻结 API/RPC 契约 |
| **绿灯 · 重点新增（BUILD）** | **两个团队真正值得投入核心研发资源的战略增量** | 1. Knowledge Core 统一资产身份与 Space / KB / Asset 正式领域模型（待 Space Pre-v7 门禁收口与 Owner 签批）<br>2. IKC 异步知识生产流水线（入库/生产/发布三段解耦、蓝绿快照、高风险禁 `partial_available`）<br>3. KSG 知识标准与语义治理（复用于既有 L2 Workflow/Issues/Impact 之上）<br>4. Knowledge Resource Registry（严格分离 `Resource` 与 `Capability`）<br>5. KRDR 动态发现与多路路由（`KnowledgeRetrievalPlan` 双视图脱敏）<br>6. Knowledge Graph & Enterprise Ontology Integration<br>7. Knowledge Evolution（知识新鲜度、冲突消解与资产演进）<br>8. 跨系统 Evidence、Provenance 与四通道撤权清理回执（含 Agent 历史上下文失效）<br>9. OpenBot × Knowledge SDK 统一 Agent Knowledge Adapter（收口本地遗留知识路径）<br>10. 基于 AOR + Evolution Core 的跨系统 Trace、离线评测集、A/B 与 Shadow/Canary 实验治理 | 必须严格遵守 Schema v6 / `/v2/spaces` 冻结红线，按波次门禁推进 |

---

## 五、跨系统集成契约基线

为确保四套系统在不互相复制代码的前提下稳定协作，锁定以下五组唯一跨系统契约基线：

1. **契约一：OpenBot Model & Embedding Adapter Contract**
   - **LLM 推理**：Knowledge SDK（如 IKC 语义抽取、KSG 规则判定）不内置 LLM SDK 凭证，统一通过可注入的 `ModelAdapter` 调用 OpenBot 公开模型执行与路由接口，继承 OpenBot 的多租户配额、计费与 Fallback。
   - **Embedding / Reranker**：鉴于本次代码核查证实 OpenBot 尚无公开 Embedding RPC 且无神经 Reranker 服务，契约明确支持两种受控运行模式：① 由 OpenBot 新增公开 `models.embed` / `models.rerank` 受控代理接口供 SDK 复用；② 在该接口就绪前，由宿主部署方通过 Knowledge SDK 既有的 `Embedder` / `Reranker` 注入协议接入外部专业模型服务，严禁 SDK 隐式直连付费 API。
2. **契约二：Controlled Enterprise Data Execution Bridge Contract**
   - 保持 `src/agents/tools/data-capability-tool.ts` 对未授权直接调用的 Fail-Closed 语义（`knowledge-object-only`），防止 Agent 越权直触 ConnectorAction。
   - 当 KRDR 生成 `KnowledgeRetrievalPlan` 并路由至企业数据时，必须经过 OpenBot Data Gateway 的 **Mode A（用户委派透传）/ Mode B（租户受控服务凭证 + 强制行级谓词）/ Mode C（离线受控物化快照）** 鉴权模式（`M-03`），由 OpenBot 执行查询与字段脱敏，再由 Knowledge SDK 封装为带 `Provenance` 与 `Expiry` 的统一 Evidence。
3. **契约三：CogniWeave Memory Resource Registration & Revocation Contract**
   - CogniWeave 作为 `resource_type = "agent_memory"` 注册至 Knowledge SDK 的 Resource Registry，KRDR 可在权限允许范围内发现并引用记忆摘要。
   - 当企业知识资产或数据权限发生撤销（`MidTaskRevocation` / `AccessRevocationJob`）时，Knowledge SDK 发出标准撤权事件，驱动 CogniWeave 与 OpenBot 会话历史执行 **第 4 通道清除/失效** 并回传 `RevocationPurgeReceipt`（`M-05`）。
4. **契约四：Unified Cross-System AIExecutionTrace Contract**
   - 在 OpenBot（`agent-runtime` / `conversation-evaluation`）、Knowledge SDK（`KnowledgeRetrievalPlan` / `audit_events`）、OpenBot Data Gateway（`invocation-audit`）与 AOR（`audit.ts` / `billing-bridge.ts`）之间强制透传统一关联头：`tenant_id`、`user_id`、`agent_id`、`trace_id`、`run_id`、`plan_id`、`policy_generation`。
   - `KnowledgeRetrievalPlan` 严格维持双视图隔离（`M-04`）：全量 `resources_excluded` 仅进入治理/审计视图，Agent 与终端视图仅返回脱敏摘要（如 `redacted_unauthorized_count`），杜绝存在性侧信道。
5. **契约五：Knowledge SDK API 演进与兼容性边界**
   - Space 领域升级继续沿既有冻结的 `/v2/spaces` 契约族与 Schema v7 预审路径收口（不破坏 Wave2 36/36 全绿最小切片与 OpenBot `f0fccbd3` 联调成果）。
   - vNext 新增的 IKC、KSG、Resource Registry、KRDR 与 EDKI 语义桥接接口统一规划在 `/v3/*`，强制要求 `Idempotency-Key`、游标分页与脱敏错误码（`M-06`），同时维持 Python / HTTP / MCP 三端行为一致与 SQLite / PostgreSQL `FORCE RLS` 双引擎一致。

---

## 六、v1.0 至 v2.1 架构修订对照与既有文档体系对齐

为避免双团队在阅读既有架构文档时产生口径冲突，明确 **v2.1 相对 v1.0 的修订项** 与 **完全继承不变的基线项**：

| 维度 | v1.0 原架构规划（`总览-00A` 前置稿） | v2.1 实码修正裁定（本文档生效） | 既有文档衔接处理 |
|---|---|---|---|
| **OpenBot 产品定位** | 偏向 L1 应用工作台与 Agent 体验层 | 正式确认为 **Enterprise Agent Platform**（涵盖执行运行时、模型服务、工具/MCP/Workflow、企业数据连接治理、AOR、CogniWeave） | `总览-00B` 为最新最高优先级复用基线 |
| **L3 AI Execution & Model Services** | 规划作为独立基础设施层重新统建 | **撤销重建计划**；全面复用 OpenBot `models-config*`、`agent-runtime`、Tool/MCP/Workflow，仅补齐公开 Embedding/Reranker 契约缺口 | 覆盖 `总览-00A` 与 `总览-00` 中涉及自建执行层的描述 |
| **EDKI 企业数据融合** | 包含连接器框架、Credential Vault、查询执行与语义层 | **剥离连接器/Vault/执行重建**；复用 OpenBot `src/gateway/enterprise-data/`，SDK 仅建设跨资源语义融合、KRDR 发现与 Evidence/撤权闭环 | `总览-03` 中安全校准（Mode A/B/C、双视图脱敏、四通道撤权）全部保留，连接器实现方改指 OpenBot |
| **AI Optimization** | 独立优化引擎蓝图 | **锚定 `packages/aor-core` + `evolution-core` + `conversation-evaluation` 演进**，重点补齐跨系统 Trace、评测集与实验治理，不造第二套执行引擎 | 同步更新 `总览-00` 协同矩阵 |
| **Agent 记忆体系** | 存在与知识库重叠风险 | 明确 **CogniWeave = Agent Cognitive Memory**，**Knowledge SDK = Enterprise Knowledge Infrastructure**，通过资源注册与撤权联动协同 | 零重复建设，彻底隔离写主 |
| **安全与治理护栏（`M-01`–`M-06`）** | `总览-00A` 签认修补单锁定的 6 项红线 | **100% 完整保留并强化**（含 `f0fccbd3` 基线校准、Mode A/B/C 困惑代理人防线、`RetrievalPlan` 脱敏、四通道撤权、高风险禁 `partial_available`、纯标准库零依赖内核） | 全部纳入 v2.1 不可违反宪章 |
| **Space Pre-v7 专项轨道** | 19 份空间与收藏专项文档（Gate 7 `MET`、Gate 3/4 `NOT_MET`） | **完全保留且不打断**；Team B 继续收口 30 项 `partial` 穿透、`PRE-02/03` 与 `EXT-02`，待 8 项退出门槛全绿与 Owner 签批后方解锁 Schema v7 | `空间-00M` 至 `空间-06` 保持有效 |

---

## 七、联合代码级深度审计执行任务书（Stream A–E 闭环门禁）

在向双团队正式下发 vNext 新功能开发任务之前，立即以联合专项审计形式完成 **Stream A–E** 的最后闭环补证（尤其对 **Stream B** 与 **Stream C** 必须沿真实调用链穿透至持久化、权限校验与最终执行，禁止只读 README）：

| 审计专项 | 联合牵头 | 重点穿透核查目标 | 必交 10 项标准化审计字段 |
|---|---|---|---|
| **Stream A：Execution Capability Inventory** | OpenBot 架构组（联合 SDK 评审） | Model Provider、Auth Rotation、`agent-runtime`、Tool/MCP/Workflow、公开 Embedding/Reranker 接口缺口 | 1. 文件路径与代码入口<br>2. 核心对象与数据表/存储文件<br>3. API / RPC / Event 契约<br>4. 当前权威写主<br>5. 已实现且稳定功能<br>6. 仅有接口/原型/默认关闭/Fail-Closed 功能<br>7. 已完成的测试证据<br>8. 未覆盖的测试场景<br>9. 与另一仓库的重复点<br>10. 保留/扩展/迁移/废弃裁定 |
| **Stream B：Enterprise Data Boundary** | OpenBot 数据组 × SDK EDKI 组 | 逐一穿透 `connector-*-package.ts` vs `mock-handlers.ts`、`indexed-store.ts`、`semantic-object-store.ts`、`data-gateway.ts`、`agent-data-planner.ts`、`data-capability-tool.ts` 的真实执行与权限/脱敏链路 | 同上 10 项（外加：逐连接器区分生产可用驱动 vs Demo/Mock，明确解锁 `knowledge-object-only` 所需的安全门禁） |
| **Stream C：AI Optimization Inventory** | OpenBot AOR/Evolution 组 × SDK 评测组 | 穿透 `aor-core`（含 Stage 4 待验收项真实实码与持久化 Bandit）、`aor-backend-openbot`、`conversation-evaluation`、`evolution-core` 与 `billing` 真实调用链 | 同上 10 项（外加：核实 AOR Stage 4 真实测试状态、区分确定性探针 vs LLM-as-Judge 缺口） |
| **Stream D：Memory & Knowledge Boundary** | CogniWeave 组 × Knowledge SDK 组 × OpenBot Knowledge 组 | 核查 `cogniweave-sdk` REST/Sync/撤权语义、`knowledge-sdk@9940818b` 能力边界，以及 `src/gateway/knowledge/` 与 `vault-sync.ts` 的退场迁出计划 | 同上 10 项（外加：给出 OpenBot 本地知识模块向 SDK 委派收口清单，与 Space Pre-v7 B2-2 124 项实审完全对齐） |
| **Stream E：Cross-System Contract** | 双团队架构负责人联合签认 | 汇总 Gateway RPC、HTTP、Python/TS SDK、MCP、Events 与 `AIExecutionTrace` 唯一契约规范 | 输出冻结版《跨系统接口契约清单》及兼容性测试矩阵，纳入双仓 CI 守门 |

---

## 八、现行冻结红线与签认声明

在 Owner 书面签认本《v2.1 既有能力清单与 Knowledge SDK 边界规范》及完成 Stream A–E 深度穿透闭环与 Space Pre-v7 既定门禁之前，双团队继续严格执行以下冻结纪律：

```yaml
architecture_baseline_version: "Master Architecture v2.1 — Existing Capability Reuse Baseline"
signoff_status: "READY_FOR_OWNER_SIGNOFF_AND_STREAM_A_E_AUDIT_CLOSURE"
principles_locked:
  - "Reuse Before Build"
  - "One Capability, One Authority"
  - "Optimize the Existing Execution Platform"
baseline_anchors:
  openbot_main_sha: "58287aa449fb499f49080c467df76b774b458222"
  openbot_space_adapter_sha: "f0fccbd37bb9a45545562ee668295f9153b6f6aa"
  knowledge_sdk_main_sha: "b953c9922cc1096e0e88455dab6746c01a9d27f9"
  knowledge_sdk_frozen_wave2_sha: "9940818b962ccb186c0dfb0158de6bd9bd49057b"
frozen_guardrails:
  schema_v6_frozen: true
  v2_spaces_contract_frozen: true
  schema_v7_ddl_authorized: false
  final_alignment_frozen: false
  prod_shadow_migration_cutover_authorized: false
  space_gate7_status: "MET"
  space_gate3_status: "NOT_MET"
  space_gate4_status: "NOT_MET"
  semantic_object_dual_write_prohibited: true
  duplicate_runtime_or_connector_build_prohibited: true
```
