# Stream A：Model / Runtime / Tool 实码审计（INTERIM 10 字段）

- 审查起点 SHA：`f0fccbd37bb9a45545562ee668295f9153b6f6aa`（Track 2 分支 `codex/openbot/v21-wave0-audit-and-adapters` 由此创建；Track 1 `codex/openbot/knowledge-sdk-v2-min-slice-adapter` 指针仍为该 SHA）
- 日期：2026-11-27，时区 Asia/Shanghai (CST, UTC+8)
- 性质：代码级穿透，不是 README 结论。未改产品路由，未启用 `OPENBOT_KNOWLEDGE_SDK_V2_ENABLED`，未推送，未开 PR。
- **Exit Gate 3 / Gate 4 仍为 NOT_MET。本文不是自签署。**

## 官方 10 字段模板检索结论

检索范围（本轮）：Mac 工作树 `docs/`、Mac 归档 `/Users/daniel/.codex/visualizations/2026/11/25/01a210b8-fd0f-7f33-b2ec-282081c2e643/`、Box `/workspace/kb-sdk-align/`（含 zip-a/zip-b）、本轮用户附件目录。

**未找到**《Master Architecture v2.1 — OpenBot 既有能力清单与 Knowledge SDK 边界规范》第七节原文，也未找到其中规定的 10 项标准化审计字段清单。仅在 Downloads 见到无关的 `MASTER_ARCHITECTURE_V1_SIGNOFF_REVIEW.md`（v1 签认材料，不含 v2.1 第七节）。指令本身引用该规范，但未附字段表。

因此本报告使用下方 **INTERIM_10_FIELD_TEMPLATE（过渡模板）**，由本波次指令的必答问题与 L4/L5 验收口径推导。**不得把本模板宣称为官方第七节原文。** 若后续拿到官方字段表，应用官方字段重排，而不是改写本轮实码结论。

| # | 过渡字段 | 来源 |
|---|---|---|
| 1 | 能力/接口标识（名称与稳定 ID） | 指令「冻结可直接复用的公开接口表」 |
| 2 | 源码位置（file:line，本 SHA） | 严禁只读 README |
| 3 | 公开面与调用入口（RPC / 导出函数 / 工具） | 指令公开接口表 |
| 4 | 当前鉴权与主体模型 | 指令「含当前鉴权」 |
| 5 | 默认开 / 默认关，以及是否挂入默认生产路由 | 指令「default-on or default-off」 |
| 6 | 实现性质（真实驱动 / Demo / Mock / 库函数 / 未实现） | Stream B 必答；Stream A 同类标注 |
| 7 | 持久化与最终执行层（穿透终点） | 「B/C 必须穿透至持久化与最终执行」 |
| 8 | 计费、审计、配额接入点 | 指令 models.embed「鉴权与计费接入点」 |
| 9 | 安全红线与 Fail-Closed 条件 | L4 安全红线；Mode A/B/C；knowledge-object-only |
| 10 | 复用/包装建议与明确禁止项 | 禁止双写、禁止解锁桥、禁止 SDK 内置凭证等 |


## 结论摘要

1. **可直接复用的公开接口：本表冻结 16 项**（LLM/Runtime 8，Embedding 库 3，Gateway 模型 RPC 群 3（list/probe；management 读面；admission 读/写分列），Tool 目录 1，计费闸门 1）。另有 1 项库级 MMR 重排（非神经服务），不计入「神经 Rerank 接口」。不存在 `models.embed` / `models.rerank` RPC。
2. **`models.embed` 最小改造面：** 新增默认关闭的 Gateway RPC，内部只调用已有 `createEmbeddingProvider` + `embedQuery`/`embedBatch`；鉴权走 operator 角色 + 显式 scope + 企业主体（禁止只靠共享 token、无 user）；计费在调用前走 `cost-control` / `enforceCostControl(action=ai)`，成功后 `recordUsage`。**禁止**从 RPC 接受调用方 API Key，禁止把该 RPC 默认挂进生产路由。
3. **Reranker：** 仓库内没有内置神经重排服务，也没有 `models.rerank`。`src/memory/mmr.ts` 的 `mmrRerank`（`:116`）是基于 Jaccard 词集合的多样性重排，不是模型推理。锁定外部注入或未来默认关闭的 `models.rerank` 代理；SDK 不得内置付费 rerank 凭证。

---

## 可复用公开接口表（16 项 + MMR 附列）

