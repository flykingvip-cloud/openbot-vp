# Stream A：Execution Capability Inventory（官方第 7 节 10 字段重出）

- 日期：2026-11-27，时区 Asia/Shanghai (CST, UTC+8)
- 性质：**官方字段重出**，不是 Wave-V21-0 正式验收，也不是 v2.1 基线签认（`signoff_status` 仍为 `READY_FOR_OWNER_SIGNOFF_AND_STREAM_A_E_AUDIT_CLOSURE`）。
- 字段来源：`MASTER_ARCHITECTURE_V2_1_REUSE_BASELINE.md`（SHA-256 `c5196ff1d050ac6477cc064390a708a4d10121cf7fe300bb24764a87a2a5b1c2`）「七、联合代码级深度审计执行任务书」必交 10 项标准化审计字段。本报告 **只使用** 下列中文官方字段名，不使用 `INTERIM_10_FIELD_TEMPLATE`，也不使用 `file_path` / `current_write_authority` 等旧英文列名。
- 技术事实复用自过渡报告 `STREAM_A_MODEL_RUNTIME_AUDIT.md`（SHA-256 `f3d6887d19621f3e3083ddecd1d4d8f639de48712cbaf95a5f4ede072988d0aa`），并在 Track 2 工作树（产品代码与 `f0fccbd37bb9a45545562ee668295f9153b6f6aa` 一致，仅文档超前）上复核关键锚点。未发明新的通过计数。过渡报告原文保留，不被本文件覆盖。
- 未改产品路由，未启用 `OPENBOT_KNOWLEDGE_SDK_V2_ENABLED`，未推送，未开 PR。

官方 10 项字段（原文）：

1. 文件路径与代码入口
2. 核心对象与数据表/存储文件
3. API / RPC / Event 契约
4. 当前权威写主
5. 已实现且稳定功能
6. 仅有接口/原型/默认关闭/Fail-Closed 功能
7. 已完成的测试证据
8. 未覆盖的测试场景
9. 与另一仓库的重复点
10. 保留/扩展/迁移/废弃裁定

## 结论摘要

- 可复用的真实执行面包括：`src/memory/embeddings*.ts` 的 Embedding 工厂与 provider、`runWithModelFallback` / Authorized Model Session / interaction completion、Gateway `models.list` / `models.probe` / models-management / models-admission、`tools.catalog`、`cost-control.check` + `recordUsage`、以及默认已注册的 `cron.*` 定时任务族（本仓无独立 `workflow.*` 方法文件；Workflow 清单以 cron 为已核实入口）。
- **不存在** 公开 Gateway RPC `models.embed` 或 `models.rerank`（本轮全仓 `*.ts` 检索为零命中；`server-methods-list.ts` 仅注册 `models.list` / `models.probe`）。
- `mmrRerank`（`src/memory/mmr.ts:116`）是 Jaccard 词法多样性重排（`jaccardSimilarity` `:41`），不是神经 reranker。
- `models.embed` 最小改造面（若后续实现）必须默认关闭、不进默认生产路由：包装 `createEmbeddingProvider`（`embeddings.ts:166`）+ `embedQuery` / `embedBatch`（类型定义 `:36-37`），鉴权为 operator + 企业主体，调用前 `enforceCostControl({ action: "ai" })`、成功后 `recordUsage`，RPC 禁止传入 API key。

## 冻结可复用清单（按官方 10 字段）

下列行是过渡报告 A01–A16 与 MMR 附列的官方字段重映射。行内位置已复核：`createEmbeddingProvider` 仍在 `:166`；`models.list` / `models.probe` 仍在 `models.ts:52` / `:78`；`recordUsage` 仍在 `usage-records-store.ts:73`；`enforceCostControl` 仍在 `src/gateway/billing/enforce.ts:19`。`EmbeddingProvider` 现为 `export type`（`:32`），不再是 interface，方法仍为 `embedQuery` / `embedBatch`（`:36-37`）。