每行按过渡 10 字段压缩填写。鉴权通例：Gateway 方法先经 `src/gateway/server-methods.ts:187+` 校验 `client.connect.role`（缺省 `"operator"`），`isRoleAuthorizedForMethod` 仅允许 `operator`（或 node 专用方法）；非 admin 再按 `authorizeOperatorScopesForMethod`（`method-scopes.ts`）。连接成功 ≠ 已绑定每用户身份。


| # | 1 标识 | 2 位置 | 3 公开面 | 4 鉴权 | 5 默认开/关 | 6 实现性质 | 7 执行/持久化终点 | 8 计费/审计 | 9 Fail-Closed | 10 复用建议与禁止 |
|---|---|---|---|---|---|---|---|---|---|---|
| A01 | `EmbeddingProvider` | `src/memory/embeddings.ts:32-38` | 类型：`embedQuery` / `embedBatch` | 无独立 RPC 鉴权；由调用方持有的 provider 实例使用服务端配置凭证 | 库类型，非路由 | 真实库契约 | 各 provider 的远程或本地推理；不写业务库 | 无内建计费 | 凭证来自配置/环境，不得由 RPC 传入 | SDK 应只调未来的 `models.embed` 代理或宿主注入，禁止在 SDK 内复制该类型并硬编码 Key |
| A02 | `createEmbeddingProvider` | `embeddings.ts:166` | 导出工厂（`provider`: openai/local/gemini/voyage/mistral/ollama/`auto`） | 读取 `OpenBotConfig` 与可选 `remote.apiKey`（`SecretInput`）；调用点在服务端 | 被 memory / kb-ingest 在配置启用时调用；**不是**默认 Gateway 路由 | 真实多后端工厂；`auto` 不含 ollama（`:44-46`）以免隐式假定本机实例 | 终点：各 `embeddings-*.ts` 客户端；local 用 node-llama-cpp；失败可按 `fallback` 切换 | 当前调用点（`src/memory/manager.ts:265`、`manager-sync-ops.ts:1193`、`conversations/conversation-embeddings.ts:72`、`gateway/knowledge/kb-ingest.ts:127`）**未见**自动 `recordUsage` | 无 provider/无密钥时返回 `provider: null` 并带原因，而不是静默编造向量 | **包装 `models.embed` 的唯一核心实现**；新 RPC 必须走此工厂，禁止再写一套 embed 客户端 |
| A03 | `createRemoteEmbeddingProvider` / `resolveRemoteEmbeddingClient` | `embeddings-remote-provider.ts:17` / `:53` | 远程 HTTP embed 客户端工厂 | 服务端 baseUrl + apiKey/headers | 仅当配置了 remote 后端 | 真实 HTTP 客户端 | 远程推理 HTTP | 同 A02，无内建用量事件 | 未配置则不可用 | 可被 `models.embed` 间接使用；禁止对 SDK 暴露 raw header 注入 |
| A04 | `runWithModelFallback` | `src/agents/model-fallback.ts:811` | LLM 调用 + 失败切换的执行函数 | 使用已解析的 provider 凭证（`applyProviderCredential` / 配置） | 运行时默认路径（Agent 对话），不是独立公开 RPC | 真实执行引擎 | 终点：各模型 Provider HTTP/SDK 调用；不是业务对象写主 | 与嵌入式会话/计费错误处理相连（`pi-embedded-helpers` billing error）；用量需在上层补齐 | 无可用 fallback 则失败，不得改走未授权模型 | Knowledge SDK 复用时应通过宿主 LLM 代理，而不是把 fallback 图迁入 SDK |
| A05 | `createAuthorizedModelSession` | `src/agent-runtime/model/authorized-session.ts:61` | Runtime 会话对象，封装授权后的模型调用端口 | 依赖 `ModelSessionPorts`（凭证/配置由运行时注入） | Agent Runtime 内部默认使用 | 真实运行时会话 | 终点：`runWithModelFallback` | 会话级，不直接写 billing store | 无端口/无授权则无法创建有效会话 | 公开复用面是「宿主 Runtime 会话」，不要在 SDK 再建一套会话 |
| A06 | `invokeInteractionCompletion` | `src/agent-runtime/model/interaction-completion.ts:152` | 交互补全入口 | 经授权会话与 admission | Runtime 默认交互路径 | 真实执行 | 模型补全；产物进入对话/交付链路 | 同上层计费 | 受 admission / governance 约束 | 可作为 LLMInvoke 适配的宿主实现，禁止 SDK 直连 Provider |
| A07 | `prepareEmbeddedModel` | `src/agent-runtime/model/prepare-embedded-model.ts:19` | 为嵌入式运行准备模型 | 配置 + 凭证准备 | 嵌入式路径使用 | 真实准备层 | 为后续推理准备客户端 | 不单独计费 | 准备失败则不得推理 | 内部能力；不必对 SDK 公开 |
| A08 | `applyProviderCredential` / `resolveImplicitProviders` / `normalizeProviders` | `apply-provider-credential.ts:5`；`models-config.providers.ts:670` / `:279` | 模型目录与凭证规范化/隐式发现（Ollama、Bedrock、Copilot 等） | 凭证来自配置、环境、发现流程；不是用户 RPC 参数 | 配置加载默认会规范化 providers | 真实配置解析（非执行） | 不执行推理；只产生 `ProviderConfig` | 无 | 规范化不得把空密钥当成可用付费后端 | 可复用为目录元数据；禁止把隐式发现当成对 SDK 的免费额度 |
| A09 | `models.list` | `src/gateway/server-methods/models.ts:52` | Gateway RPC | 角色 `operator` + `operator.read`（或 admin）；**handler 内无 user/tenant 再校验** | **默认开**（已注册默认方法表） | 真实目录读取 `context.loadGatewayModelCatalog` + `buildAllowedModelSet` | 读配置/目录，无模型调用 | 无用量记录 | 参数校验失败则拒绝；目录加载失败 `UNAVAILABLE` | 可复用为只读目录；不要把它当成已按租户隔离的计费目录 |
| A10 | `models.probe` | `models.ts:78` | Gateway RPC，会 `runAuthProbes`（默认 `maxTokens: 8`，`:105`） | 同 A09，`operator.read` | **默认开** | 真实探测，可能产生付费 API 调用 | 终点：Provider 探测请求；结果 `recordModelProbeResults` | **有外部调用风险，但未强制 `cost-control.check` / `recordUsage`** | 参数非法拒绝；探测异常 `UNAVAILABLE` | 不建议对 SDK 开放；若保留须加企业主体、预算闸门与用量。禁止作为 embed 代理 |
| A11 | `models.management.{snapshot,routing-explanations,aor-status}` | `models-management.ts:19,47,76` | 管理只读 RPC | `operator.read`（或 admin） | 默认开 | 真实快照/AOR 投影 | 读配置与平台模型快照 | 只读，不计费 | 参数校验失败拒绝 | 运维面，不作为 SDK 推理接口 |
| A12 | `models.admission.*` 读面 / 写面 | `models-admission.ts:35+` | 能力准入、校验任务、路由资格 | 读面（discover/get/list/preview）在 `operator.read`；写面 `create/cancel/createBatch/setRoutingEligibility` 在 `method-scopes.ts:593-596`（写 scope） | 默认开（已注册）；注释写明默认 runner **不**调用付费生成 API | 真实准入服务 | 校验任务存储 + 路由资格；非生成调用 | 写面无 embed 计费；官方注释强调不付费生成 | 写面缺 scope 拒绝 | 可用于模型准入治理，不是 embed/rerank 执行面 |
| A13 | `tools.catalog` | `src/gateway/server-methods/tools-catalog.ts:128` | 核心 + 可选插件工具目录 RPC | `operator` + `operator.read`；用 `client` 解析 `agentId` 工作区 | **默认开**（`includePlugins` 默认 true，`:140`） | 真实目录聚合 `buildCoreGroups` + `buildPluginGroups` | 读工具目录，不执行工具 | 无 | 非法 agentId 拒绝 | 可作为 Tool 发现面；执行仍走既有工具鉴权。**未发现**与此对称的通用公开 Workflow 运行时 RPC（仅见 `approval-workflow.ts` 等业务工作流，不列入可复用 Workflow 引擎） |
| A14 | `cost-control.check` | `src/gateway/server-methods/cost-control.ts:19` | 预算闸门 RPC（`action=ai|bot`） | `requireEnterpriseScope(client, …)`，必须有企业主体 | 默认开 | 真实预算执行 `enforceCostControl` | 读预算状态，不调用模型 | **计费接入主闸门** | 无企业 scope 或非法 action 拒绝；超预算 `allowed:false` | **`models.embed` 必须在推理前调用同等逻辑**（不必让 SDK 直接打该 RPC，但服务端要强制） |
| A15 | `recordUsage` | `src/gateway/billing/usage-records-store.ts:73` | 用量记账函数 | 强制 `enterpriseId`（函数注释：无「无租户查询」） | 库函数，默认不自动挂到 embed | 真实持久化用量账本 | 写入用量 store（按 enterpriseId + eventId 去重） | 计费账本本身 | 缺租户不可记 | **`models.embed` 成功路径的记账点**；key 建议独立如 `models.embed` |
| A16 | Provider 静态/发现构建器族 | `models-config.providers.static.ts` / `providers.discovery.ts` / `providers.ts:46+` 再导出 | `buildMoonshotProvider`、`buildOllamaProvider` 等 | 构建配置，不含运行时用户鉴权 | 配置加载时使用 | 真实目录构建 | 不执行 | 无 | 发现失败则该 implicit provider 不出现 | 只读复用为模型目录，禁止迁入 SDK |

附列（不计入 16 项公开推理/目录接口，也不算神经 Rerank 服务）：

| # | 1 标识 | 2 位置 | 3 公开面 | 4 鉴权 | 5 默认 | 6 性质 | 7 终点 | 8 计费 | 9 红线 | 10 建议 |
|---|---|---|---|---|---|---|---|---|---|---|
| A17 | `mmrRerank` / `applyMMRToHybridResults` | `src/memory/mmr.ts:116` / `:189` | 库函数 | 无 | 记忆混合检索路径可调用 | **词法 Jaccard 多样性重排**（`jaccardSimilarity` `:41`，`tokenize` `:32`），无模型权重、无远程服务 | 纯内存重排，不持久化 | 无 | 不得宣称为神经 rerank | 可继续作检索多样性工具；神经 rerank 只能外部注入或未来默认关闭的代理 |

### 未找到的接口

- 不存在 Gateway RPC `models.embed`、`models.rerank`（已检索 `models.ts` / `models-management.ts` / `models-admission.ts` 方法名）。
- 未找到内置神经 reranker 服务、独立 rerank HTTP 模块或模型权重加载器。
- 未找到可与 `tools.catalog` 并列的通用公开 Workflow 执行引擎 RPC。

---

## `models.embed` 受控代理：最小改造面