| 标识 | 1. 文件路径与代码入口 | 2. 核心对象与数据表/存储文件 | 3. API / RPC / Event 契约 | 4. 当前权威写主 | 5. 已实现且稳定功能 | 6. 仅有接口/原型/默认关闭/Fail-Closed 功能 | 7. 已完成的测试证据 | 8. 未覆盖的测试场景 | 9. 与另一仓库的重复点 | 10. 保留/扩展/迁移/废弃裁定 |
|---|---|---|---|---|---|---|---|---|---|---|
| Embedding 库 | `src/memory/embeddings.ts:32+`；工厂 `createEmbeddingProvider` `:166`；远程 `embeddings-remote-provider.ts:17`；各 `embeddings-{openai,gemini,mistral,ollama,voyage}.ts` | 无业务对象表；配置/环境中的 provider 凭证；不写 EnterpriseDataStore | 库类型 `embedQuery` / `embedBatch`；**无** Gateway RPC | 凭证与配置的权威在 OpenBot 配置/保险库，不在 SDK | 多厂商 Embedding 与批处理、fallback/`auto` 为真实库实现 | 不是公开路由；不得经 RPC 传入密钥 | 本轮未重跑 memory embedding 套件；过渡报告未给出本轮新鲜通过数 | 无公开 `models.embed` 合约测试；缺企业主体+计费闭环的 RPC 测试 | Knowledge SDK 不得内置付费 Embed 凭证；可注入 `Embedder` | **保留** 为内部库；**扩展** 仅允许默认关闭的 `models.embed` 受控代理 |
| LLM Runtime | `src/agents/model-fallback.ts:811` `runWithModelFallback`；`src/agent-runtime/model/authorized-session.ts:61`；`interaction-completion.ts:152`；`prepare-embedded-model.ts:19`；凭证规范化 `apply-provider-credential.ts` / `models-config.providers.ts` | 会话/补全运行时对象；计费账本见下；不是业务对象写主 | 运行时内部调用，不是独立公开 embed/rerank RPC | OpenBot Agent Runtime 为 LLM 执行权威 | 对话与交互补全的失败切换、授权会话、admission 约束为生产运行路径 | 不把内部会话对象直接公开给 SDK | 过渡报告记录了既有 runtime/admission 测试存在；本轮未重跑 | 跨系统 `AIExecutionTrace` 七字段尚未从 runtime 强制透传到评测/SDK | SDK 推理应走可注入 `ModelAdapter`，禁止再实现一套执行引擎 | **保留** OpenBot 为 LLM 执行权威；SDK 只许注入，不许内置凭证 |
| 模型目录/探测 | `src/gateway/server-methods/models.ts:52` `models.list`、`:78` `models.probe`；`models-management.ts`；`models-admission.ts`；注册于 `server-methods-list.ts:119-120`、`method-scopes.ts:102-103` | 模型目录来自 `loadGatewayModelCatalog`；探测结果可被记录 | Gateway RPC；`models.list` / `models.probe` 角色 `operator` + `operator.read`（或 admin）；handler 内无 user/tenant 再校验 | OpenBot 模型目录与探测记录 | 目录读取与探测已默认注册 | `models.probe` 可能产生付费调用，但未强制 `enforceCostControl(action=ai)`（过渡结论，本轮未改码） | `src/gateway/server.models-voicewake-misc.test.ts` 等覆盖 list；本轮未重跑 | probe 缺强制计费/企业主体闸门测试 | 与 SDK 模型目录可能概念重叠，但公开 RPC 权威在 OpenBot | **保留** list/admission/management；**不要**把 probe 当作 embed 代理；扩展 embed 须独立默认关闭方法 |
| Tool 目录 | `src/gateway/server-methods/tools-catalog.ts:128` `tools.catalog` | 工具目录聚合，非业务行存储 | Gateway RPC；`operator` + `operator.read`；`includePlugins` 默认 true | OpenBot 工具/插件目录 | 核心+可选插件目录已默认开 | 不是 ConnectorAction 执行入口（执行仍受 data-capability Fail-Closed 约束） | 过渡报告未单列本轮新鲜通过数 | 未覆盖「目录项被误当成可执行桥」的负面用例作为本专项证据 | SDK 不应复制一套工具目录 | **保留** 为 OpenBot 工具发现面 |
| 计费闸门 | `src/gateway/server-methods/cost-control.ts:19`；`enforceCostControl` `src/gateway/billing/enforce.ts:19`；`recordUsage` `usage-records-store.ts:73` | 用量账本按 enterpriseId + eventId 去重 | `cost-control.check`（`action=ai\|bot`）经 `requireEnterpriseScope` | OpenBot billing 为用量写主 | 企业主体预算闸门与记账函数已实现 | `recordUsage` 不会自动挂到不存在的 `models.embed` | 既有 billing 单测（如 usage-records / settlement）存在；本轮未重跑 | `models.embed` 调用前/后计费尚未有 RPC 级测试（因 RPC 不存在） | 禁止 SDK 自建计费 | **保留**；未来 embed 代理必须接入这两个点 |
| Workflow / cron | `src/gateway/server-methods/cron.ts`（`cron.list` `:207` 起，至 `cron.taskTemplates.delete` `:626`）；默认注册于 `server-methods-list.ts:614-625` | cron job / run log / team task templates（`src/cron/*`） | Gateway `cron.list/status/add/update/remove/run/runs/taskTemplates.*` | OpenBot cron 存储为定时任务写主 | 默认定时任务族已注册，含个人 scope 收窄与失败关闭注释 | 这不是 Knowledge SDK 工作流引擎，也不是 Task Graph 执行后端 | 存在 `cron.personal-scope.test.ts` 等；本轮未重跑 | 与 SDK IKC/KSG 工作流的映射未建立 | 禁止在 SDK 另建一套通用工作流执行引擎来替代 OpenBot cron/runtime | **保留** 为 OpenBot 定时/工作流入口；本波次不迁移写主 |
| 词法 MMR | `src/memory/mmr.ts:116` `mmrRerank`；`:189` `applyMMRToHybridResults`；`jaccardSimilarity` `:41` | 纯内存重排，不持久化 | 库函数，无 RPC | 无对象写主 | 记忆混合检索路径可调用的词法多样性重排 | **不是**神经 rerank；无 `models.rerank` | 过渡报告未单列本轮新鲜通过数 | 无神经 rerank 合约测试（功能本身不存在） | 不得把 MMR 宣传为 SDK 可复用的神经 Reranker | **保留** 为词法工具；神经 rerank 仅允许宿主注入或未来默认关闭代理 |