目标：把既有 `src/memory/embeddings-*.ts` 封装为受控公开代理，而不是再写一套客户端。

**建议新增（默认关闭，本波次若实现也不得挂默认生产路由）：**

1. Gateway 方法名：`models.embed`（参数：texts[]、可选 model/provider 提示；**禁止** `apiKey` / `headers` 字段）。
2. 注册：独立方法包或显式 flag，默认不进入生产默认路由表；与 `OPENBOT_KNOWLEDGE_SDK_V2_ENABLED` 解耦，且该旗标保持默认 false。
3. 鉴权接入点：
   - 既有 `operator` 角色 + 建议专用或至少 `operator.write`（因可能产生费用；不要只靠 `operator.read`）；
   - 必须解析出企业主体 + 用户/座席身份（参照 `requireEnterpriseScope`，`cost-control.ts:22`）。共享 token 且无 `client.user` 的连接应失败关闭，不得共用匿名主体。
4. 计费接入点：
   - 调用前：`enforceCostControl({ enterpriseId, action: "ai" })`，拒绝则不准出站；
   - 调用后成功：`recordUsage({ enterpriseId, userId, eventId, key: "models.embed", quantity })`（`usage-records-store.ts:73`）。
5. 执行：只调用 `createEmbeddingProvider({ config: loadConfig(), provider, model, fallback, … })`，然后 `embedQuery` / `embedBatch`。凭证只来自网关配置 / 密钥保险库（`schema.help.ts` 中 memory embedding API key 说明），**永不**来自 RPC。
6. 审计：记录 tenant/user/agent、provider id、model、文本条数/字符量、trace_id（为 VB-3 的 `AIExecutionTraceHeaderPropagator` 预留），禁止把原文全量写入日志。
7. 失败关闭：无企业主体、预算拒绝、无可用 provider、非法参数 → 拒绝；不得回退到「随便一个未授权本地模型」来假装成功。

**明确不在最小改造面内：** 改 knowledge-sdk、改默认路由、把 embed 并入 `models.probe`、开放 `models.rerank`、Semantic Object 双写。

---

## Reranker 锁定结论（源码）

- `src/memory/mmr.ts:116` `mmrRerank`：按相关性与 Jaccard 相似度做 MMR 选择，纯词法。
- 全仓指定审查范围内无神经 rerank 服务、无 `models.rerank` RPC、无内置 cross-encoder。
- **锁定策略：** 神经 rerank 仅允许（a）宿主注入外部 Provider，或（b）未来默认关闭的 `models.rerank` 代理，鉴权/计费比照 `models.embed`。Knowledge SDK 不得内置模型凭证或隐式付费 rerank。词法 MMR 可继续作为非模型工具存在，但不得写成「已有神经 Reranker」。