## `models.embed` 受控代理：最小改造面（默认关闭）

目标：包装既有 `src/memory/embeddings-*.ts`，而不是再写一套客户端。本波次 **只描述、不落地该 RPC**。

1. 方法名 `models.embed`（texts[]、可选 model/provider 提示；**禁止** `apiKey` / `headers`）。
2. 独立方法包或显式 flag，默认不进入生产默认路由表；与 `OPENBOT_KNOWLEDGE_SDK_V2_ENABLED` 解耦，该旗标保持默认 false（`src/knowledge/adapter/config.ts` 仅在环境变量字面量 `"true"` 时启用）。
3. 鉴权：operator + 企业主体（参照 `requireEnterpriseScope`）；共享 token 且无 `client.user` 应失败关闭。
4. 计费：调用前 `enforceCostControl({ enterpriseId, action: "ai" })`；成功后 `recordUsage({ enterpriseId, userId, eventId, key: "models.embed", quantity })`。
5. 执行：仅 `createEmbeddingProvider` + `embedQuery` / `embedBatch`；凭证只来自网关配置/保险库，永不来自 RPC。
6. 审计预留 `trace_id` 等 AIExecutionTrace 头，禁止把原文全量写入日志。
7. 无企业主体、预算拒绝、无可用 provider、非法参数 → 拒绝；不得回退到未授权本地模型假装成功。

明确不在最小改造面内：改 knowledge-sdk、改默认路由、把 embed 并入 `models.probe`、开放 `models.rerank`、Semantic Object 双写。

## Reranker（源码锁定）

- `mmrRerank` 为 Jaccard 词法 MMR，无模型权重、无远程 rerank 服务。
- 审查范围内无神经 rerank、无 `models.rerank` RPC、无内置 cross-encoder。
- 神经 rerank 仅允许：（a）宿主注入外部 Provider，或（b）未来默认关闭的 `models.rerank` 代理（鉴权/计费比照 embed）。SDK 不得内置模型凭证。

## 本专项的字段 7–8 总述

本重出不宣称 T-01–T-27 或零退化。已完成测试证据仅指向树内既有测试文件（如 `server.models-voicewake-misc.test.ts`、billing 套件、`cron.personal-scope.test.ts`），**本文件不附新鲜通过数**。未覆盖：公开 `models.embed` / `models.rerank` 的鉴权-计费-禁密钥负面用例（RPC 尚不存在）；神经 rerank 合约；跨系统 Trace 头强制透传。
